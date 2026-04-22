import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDayKey } from "../lib/utils";
import { getDb, dyLidHygiene, dyHygieneDaily, dyHygieneStats } from "../db";
import { and, eq, gte, sql } from "drizzle-orm";

const hygiene = new Hono<{ Bindings: Env; Variables: Variables }>();

hygiene.use("*", authMiddleware);

hygiene.post("/", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const body = await c.req.json<{
    id: string;
    loggedAt: string;
    status: string;
    deviationValue: number | null;
    frictionType: string | null;
    userNote?: string;
  }>();
  const db = getDb(c.env.DB);

  const dayKey = getDayKey(body.loggedAt, timezone);

  const rawValues = {
    id: body.id,
    user_id: userId,
    day_key: dayKey,
    logged_at: body.loggedAt,
    status: body.status,
    deviation_value: body.deviationValue ?? null,
    friction_type: body.frictionType ?? null,
    user_note: body.userNote ?? null,
  };

  await db
    .insert(dyLidHygiene)
    .values(rawValues)
    .onConflictDoUpdate({
      target: dyLidHygiene.id,
      set: {
        logged_at: rawValues.logged_at,
        status: rawValues.status,
        deviation_value: rawValues.deviation_value,
        friction_type: rawValues.friction_type,
        user_note: rawValues.user_note,
      },
    });

  const existing = await db
    .select({ completed_count: dyHygieneDaily.completed_count })
    .from(dyHygieneDaily)
    .where(and(eq(dyHygieneDaily.user_id, userId), eq(dyHygieneDaily.day_key, dayKey)))
    .get();

  const newCount = (existing?.completed_count ?? 0) + 1;

  const dailyValues = {
    user_id: userId,
    day_key: dayKey,
    status: body.status,
    deviation_value: body.deviationValue ?? null,
    friction_type: body.frictionType ?? null,
    user_note: body.userNote ?? null,
    last_logged_at: body.loggedAt,
    completed_count: newCount,
  };

  await db
    .insert(dyHygieneDaily)
    .values(dailyValues)
    .onConflictDoUpdate({
      target: [dyHygieneDaily.user_id, dyHygieneDaily.day_key],
      set: {
        status: dailyValues.status,
        deviation_value: dailyValues.deviation_value,
        friction_type: dailyValues.friction_type,
        user_note: dailyValues.user_note,
        last_logged_at: dailyValues.last_logged_at,
        completed_count: dailyValues.completed_count,
      },
    });

  const stats = await db
    .select({ first_day_key: dyHygieneStats.first_day_key, total_completed_days: dyHygieneStats.total_completed_days })
    .from(dyHygieneStats)
    .where(eq(dyHygieneStats.user_id, userId))
    .get();

  const isCompleted = body.status === "completed";
  const wasCompletedBefore = existing !== undefined && body.status !== "completed";

  if (!stats) {
    await db.insert(dyHygieneStats).values({
      user_id: userId,
      first_day_key: dayKey,
      total_completed_days: isCompleted ? 1 : 0,
    });
  } else {
    const delta = isCompleted && !wasCompletedBefore ? 1 : 0;
    await db
      .update(dyHygieneStats)
      .set({
        total_completed_days: sql`${dyHygieneStats.total_completed_days} + ${delta}`,
        last_updated_at: new Date().toISOString(),
      })
      .where(eq(dyHygieneStats.user_id, userId));
  }

  return c.json({ ok: true, dayKey });
});

hygiene.get("/today", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const todayKey = getDayKey(new Date().toISOString(), timezone);
  const db = getDb(c.env.DB);

  const [row, stats] = await db.batch([
    db
      .select({
        day_key: dyHygieneDaily.day_key,
        status: dyHygieneDaily.status,
        deviation_value: dyHygieneDaily.deviation_value,
        friction_type: dyHygieneDaily.friction_type,
        user_note: dyHygieneDaily.user_note,
        last_logged_at: dyHygieneDaily.last_logged_at,
        completed_count: dyHygieneDaily.completed_count,
      })
      .from(dyHygieneDaily)
      .where(and(eq(dyHygieneDaily.user_id, userId), eq(dyHygieneDaily.day_key, todayKey))),
    db
      .select({ first_day_key: dyHygieneStats.first_day_key, total_completed_days: dyHygieneStats.total_completed_days })
      .from(dyHygieneStats)
      .where(eq(dyHygieneStats.user_id, userId)),
  ]);

  return c.json({ today: row[0] ?? null, stats: stats[0] ?? null });
});

hygiene.get("/dashboard", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const todayKey = getDayKey(new Date().toISOString(), timezone);
  const db = getDb(c.env.DB);

  const [statsRows, todayRows, dailyRows] = await db.batch([
    db
      .select({ first_day_key: dyHygieneStats.first_day_key, total_completed_days: dyHygieneStats.total_completed_days })
      .from(dyHygieneStats)
      .where(eq(dyHygieneStats.user_id, userId)),
    db
      .select({ completed_count: dyHygieneDaily.completed_count })
      .from(dyHygieneDaily)
      .where(and(eq(dyHygieneDaily.user_id, userId), eq(dyHygieneDaily.day_key, todayKey))),
    db
      .select({
        day_key: dyHygieneDaily.day_key,
        last_logged_at: dyHygieneDaily.last_logged_at,
        status: dyHygieneDaily.status,
        deviation_value: dyHygieneDaily.deviation_value,
        friction_type: dyHygieneDaily.friction_type,
        user_note: dyHygieneDaily.user_note,
        completed_count: dyHygieneDaily.completed_count,
      })
      .from(dyHygieneDaily)
      .where(
        and(
          eq(dyHygieneDaily.user_id, userId),
          gte(dyHygieneDaily.day_key, sql`date(${todayKey}, '-42 days')`),
        ),
      )
      .orderBy(sql`${dyHygieneDaily.day_key} DESC`),
  ]);

  const stats = statsRows[0] ?? null;
  const today = todayRows[0] ?? null;

  const recentRecords = dailyRows.map((r) => ({
    dayKey: r.day_key,
    loggedAt: r.last_logged_at,
    status: r.status,
    deviationValue: r.deviation_value,
    frictionType: r.friction_type,
    userNote: r.user_note,
    completedCount: r.completed_count,
  }));

  return c.json({
    firstDayKey: stats?.first_day_key ?? null,
    totalCompletedDays: stats?.total_completed_days ?? 0,
    todayCompletedCount: today?.completed_count ?? 0,
    recentRecords,
  });
});

hygiene.get("/sessions", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const todayKey = getDayKey(new Date().toISOString(), timezone);
  const db = getDb(c.env.DB);

  const rows = await db
    .select({
      day_key: dyLidHygiene.day_key,
      logged_at: dyLidHygiene.logged_at,
      status: dyLidHygiene.status,
      deviation_value: dyLidHygiene.deviation_value,
      friction_type: dyLidHygiene.friction_type,
      user_note: dyLidHygiene.user_note,
    })
    .from(dyLidHygiene)
    .where(
      and(
        eq(dyLidHygiene.user_id, userId),
        gte(dyLidHygiene.day_key, sql`date(${todayKey}, '-21 days')`),
      ),
    )
    .orderBy(sql`${dyLidHygiene.logged_at} DESC`);

  const sessions = rows.map((r) => ({
    dayKey: r.day_key,
    loggedAt: r.logged_at,
    status: r.status,
    deviationValue: r.deviation_value,
    frictionType: r.friction_type,
    userNote: r.user_note,
    completedCount: 1,
  }));

  return c.json({ sessions });
});

export { hygiene };
