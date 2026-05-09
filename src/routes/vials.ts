import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyVials, dyVialInstances, dyDropTypes } from "../db";
import { and, eq, desc, sql } from "drizzle-orm";

const vials = new Hono<{ Bindings: Env; Variables: Variables }>();

vials.use("*", authMiddleware);

vials.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
    .select({
      id: dyVials.id,
      drop_type_id: dyVials.drop_type_id,
      drop_type_name: dyDropTypes.name,
      duration_hours: dyVials.duration_hours,
      name: dyVials.name,
      created_at: dyVials.created_at,
    })
    .from(dyVials)
    .innerJoin(dyDropTypes, eq(dyVials.drop_type_id, dyDropTypes.id))
    .where(eq(dyVials.user_id, userId))
    .orderBy(desc(dyVials.created_at));

  return c.json(rows);
});

vials.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ id: string; drop_type_id: string; duration_hours?: number; name?: string }>();
  const db = getDb(c.env.DB);

  await db.insert(dyVials).values({
    id: body.id,
    user_id: userId,
    drop_type_id: body.drop_type_id,
    duration_hours: body.duration_hours ?? 24,
    name: body.name?.trim() ?? null,
  });

  return c.json({ ok: true, id: body.id });
});

vials.put("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const body = await c.req.json<{ duration_hours?: number; name?: string }>();
  const db = getDb(c.env.DB);

  const set: { duration_hours?: number; name?: string | null } = {};
  if (body.duration_hours !== undefined) set.duration_hours = body.duration_hours;
  if (body.name !== undefined) set.name = body.name.trim() || null;

  if (Object.keys(set).length === 0) return c.json({ ok: true });

  await db
    .update(dyVials)
    .set(set)
    .where(and(eq(dyVials.id, id), eq(dyVials.user_id, userId)));

  return c.json({ ok: true });
});

vials.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .delete(dyVials)
    .where(and(eq(dyVials.id, id), eq(dyVials.user_id, userId)));

  return c.json({ ok: true });
});

const vialInstances = new Hono<{ Bindings: Env; Variables: Variables }>();

vialInstances.use("*", authMiddleware);

vialInstances.get("/active", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
    .select({
      id: dyVialInstances.id,
      vial_id: dyVialInstances.vial_id,
      started_at: dyVialInstances.started_at,
      ended_at: dyVialInstances.ended_at,
      status: dyVialInstances.status,
      vial_name: dyVials.name,
      drop_type_name: dyDropTypes.name,
      duration_hours: dyVials.duration_hours,
    })
    .from(dyVialInstances)
    .innerJoin(dyVials, eq(dyVialInstances.vial_id, dyVials.id))
    .innerJoin(dyDropTypes, eq(dyVials.drop_type_id, dyDropTypes.id))
    .where(and(eq(dyVialInstances.user_id, userId), eq(dyVialInstances.status, "active")))
    .orderBy(desc(dyVialInstances.started_at));

  return c.json(rows);
});

vialInstances.get("/history", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);
  const before = c.req.query("before");
  const db = getDb(c.env.DB);

  const conditions = [eq(dyVialInstances.user_id, userId), eq(dyVialInstances.status, "discarded")];
  if (before) {
    conditions.push(sql`${dyVialInstances.started_at} < ${before}`);
  }

  const rows = await db
    .select({
      id: dyVialInstances.id,
      vial_id: dyVialInstances.vial_id,
      started_at: dyVialInstances.started_at,
      ended_at: dyVialInstances.ended_at,
      status: dyVialInstances.status,
      vial_name: dyVials.name,
      drop_type_name: dyDropTypes.name,
      duration_hours: dyVials.duration_hours,
    })
    .from(dyVialInstances)
    .innerJoin(dyVials, eq(dyVialInstances.vial_id, dyVials.id))
    .innerJoin(dyDropTypes, eq(dyVials.drop_type_id, dyDropTypes.id))
    .where(and(...conditions))
    .orderBy(desc(dyVialInstances.started_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  return c.json({ ok: true, instances: rows, hasMore });
});

vialInstances.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ id: string; vial_id: string; started_at: string }>();
  const db = getDb(c.env.DB);

  await db
    .update(dyVialInstances)
    .set({ status: "discarded", ended_at: body.started_at })
    .where(
      and(
        eq(dyVialInstances.user_id, userId),
        eq(dyVialInstances.status, "active"),
        eq(dyVialInstances.vial_id, body.vial_id),
      ),
    );

  await db.insert(dyVialInstances).values({
    id: body.id,
    user_id: userId,
    vial_id: body.vial_id,
    started_at: body.started_at,
    status: "active",
  });

  return c.json({ ok: true, id: body.id });
});

vialInstances.put("/:id/discard", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const body = await c.req.json<{ ended_at: string }>();
  const db = getDb(c.env.DB);

  await db
    .update(dyVialInstances)
    .set({ status: "discarded", ended_at: body.ended_at })
    .where(and(eq(dyVialInstances.id, id), eq(dyVialInstances.user_id, userId), eq(dyVialInstances.status, "active")));

  return c.json({ ok: true });
});

export { vials, vialInstances };
