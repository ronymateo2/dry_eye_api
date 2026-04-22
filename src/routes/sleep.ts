import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDayKey } from "../lib/utils";
import { getDb, dySleep } from "../db";
import { and, eq } from "drizzle-orm";

const sleep = new Hono<{ Bindings: Env; Variables: Variables }>();

sleep.use("*", authMiddleware);

sleep.get("/today", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const todayKey = getDayKey(new Date().toISOString(), timezone);
  const db = getDb(c.env.DB);

  const row = await db
    .select({
      id: dySleep.id,
      day_key: dySleep.day_key,
      logged_at: dySleep.logged_at,
      sleep_hours: dySleep.sleep_hours,
      sleep_quality: dySleep.sleep_quality,
    })
    .from(dySleep)
    .where(and(eq(dySleep.user_id, userId), eq(dySleep.day_key, todayKey)))
    .get();

  return c.json(row ?? null);
});

sleep.put("/", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const body = await c.req.json<{
    id: string;
    loggedAt: string;
    sleepHours: number;
    sleepQuality: string;
  }>();
  const db = getDb(c.env.DB);

  const dayKey = getDayKey(body.loggedAt, timezone);
  const values = {
    id: body.id,
    user_id: userId,
    day_key: dayKey,
    logged_at: body.loggedAt,
    sleep_hours: body.sleepHours,
    sleep_quality: body.sleepQuality,
  };

  await db
    .insert(dySleep)
    .values(values)
    .onConflictDoUpdate({
      target: [dySleep.user_id, dySleep.day_key],
      set: {
        id: values.id,
        logged_at: values.logged_at,
        sleep_hours: values.sleep_hours,
        sleep_quality: values.sleep_quality,
      },
    });

  return c.json({ ok: true, dayKey });
});

export { sleep };
