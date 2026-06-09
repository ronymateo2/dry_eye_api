import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyUsers } from "../db";

export type UserUpdateInput = { timezone?: string; name?: string; theme?: string; font?: string };

export function getUserMe(db: DrizzleDb, userId: string) {
  return db
    .select({
      id: dyUsers.id,
      name: dyUsers.name,
      email: dyUsers.email,
      image: dyUsers.image,
      timezone: dyUsers.timezone,
      theme: dyUsers.theme,
      font: dyUsers.font,
      notifications_enabled: dyUsers.notifications_enabled,
      quiet_start: dyUsers.quiet_start,
      quiet_end: dyUsers.quiet_end,
      created_at: dyUsers.created_at,
    })
    .from(dyUsers)
    .where(eq(dyUsers.id, userId))
    .get();
}

export async function updateUserMe(db: DrizzleDb, userId: string, body: UserUpdateInput) {
  const set: UserUpdateInput = {};
  if (body.timezone !== undefined) set.timezone = body.timezone;
  if (body.name !== undefined) set.name = body.name;
  if (body.theme !== undefined) set.theme = body.theme;
  if (body.font !== undefined) set.font = body.font;

  if (Object.keys(set).length === 0) return null;

  await db.update(dyUsers).set(set).where(eq(dyUsers.id, userId));

  const row = await db
    .select({
      id: dyUsers.id,
      name: dyUsers.name,
      email: dyUsers.email,
      image: dyUsers.image,
      timezone: dyUsers.timezone,
      theme: dyUsers.theme,
      font: dyUsers.font,
    })
    .from(dyUsers)
    .where(eq(dyUsers.id, userId))
    .get();

  return { row: row ?? null, timezoneChanged: set.timezone !== undefined };
}
