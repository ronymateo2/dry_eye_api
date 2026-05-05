import { Hono } from "hono";
import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyAccounts, dyCalendarEvents, dyDropTypes, dyDrops } from "../db";
import { getDayKey, dayKeyToUtcStart } from "../lib/utils";
import {
  getValidAccessToken,
  createCalendarEvent,
  deleteCalendarEvent,
} from "../lib/calendar";

const calendar = new Hono<{ Bindings: Env; Variables: Variables }>();

function getNextDayKey(dayKey: string): string {
  const d = new Date(dayKey + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function syncDropDay(
  db: ReturnType<typeof getDb>,
  env: Env,
  userId: string,
  userTimezone: string,
  dropTypeId: string,
  dayKey: string,
  fromLoggedAt: string,
): Promise<{ events_created: number } | { skipped: true; reason: string }> {
  const dropType = await db
    .select({ name: dyDropTypes.name, interval_hours: dyDropTypes.interval_hours })
    .from(dyDropTypes)
    .where(and(eq(dyDropTypes.id, dropTypeId), eq(dyDropTypes.user_id, userId)))
    .get();

  if (!dropType?.interval_hours) return { skipped: true, reason: "prn" };

  const nextDayKey = getNextDayKey(dayKey);
  const dayEndUtc = new Date(dayKeyToUtcStart(nextDayKey, userTimezone));
  const intervalMs = dropType.interval_hours * 3_600_000;

  const doses: Date[] = [];
  let t = new Date(fromLoggedAt).getTime() + intervalMs;
  while (t < dayEndUtc.getTime()) {
    doses.push(new Date(t));
    t += intervalMs;
  }

  if (doses.length === 0) return { events_created: 0 };

  const accessToken = await getValidAccessToken(db, userId, env);
  if (!accessToken) return { skipped: true, reason: "token_unavailable" };

  let created = 0;
  for (const doseTime of doses) {
    const eventId = await createCalendarEvent(accessToken, {
      dropTypeName: dropType.name,
      scheduledAt: doseTime,
      timezone: userTimezone,
    });
    if (eventId) {
      await db.insert(dyCalendarEvents).values({
        id: crypto.randomUUID(),
        user_id: userId,
        drop_type_id: dropTypeId,
        day_key: dayKey,
        google_event_id: eventId,
        scheduled_at: doseTime.toISOString(),
      });
      created++;
    }
  }

  return { events_created: created };
}

// OAuth connect — browser redirect, no auth middleware
calendar.get("/connect", (c) => {
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

calendar.get("/connect/callback", async (c) => {
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
  const db = getDb(c.env.DB);

  await db
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

calendar.use("/status", authMiddleware);
calendar.use("/events/today", authMiddleware);
calendar.use("/sync-day", authMiddleware);
calendar.use("/reprocess", authMiddleware);

calendar.get("/status", async (c) => {
  const userId = c.get("userId");
  const userTimezone = c.get("userTimezone");
  const db = getDb(c.env.DB);

  const account = await db
    .select({ calendar_authorized: dyAccounts.calendar_authorized })
    .from(dyAccounts)
    .where(and(eq(dyAccounts.user_id, userId), eq(dyAccounts.provider, "google")))
    .get();

  const todayKey = getDayKey(new Date().toISOString(), userTimezone);

  const events = await db
    .select({
      drop_type_id: dyCalendarEvents.drop_type_id,
      drop_type_name: dyDropTypes.name,
      day_key: dyCalendarEvents.day_key,
      count: count(),
    })
    .from(dyCalendarEvents)
    .innerJoin(dyDropTypes, eq(dyCalendarEvents.drop_type_id, dyDropTypes.id))
    .where(
      and(eq(dyCalendarEvents.user_id, userId), eq(dyCalendarEvents.day_key, todayKey)),
    )
    .groupBy(dyCalendarEvents.drop_type_id, dyDropTypes.name, dyCalendarEvents.day_key);

  return c.json({
    authorized: account?.calendar_authorized === 1,
    events_today: events,
  });
});

calendar.get("/events/today", async (c) => {
  const userId = c.get("userId");
  const userTimezone = c.get("userTimezone");
  const db = getDb(c.env.DB);

  const todayKey = getDayKey(new Date().toISOString(), userTimezone);

  const events = await db
    .select({
      scheduled_at: dyCalendarEvents.scheduled_at,
      drop_type_id: dyCalendarEvents.drop_type_id,
      name: dyDropTypes.name,
    })
    .from(dyCalendarEvents)
    .innerJoin(dyDropTypes, eq(dyCalendarEvents.drop_type_id, dyDropTypes.id))
    .where(and(eq(dyCalendarEvents.user_id, userId), eq(dyCalendarEvents.day_key, todayKey)));

  return c.json({ events });
});

calendar.post("/sync-day", async (c) => {
  if (c.env.CALENDAR_SYNC_DISABLED === "true") {
    return c.json({ ok: true, skipped: true, reason: "disabled" });
  }
  const userId = c.get("userId");
  const userTimezone = c.get("userTimezone");
  const body = await c.req.json<{
    dropTypeId: string;
    dayKey: string;
    fromLoggedAt: string;
  }>();
  const db = getDb(c.env.DB);

  const account = await db
    .select({ calendar_authorized: dyAccounts.calendar_authorized })
    .from(dyAccounts)
    .where(and(eq(dyAccounts.user_id, userId), eq(dyAccounts.provider, "google")))
    .get();

  if (!account?.calendar_authorized) {
    return c.json({ ok: false, error: "calendar_not_authorized" }, 400);
  }

  // Idempotency: skip if events already exist for this day+type
  const existing = await db
    .select({ count: count() })
    .from(dyCalendarEvents)
    .where(
      and(
        eq(dyCalendarEvents.user_id, userId),
        eq(dyCalendarEvents.drop_type_id, body.dropTypeId),
        eq(dyCalendarEvents.day_key, body.dayKey),
      ),
    )
    .get();

  if (existing && existing.count > 0) {
    return c.json({ ok: true, skipped: true, reason: "already_synced" });
  }

  const result = await syncDropDay(
    db,
    c.env,
    userId,
    userTimezone,
    body.dropTypeId,
    body.dayKey,
    body.fromLoggedAt,
  );

  return c.json({ ok: true, ...result });
});

calendar.post("/reprocess", async (c) => {
  if (c.env.CALENDAR_SYNC_DISABLED === "true") {
    return c.json({ ok: true, skipped: true, reason: "disabled" });
  }
  const userId = c.get("userId");
  const userTimezone = c.get("userTimezone");
  const body = await c.req.json<{ dropTypeId: string; dayKey: string }>();
  const db = getDb(c.env.DB);

  const account = await db
    .select({ calendar_authorized: dyAccounts.calendar_authorized })
    .from(dyAccounts)
    .where(and(eq(dyAccounts.user_id, userId), eq(dyAccounts.provider, "google")))
    .get();

  if (!account?.calendar_authorized) {
    return c.json({ ok: false, error: "calendar_not_authorized" }, 400);
  }

  // Delete existing events from Google Calendar + DB
  const existing = await db
    .select({ id: dyCalendarEvents.id, google_event_id: dyCalendarEvents.google_event_id })
    .from(dyCalendarEvents)
    .where(
      and(
        eq(dyCalendarEvents.user_id, userId),
        eq(dyCalendarEvents.drop_type_id, body.dropTypeId),
        eq(dyCalendarEvents.day_key, body.dayKey),
      ),
    );

  if (existing.length > 0) {
    const accessToken = await getValidAccessToken(db, userId, c.env);
    if (accessToken) {
      await Promise.all(existing.map((e) => deleteCalendarEvent(accessToken, e.google_event_id)));
    }
    await db
      .delete(dyCalendarEvents)
      .where(
        and(
          eq(dyCalendarEvents.user_id, userId),
          eq(dyCalendarEvents.drop_type_id, body.dropTypeId),
          eq(dyCalendarEvents.day_key, body.dayKey),
        ),
      );
  }

  // Find last drop in this day (UTC range)
  const dayStartUtc = dayKeyToUtcStart(body.dayKey, userTimezone);
  const dayEndUtc = dayKeyToUtcStart(getNextDayKey(body.dayKey), userTimezone);

  const lastDrop = await db
    .select({ logged_at: dyDrops.logged_at })
    .from(dyDrops)
    .where(
      and(
        eq(dyDrops.user_id, userId),
        eq(dyDrops.drop_type_id, body.dropTypeId),
        gte(dyDrops.logged_at, dayStartUtc),
        lt(dyDrops.logged_at, dayEndUtc),
      ),
    )
    .orderBy(desc(dyDrops.logged_at))
    .limit(1)
    .get();

  if (!lastDrop) {
    return c.json({ ok: true, skipped: true, reason: "no_drops" });
  }

  const loggedAt = lastDrop.logged_at.replace(" ", "T").replace(/\+00$/, "Z");

  const result = await syncDropDay(
    db,
    c.env,
    userId,
    userTimezone,
    body.dropTypeId,
    body.dayKey,
    loggedAt,
  );

  return c.json({ ok: true, ...result });
});

export { calendar };
