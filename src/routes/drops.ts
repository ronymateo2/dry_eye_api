import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyDrops, dyDropTypes } from "../db";
import { and, eq, isNull, isNotNull, desc, max, sql } from "drizzle-orm";

const drops = new Hono<{ Bindings: Env; Variables: Variables }>();

drops.use("*", authMiddleware);

drops.post("/", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const body = await c.req.json<{
    id: string;
    dropTypeId: string;
    loggedAt: string;
    quantity: number;
    eye: string;
    notes?: string;
  }>();
  const db = getDb(c.env.DB);

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

  return c.json({ ok: true });
});

drops.get("/last", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

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

  if (!row) return c.json(null);

  const loggedAt = new Date(row.logged_at.replace(" ", "T").replace(/\+00$/, "Z")).toISOString();
  return c.json({ ...row, logged_at: loggedAt });
});

drops.get("/last-per-type", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
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

  return c.json(
    rows.map((r) => ({
      ...r,
      last_logged_at: r.last_logged_at
        ? new Date(r.last_logged_at.replace(" ", "T").replace(/\+00$/, "Z")).toISOString()
        : null,
    })),
  );
});

drops.get("/stats-per-type", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const toIso = (s: string | null) =>
    s ? new Date(s.replace(" ", "T").replace(/\+00$/, "Z")).toISOString() : null;

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

  return c.json(
    rows.map((r) => ({
      ...r,
      first_logged_at: toIso(r.first_logged_at),
      last_logged_at: toIso(r.last_logged_at),
    })),
  );
});

drops.get("/recent", async (c) => {
  const userId = c.get("userId");
  const dropTypeId = c.req.query("dropTypeId");
  const hours = Math.min(Number(c.req.query("hours") ?? "24"), 168);
  const hasVial = c.req.query("hasVial") === "true";

  const db = getDb(c.env.DB);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const rows = await db
    .select({
      id: dyDrops.id,
      logged_at: dyDrops.logged_at,
      quantity: dyDrops.quantity,
      eye: dyDrops.eye,
    })
    .from(dyDrops)
    .where(
      and(
        eq(dyDrops.user_id, userId),
        dropTypeId ? eq(dyDrops.drop_type_id, dropTypeId) : undefined,
        sql`${dyDrops.logged_at} > ${since}`,
        hasVial ? isNotNull(dyDrops.vial_id) : undefined,
      ),
    )
    .orderBy(desc(dyDrops.logged_at));

  return c.json(
    rows.map((r) => ({
      ...r,
      logged_at: new Date(r.logged_at.replace(" ", "T").replace(/\+00$/, "Z")).toISOString(),
    })),
  );
});

drops.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb(c.env.DB);

  const result = await db
    .delete(dyDrops)
    .where(and(eq(dyDrops.id, id), eq(dyDrops.user_id, userId)));

  if (result.meta.changes === 0) return c.text("Not found", 404);

  return c.json({ ok: true });
});

export { drops };
