import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dySleep } from "../db";
import { getDayKey } from "../lib/utils";

export type SleepInput = {
  id: string;
  loggedAt: string;
  sleepHours: number;
  sleepQuality: string;
};

export async function getSleepToday(db: DrizzleDb, userId: string, timezone: string) {
  const todayKey = getDayKey(new Date().toISOString(), timezone);

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

  return row ?? null;
}

export async function upsertSleep(db: DrizzleDb, userId: string, timezone: string, body: SleepInput) {
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

  return dayKey;
}
