import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { Env, Variables } from "../types";
import { getDb, dyAccounts } from "../db";

const calendarPublic = new Hono<{ Bindings: Env; Variables: Variables }>();

calendarPublic.get("/connect", (c) => {
  const redirectUri = `${new URL(c.req.url).origin}/api/calendar/connect/callback`;
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile https://www.googleapis.com/auth/calendar.events",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    "Set-Cookie": `cal_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
  });
  return new Response(null, { status: 302, headers });
});

calendarPublic.get("/connect/callback", async (c) => {
  const { code, state, error } = c.req.query() as Record<string, string>;
  const frontendUrl = c.env.FRONTEND_URL;

  if (error || !code) {
    return Response.redirect(`${frontendUrl}/profile?calendar=error&reason=denied`, 302);
  }

  const cookieHeader = c.req.header("Cookie") ?? "";
  const stateCookie = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("cal_oauth_state="))
    ?.split("=")[1];

  if (!stateCookie || stateCookie !== state) {
    return Response.redirect(`${frontendUrl}/profile?calendar=error&reason=state`, 302);
  }

  const redirectUri = `${new URL(c.req.url).origin}/api/calendar/connect/callback`;
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
    const body = await tokenRes.text().catch(() => "");
    return Response.redirect(
      `${frontendUrl}/profile?calendar=error&reason=token&detail=${encodeURIComponent(body.slice(0, 80))}`,
      302,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return Response.redirect(`${frontendUrl}/profile?calendar=error&reason=userinfo`, 302);
  }

  const googleUser = (await userRes.json()) as { id: string };
  await getDb(c.env.DB)
    .update(dyAccounts)
    .set({
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
      calendar_authorized: 1,
    })
    .where(
      and(
        eq(dyAccounts.provider, "google"),
        eq(dyAccounts.provider_account_id, googleUser.id),
      ),
    );

  const headers = new Headers({
    Location: `${frontendUrl}/profile?calendar=connected`,
    "Set-Cookie": "cal_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/",
  });
  return new Response(null, { status: 302, headers });
});

export { calendarPublic };
