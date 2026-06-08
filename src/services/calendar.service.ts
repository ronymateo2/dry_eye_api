import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyAccounts, dyCalendarEvents, dyDropTypes, dyDrops } from "../db";
import type { Env } from "../types";
import { nextDayKey } from "../lib/dates";
import { dayKeyToUtcStart, getDayKey } from "../lib/utils";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getValidAccessToken,
} from "../lib/calendar";

export async function getCalendarStatus(db: DrizzleDb, userId: string, userTimezone: string) {
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
    .where(and(eq(dyCalendarEvents.user_id, userId), eq(dyCalendarEvents.day_key, todayKey)))
    .groupBy(dyCalendarEvents.drop_type_id, dyDropTypes.name, dyCalendarEvents.day_key);

  return {
    authorized: account?.calendar_authorized === 1,
    events_today: events,
  };
}

export const todayEventsQuery = (db: DrizzleDb, userId: string, todayKey: string) =>
  db
    .select({
      scheduled_at: dyCalendarEvents.scheduled_at,
      drop_type_id: dyCalendarEvents.drop_type_id,
      name: dyDropTypes.name,
    })
    .from(dyCalendarEvents)
    .innerJoin(dyDropTypes, eq(dyCalendarEvents.drop_type_id, dyDropTypes.id))
    .where(and(eq(dyCalendarEvents.user_id, userId), eq(dyCalendarEvents.day_key, todayKey)));

export async function getTodayCalendarEvents(db: DrizzleDb, userId: string, userTimezone: string) {
  const todayKey = getDayKey(new Date().toISOString(), userTimezone);
  return { events: await todayEventsQuery(db, userId, todayKey) };
}

export type SyncDayInput = {
  dropTypeId: string;
  dayKey: string;
  fromLoggedAt: string;
};

export async function syncCalendarDay(
  db: DrizzleDb,
  env: Env,
  userId: string,
  userTimezone: string,
  body: SyncDayInput,
) {
  if (env.CALENDAR_SYNC_DISABLED === "true") {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const authorized = await isCalendarAuthorized(db, userId);
  if (!authorized) return { ok: false, error: "calendar_not_authorized" };

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
    return { ok: true, skipped: true, reason: "already_synced" };
  }

  const result = await syncDropDay(
    db,
    env,
    userId,
    userTimezone,
    body.dropTypeId,
    body.dayKey,
    body.fromLoggedAt,
  );
  return { ok: true, ...result };
}

export async function reprocessCalendarDay(
  db: DrizzleDb,
  env: Env,
  userId: string,
  userTimezone: string,
  body: { dropTypeId: string; dayKey: string },
) {
  if (env.CALENDAR_SYNC_DISABLED === "true") {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const authorized = await isCalendarAuthorized(db, userId);
  if (!authorized) return { ok: false, error: "calendar_not_authorized" };

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
    const accessToken = await getValidAccessToken(db, userId, env);
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

  const dayStartUtc = dayKeyToUtcStart(body.dayKey, userTimezone);
  const dayEndUtc = dayKeyToUtcStart(nextDayKey(body.dayKey), userTimezone);
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
    return { ok: true, skipped: true, reason: "no_drops" };
  }

  const loggedAt = lastDrop.logged_at.replace(" ", "T").replace(/\+00$/, "Z");
  const result = await syncDropDay(db, env, userId, userTimezone, body.dropTypeId, body.dayKey, loggedAt);
  return { ok: true, ...result };
}

async function isCalendarAuthorized(db: DrizzleDb, userId: string): Promise<boolean> {
  const account = await db
    .select({ calendar_authorized: dyAccounts.calendar_authorized })
    .from(dyAccounts)
    .where(and(eq(dyAccounts.user_id, userId), eq(dyAccounts.provider, "google")))
    .get();

  return Boolean(account?.calendar_authorized);
}

export async function syncDropDay(
  db: DrizzleDb,
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

  const dayEndUtc = new Date(dayKeyToUtcStart(nextDayKey(dayKey), userTimezone));
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
