import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { signToken, makePayload } from "../lib/jwt";
import { getDb, dyUsers, dyAccounts } from "../db";
import { and, eq, sql } from "drizzle-orm";

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

auth.get("/google", (c) => {
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state,
  });

  const res = Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    302,
  );
  const headers = new Headers(res.headers);
  headers.set(
    "Set-Cookie",
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
  );
  return new Response(null, { status: 302, headers });
});

auth.get("/google/callback", async (c) => {
  const { code, state, error } = c.req.query() as Record<string, string>;
  const frontendUrl = c.env.FRONTEND_URL;

  if (error || !code) {
    return Response.redirect(`${frontendUrl}?auth_error=access_denied`, 302);
  }

  const cookieHeader = c.req.header("Cookie") ?? "";
  const stateCookie = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("oauth_state="))
    ?.split("=")[1];

  if (!stateCookie || stateCookie !== state) {
    return Response.redirect(`${frontendUrl}?auth_error=state_mismatch`, 302);
  }

  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return Response.redirect(`${frontendUrl}?auth_error=token_exchange`, 302);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  };

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return Response.redirect(`${frontendUrl}?auth_error=userinfo`, 302);
  }

  const googleUser = (await userRes.json()) as {
    id: string;
    name?: string;
    email?: string;
    picture?: string;
  };

  const providerAccountId = googleUser.id;
  const db = getDb(c.env.DB);

  const existing = await db
    .select({ user_id: dyAccounts.user_id })
    .from(dyAccounts)
    .where(
      and(
        eq(dyAccounts.provider, "google"),
        eq(dyAccounts.provider_account_id, providerAccountId),
      ),
    )
    .get();

  let userId: string;

  if (existing) {
    userId = existing.user_id;
    await db
      .update(dyAccounts)
      .set({
        access_token: tokens.access_token,
        refresh_token: sql`COALESCE(${tokens.refresh_token ?? null}, ${dyAccounts.refresh_token})`,
        expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
      })
      .where(
        and(
          eq(dyAccounts.provider, "google"),
          eq(dyAccounts.provider_account_id, providerAccountId),
        ),
      );
    await db
      .update(dyUsers)
      .set({ name: googleUser.name ?? null, image: googleUser.picture ?? null })
      .where(eq(dyUsers.id, userId));
  } else {
    userId = crypto.randomUUID();
    const existingByEmail = googleUser.email
      ? await db
          .select({ id: dyUsers.id })
          .from(dyUsers)
          .where(eq(dyUsers.email, googleUser.email))
          .get()
      : null;

    if (existingByEmail) {
      userId = existingByEmail.id;
    } else {
      await db.insert(dyUsers).values({
        id: userId,
        name: googleUser.name ?? null,
        email: googleUser.email ?? null,
        image: googleUser.picture ?? null,
      });
    }

    await db.insert(dyAccounts).values({
      user_id: userId,
      provider: "google",
      provider_account_id: providerAccountId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
    });
  }

  const userRow = await db
    .select({ timezone: dyUsers.timezone })
    .from(dyUsers)
    .where(eq(dyUsers.id, userId))
    .get();
  const timezone = userRow?.timezone ?? "America/Bogota";

  const jwt = await signToken(makePayload(userId, timezone), c.env.JWT_SECRET);

  const redirectHeaders = new Headers({
    Location: `${frontendUrl}/auth/callback?token=${jwt}`,
    "Set-Cookie":
      "oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/",
  });

  return new Response(null, { status: 302, headers: redirectHeaders });
});

export { auth };
