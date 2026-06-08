import { and, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyDrops, dyDropTypes } from "../db";
import { dbTimestampToIso } from "../lib/dates";

export type DropInput = {
  id: string;
  dropTypeId: string;
  loggedAt: string;
  quantity: number;
  eye: string;
  notes?: string;
};

export type RecentDropsQuery = {
  dropTypeId?: string;
  hours: number;
  hasVial: boolean;
};

export async function saveDrop(db: DrizzleDb, userId: string, body: DropInput) {
  const values = {
    id: body.id,
    user_id: userId,
    drop_type_id: body.dropTypeId,
    logged_at: body.loggedAt,
    quantity: body.quantity,
    eye: body.eye,
    notes: body.notes ?? null,
  };

  await db
    .insert(dyDrops)
    .values(values)
    .onConflictDoUpdate({
      target: dyDrops.id,
      set: {
        drop_type_id: values.drop_type_id,
        logged_at: values.logged_at,
        quantity: values.quantity,
        eye: values.eye,
        notes: values.notes,
      },
    });
}

export async function getLastDrop(db: DrizzleDb, userId: string) {
  const row = await db
    .select({
      id: dyDrops.id,
      logged_at: dyDrops.logged_at,
      quantity: dyDrops.quantity,
      eye: dyDrops.eye,
      drop_type_name: dyDropTypes.name,
      drop_type_id: dyDropTypes.id,
    })
    .from(dyDrops)
    .innerJoin(dyDropTypes, eq(dyDrops.drop_type_id, dyDropTypes.id))
    .where(eq(dyDrops.user_id, userId))
    .orderBy(desc(dyDrops.logged_at))
    .limit(1)
    .get();

  if (!row) return null;
  return { ...row, logged_at: dbTimestampToIso(row.logged_at) };
}

export const lastDropPerTypeQuery = (db: DrizzleDb, userId: string) =>
  db
    .select({
      drop_type_id: dyDropTypes.id,
      name: dyDropTypes.name,
      interval_hours: dyDropTypes.interval_hours,
      end_date: dyDropTypes.end_date,
      is_vial: dyDropTypes.is_vial,
      last_logged_at: max(dyDrops.logged_at),
    })
    .from(dyDropTypes)
    .leftJoin(dyDrops, eq(dyDrops.drop_type_id, dyDropTypes.id))
    .where(and(eq(dyDropTypes.user_id, userId), isNull(dyDropTypes.archived_at)))
    .groupBy(dyDropTypes.id, dyDropTypes.name, dyDropTypes.interval_hours, dyDropTypes.end_date)
    .orderBy(sql`${dyDropTypes.sort_order} IS NULL`, dyDropTypes.sort_order, dyDropTypes.name);

export function mapLastDropPerType(rows: Awaited<ReturnType<typeof lastDropPerTypeQuery>>) {
  return rows.map((r) => ({
    ...r,
    last_logged_at: r.last_logged_at ? dbTimestampToIso(r.last_logged_at) : null,
  }));
}

export async function getLastDropPerType(db: DrizzleDb, userId: string) {
  return mapLastDropPerType(await lastDropPerTypeQuery(db, userId));
}

export async function getDropStatsPerType(db: DrizzleDb, userId: string) {
  const rows = await db
    .select({
      drop_type_id: dyDropTypes.id,
      name: dyDropTypes.name,
      sort_order: dyDropTypes.sort_order,
      interval_hours: dyDropTypes.interval_hours,
      first_logged_at: sql<string | null>`MIN(${dyDrops.logged_at})`,
      last_logged_at: max(dyDrops.logged_at),
      total_uses: sql<number>`COUNT(${dyDrops.id})`,
      total_quantity: sql<number>`COALESCE(SUM(${dyDrops.quantity}), 0)`,
      uses_left: sql<number>`COALESCE(SUM(CASE WHEN ${dyDrops.eye}='left' THEN 1 ELSE 0 END), 0)`,
      uses_right: sql<number>`COALESCE(SUM(CASE WHEN ${dyDrops.eye}='right' THEN 1 ELSE 0 END), 0)`,
      uses_both: sql<number>`COALESCE(SUM(CASE WHEN ${dyDrops.eye}='both' THEN 1 ELSE 0 END), 0)`,
    })
    .from(dyDropTypes)
    .leftJoin(dyDrops, eq(dyDrops.drop_type_id, dyDropTypes.id))
    .where(and(eq(dyDropTypes.user_id, userId), isNull(dyDropTypes.archived_at)))
    .groupBy(dyDropTypes.id, dyDropTypes.name, dyDropTypes.sort_order, dyDropTypes.interval_hours)
    .orderBy(sql`COALESCE(${dyDropTypes.sort_order}, 9999)`, dyDropTypes.name);

  return rows.map((r) => ({
    ...r,
    first_logged_at: r.first_logged_at ? dbTimestampToIso(r.first_logged_at) : null,
    last_logged_at: r.last_logged_at ? dbTimestampToIso(r.last_logged_at) : null,
  }));
}

export const recentDropsQuery = (
  db: DrizzleDb,
  userId: string,
  since: string,
  opts?: { dropTypeId?: string; hasVial?: boolean },
) =>
  db
    .select({
      id: dyDrops.id,
      logged_at: dyDrops.logged_at,
      quantity: dyDrops.quantity,
      eye: dyDrops.eye,
      drop_type_id: dyDrops.drop_type_id,
    })
    .from(dyDrops)
    .where(
      and(
        eq(dyDrops.user_id, userId),
        opts?.dropTypeId ? eq(dyDrops.drop_type_id, opts.dropTypeId) : undefined,
        sql`${dyDrops.logged_at} > ${since}`,
        opts?.hasVial ? isNotNull(dyDrops.vial_id) : undefined,
      ),
    )
    .orderBy(desc(dyDrops.logged_at));

export function mapRecentDrops(rows: Awaited<ReturnType<typeof recentDropsQuery>>) {
  return rows.map((r) => ({ ...r, logged_at: dbTimestampToIso(r.logged_at) }));
}

export async function getRecentDrops(db: DrizzleDb, userId: string, query: RecentDropsQuery) {
  const since = new Date(Date.now() - query.hours * 3_600_000).toISOString();
  return mapRecentDrops(
    await recentDropsQuery(db, userId, since, { dropTypeId: query.dropTypeId, hasVial: query.hasVial }),
  );
}

export async function deleteDrop(db: DrizzleDb, userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(dyDrops)
    .where(and(eq(dyDrops.id, id), eq(dyDrops.user_id, userId)));
  return result.meta.changes > 0;
}
