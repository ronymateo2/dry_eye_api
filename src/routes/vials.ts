import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyVials, dyDropTypes } from "../db";
import { and, eq, desc, sql } from "drizzle-orm";

const vials = new Hono<{ Bindings: Env; Variables: Variables }>();

vials.use("*", authMiddleware);

vials.get("/active", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
    .select({
      id: dyVials.id,
      drop_type_id: dyVials.drop_type_id,
      drop_type_name: dyDropTypes.name,
      started_at: dyVials.started_at,
      ended_at: dyVials.ended_at,
      status: dyVials.status,
      vial_duration: dyDropTypes.vial_duration,
    })
    .from(dyVials)
    .innerJoin(dyDropTypes, eq(dyVials.drop_type_id, dyDropTypes.id))
    .where(and(eq(dyVials.user_id, userId), eq(dyVials.status, "active")))
    .orderBy(desc(dyVials.started_at));

  return c.json(rows);
});

vials.get("/history", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);
  const before = c.req.query("before");
  const db = getDb(c.env.DB);

  const conditions = [eq(dyVials.user_id, userId), eq(dyVials.status, "discarded")];
  if (before) {
    conditions.push(sql`${dyVials.started_at} < ${before}`);
  }

  const rows = await db
    .select({
      id: dyVials.id,
      drop_type_id: dyVials.drop_type_id,
      drop_type_name: dyDropTypes.name,
      started_at: dyVials.started_at,
      ended_at: dyVials.ended_at,
      status: dyVials.status,
      vial_duration: dyDropTypes.vial_duration,
    })
    .from(dyVials)
    .innerJoin(dyDropTypes, eq(dyVials.drop_type_id, dyDropTypes.id))
    .where(and(...conditions))
    .orderBy(desc(dyVials.started_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  return c.json({ ok: true, vials: rows, hasMore });
});

vials.put("/:id/discard", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .update(dyVials)
    .set({ status: "discarded", ended_at: new Date().toISOString() })
    .where(and(eq(dyVials.id, id), eq(dyVials.user_id, userId), eq(dyVials.status, "active")));

  return c.json({ ok: true });
});

export { vials };
