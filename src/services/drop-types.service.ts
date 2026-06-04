import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyDropTypes } from "../db";

export type CreateDropTypeInput = {
  name: string;
  intervalHours?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  suspensionNote?: string | null;
  isVial?: boolean;
  vialDuration?: number | null;
  quickAction?: boolean;
};

export type UpdateDropTypeInput = Omit<CreateDropTypeInput, "name">;

export function listDropTypes(db: DrizzleDb, userId: string) {
  return db
    .select({
      id: dyDropTypes.id,
      name: dyDropTypes.name,
      sort_order: dyDropTypes.sort_order,
      interval_hours: dyDropTypes.interval_hours,
      start_date: dyDropTypes.start_date,
      end_date: dyDropTypes.end_date,
      suspension_note: dyDropTypes.suspension_note,
      is_vial: dyDropTypes.is_vial,
      vial_duration: dyDropTypes.vial_duration,
      quick_action: dyDropTypes.quick_action,
    })
    .from(dyDropTypes)
    .where(and(eq(dyDropTypes.user_id, userId), isNull(dyDropTypes.archived_at)))
    .orderBy(sql`COALESCE(${dyDropTypes.sort_order}, 9999)`, dyDropTypes.name);
}

export async function createDropType(db: DrizzleDb, userId: string, body: CreateDropTypeInput) {
  const id = crypto.randomUUID();
  const name = body.name.trim();
  await db.insert(dyDropTypes).values({
    id,
    user_id: userId,
    name,
    interval_hours: body.intervalHours ?? null,
    start_date: body.startDate ?? null,
    end_date: body.endDate ?? null,
    suspension_note: body.suspensionNote ?? null,
    is_vial: body.isVial ?? false,
    vial_duration: body.vialDuration ?? null,
    quick_action: body.quickAction ?? false,
  });
  return { id, name };
}

export async function reorderDropTypes(db: DrizzleDb, userId: string, ids: string[]) {
  const updates = ids.map((id, i) =>
    db
      .update(dyDropTypes)
      .set({ sort_order: i })
      .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId))),
  );
  if (updates.length === 0) return;
  await db.batch(updates as [(typeof updates)[0], ...typeof updates]);
}

export async function updateDropType(db: DrizzleDb, userId: string, id: string, body: UpdateDropTypeInput) {
  const set: {
    interval_hours?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    suspension_note?: string | null;
    is_vial?: boolean;
    vial_duration?: number | null;
    quick_action?: boolean;
  } = {};
  if (body.intervalHours !== undefined) set.interval_hours = body.intervalHours;
  if (body.startDate !== undefined) set.start_date = body.startDate;
  if (body.endDate !== undefined) set.end_date = body.endDate;
  if (body.suspensionNote !== undefined) set.suspension_note = body.suspensionNote;
  if (body.isVial !== undefined) set.is_vial = body.isVial;
  if (body.vialDuration !== undefined) set.vial_duration = body.vialDuration;
  if (body.quickAction !== undefined) set.quick_action = body.quickAction;

  if (Object.keys(set).length === 0) return;

  await db
    .update(dyDropTypes)
    .set(set)
    .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId)));
}

export async function archiveDropType(db: DrizzleDb, userId: string, id: string) {
  await db
    .update(dyDropTypes)
    .set({ archived_at: new Date().toISOString() })
    .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId)));
}

export function listArchivedDropTypes(db: DrizzleDb, userId: string) {
  return db
    .select({
      id: dyDropTypes.id,
      name: dyDropTypes.name,
      sort_order: dyDropTypes.sort_order,
      interval_hours: dyDropTypes.interval_hours,
      start_date: dyDropTypes.start_date,
      end_date: dyDropTypes.end_date,
      suspension_note: dyDropTypes.suspension_note,
      archived_at: dyDropTypes.archived_at,
      is_vial: dyDropTypes.is_vial,
      vial_duration: dyDropTypes.vial_duration,
    })
    .from(dyDropTypes)
    .where(and(eq(dyDropTypes.user_id, userId), isNotNull(dyDropTypes.archived_at)))
    .orderBy(dyDropTypes.archived_at);
}

export async function unarchiveDropType(db: DrizzleDb, userId: string, id: string) {
  await db
    .update(dyDropTypes)
    .set({ archived_at: null, sort_order: null })
    .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId)));
}
