import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyDropTypes } from "../db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

const dropTypes = new Hono<{ Bindings: Env; Variables: Variables }>();

dropTypes.use("*", authMiddleware);

dropTypes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
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
    })
    .from(dyDropTypes)
    .where(and(eq(dyDropTypes.user_id, userId), isNull(dyDropTypes.archived_at)))
    .orderBy(sql`COALESCE(${dyDropTypes.sort_order}, 9999)`, dyDropTypes.name);

  return c.json(rows);
});

dropTypes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name: string; intervalHours?: number | null; startDate?: string | null; endDate?: string | null; suspensionNote?: string | null; isVial?: boolean; vialDuration?: number | null }>();
  const db = getDb(c.env.DB);

  const id = crypto.randomUUID();
  await db.insert(dyDropTypes).values({
    id,
    user_id: userId,
    name: body.name.trim(),
    interval_hours: body.intervalHours ?? null,
    start_date: body.startDate ?? null,
    end_date: body.endDate ?? null,
    suspension_note: body.suspensionNote ?? null,
    is_vial: body.isVial ?? false,
    vial_duration: body.vialDuration ?? null,
  });

  return c.json({ id, name: body.name.trim() });
});

dropTypes.put("/reorder", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ ids: string[] }>();
  const db = getDb(c.env.DB);

  const updates = body.ids.map((id, i) =>
    db
      .update(dyDropTypes)
      .set({ sort_order: i })
      .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId))),
  );

  await db.batch(updates as [typeof updates[0], ...typeof updates]);
  return c.json({ ok: true });
});

dropTypes.put("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const body = await c.req.json<{ intervalHours?: number | null; startDate?: string | null; endDate?: string | null; suspensionNote?: string | null; isVial?: boolean; vialDuration?: number | null }>();
  const db = getDb(c.env.DB);

  const set: { interval_hours?: number | null; start_date?: string | null; end_date?: string | null; suspension_note?: string | null; is_vial?: boolean; vial_duration?: number | null } = {};
  if (body.intervalHours !== undefined) set.interval_hours = body.intervalHours;
  if (body.startDate !== undefined) set.start_date = body.startDate;
  if (body.endDate !== undefined) set.end_date = body.endDate;
  if (body.suspensionNote !== undefined) set.suspension_note = body.suspensionNote;
  if (body.isVial !== undefined) set.is_vial = body.isVial;
  if (body.vialDuration !== undefined) set.vial_duration = body.vialDuration;

  if (Object.keys(set).length === 0) return c.json({ ok: true });

  await db
    .update(dyDropTypes)
    .set(set)
    .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId)));

  return c.json({ ok: true });
});

dropTypes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .update(dyDropTypes)
    .set({ archived_at: new Date().toISOString() })
    .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId)));

  return c.json({ ok: true });
});

dropTypes.get("/archived", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
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

  return c.json(rows);
});

dropTypes.post("/:id/unarchive", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .update(dyDropTypes)
    .set({ archived_at: null, sort_order: null })
    .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId)));

  return c.json({ ok: true });
});

export { dropTypes };
