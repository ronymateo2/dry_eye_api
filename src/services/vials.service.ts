import { and, desc, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyVials, dyDropTypes, dyDrops } from "../db";

const vialSelect = {
  id: dyVials.id,
  drop_type_id: dyVials.drop_type_id,
  drop_type_name: dyDropTypes.name,
  started_at: dyVials.started_at,
  ended_at: dyVials.ended_at,
  status: dyVials.status,
  vial_duration: dyDropTypes.vial_duration,
};

export type OpenVialInput = { id: string; dropTypeId: string; startedAt: string; dropId?: string };

export function getActiveVials(db: DrizzleDb, userId: string) {
  return db
    .select(vialSelect)
    .from(dyVials)
    .innerJoin(dyDropTypes, eq(dyVials.drop_type_id, dyDropTypes.id))
    .where(and(eq(dyVials.user_id, userId), eq(dyVials.status, "active")))
    .orderBy(desc(dyVials.started_at));
}

export async function getVialHistory(
  db: DrizzleDb,
  userId: string,
  limit: number,
  before: string | undefined,
) {
  const conditions = [eq(dyVials.user_id, userId), eq(dyVials.status, "discarded")];
  if (before) conditions.push(sql`${dyVials.started_at} < ${before}`);

  const rows = await db
    .select(vialSelect)
    .from(dyVials)
    .innerJoin(dyDropTypes, eq(dyVials.drop_type_id, dyDropTypes.id))
    .where(and(...conditions))
    .orderBy(desc(dyVials.started_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  return { vials: rows, hasMore };
}

export async function discardVial(db: DrizzleDb, userId: string, id: string) {
  await db
    .update(dyVials)
    .set({ status: "discarded", ended_at: new Date().toISOString() })
    .where(and(eq(dyVials.id, id), eq(dyVials.user_id, userId), eq(dyVials.status, "active")));
}

export async function openVial(
  db: DrizzleDb,
  userId: string,
  body: OpenVialInput,
): Promise<{ ok: false; error: string } | { ok: true; id: string }> {
  const dropType = await db
    .select({ is_vial: dyDropTypes.is_vial, vial_duration: dyDropTypes.vial_duration })
    .from(dyDropTypes)
    .where(and(eq(dyDropTypes.id, body.dropTypeId), eq(dyDropTypes.user_id, userId)))
    .get();

  if (!dropType?.is_vial) {
    return { ok: false, error: "El tipo de gota no es un vial desechable" };
  }

  const activeVial = await db
    .select()
    .from(dyVials)
    .where(
      and(
        eq(dyVials.user_id, userId),
        eq(dyVials.drop_type_id, body.dropTypeId),
        eq(dyVials.status, "active"),
      ),
    )
    .orderBy(desc(dyVials.started_at))
    .limit(1)
    .get();

  if (activeVial) {
    await db
      .update(dyVials)
      .set({ status: "discarded", ended_at: body.startedAt })
      .where(eq(dyVials.id, activeVial.id));
  }

  await db.insert(dyVials).values({
    id: body.id,
    drop_type_id: body.dropTypeId,
    user_id: userId,
    started_at: body.startedAt,
    status: "active",
  });

  if (body.dropId) {
    await db
      .update(dyDrops)
      .set({ vial_id: body.id })
      .where(and(eq(dyDrops.id, body.dropId), eq(dyDrops.user_id, userId)));
  }

  return { ok: true, id: body.id };
}

export async function deleteVial(db: DrizzleDb, userId: string, id: string) {
  await db
    .update(dyDrops)
    .set({ vial_id: null })
    .where(and(eq(dyDrops.vial_id, id), eq(dyDrops.user_id, userId)));

  await db.delete(dyVials).where(and(eq(dyVials.id, id), eq(dyVials.user_id, userId)));
}
