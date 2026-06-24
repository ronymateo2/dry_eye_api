import { eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyUsers } from "../db";

export type UserUpdateInput = {
  timezone?: string;
  name?: string;
  theme?: string;
  font?: string;
  widgetDropTypeIds?: string[];
  todayWidgetConfig?: { id: string; visible: boolean }[];
};

function parseWidgetDropTypeIds(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseTodayWidgetConfig(
  raw: string | null | undefined,
): { id: string; visible: boolean }[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is { id: string; visible: boolean } =>
        !!x &&
        typeof x === "object" &&
        typeof x.id === "string" &&
        typeof x.visible === "boolean",
    );
  } catch {
    return [];
  }
}

export async function getUserMe(db: DrizzleDb, userId: string) {
  const row = await db
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
      widget_drop_type_ids: dyUsers.widget_drop_type_ids,
      today_widget_config: dyUsers.today_widget_config,
      created_at: dyUsers.created_at,
    })
    .from(dyUsers)
    .where(eq(dyUsers.id, userId))
    .get();

  if (!row) return row;
  return {
    ...row,
    widget_drop_type_ids: parseWidgetDropTypeIds(row.widget_drop_type_ids),
    today_widget_config: parseTodayWidgetConfig(row.today_widget_config),
  };
}

export async function updateUserMe(db: DrizzleDb, userId: string, body: UserUpdateInput) {
  const set: Partial<typeof dyUsers.$inferInsert> = {};
  if (body.timezone !== undefined) set.timezone = body.timezone;
  if (body.name !== undefined) set.name = body.name;
  if (body.theme !== undefined) set.theme = body.theme;
  if (body.font !== undefined) set.font = body.font;
  if (body.widgetDropTypeIds !== undefined)
    set.widget_drop_type_ids = JSON.stringify(body.widgetDropTypeIds);
  if (body.todayWidgetConfig !== undefined)
    set.today_widget_config = JSON.stringify(body.todayWidgetConfig);

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
      token_version: dyUsers.token_version,
    })
    .from(dyUsers)
    .where(eq(dyUsers.id, userId))
    .get();

  return { row: row ?? null, timezoneChanged: set.timezone !== undefined };
}

// Revoca todas las sesiones del usuario incrementando token_version: cualquier
// JWT emitido antes queda inválido en authMiddleware. Devuelve la versión nueva.
export async function revokeSessions(db: DrizzleDb, userId: string): Promise<number> {
  await db
    .update(dyUsers)
    .set({ token_version: sql`${dyUsers.token_version} + 1` })
    .where(eq(dyUsers.id, userId));

  const row = await db
    .select({ token_version: dyUsers.token_version })
    .from(dyUsers)
    .where(eq(dyUsers.id, userId))
    .get();

  return row?.token_version ?? 0;
}
