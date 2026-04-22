import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyMedications } from "../db";
import { and, eq, sql } from "drizzle-orm";

const medications = new Hono<{ Bindings: Env; Variables: Variables }>();

medications.use("*", authMiddleware);

medications.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
    .select({
      id: dyMedications.id,
      name: dyMedications.name,
      dosage: dyMedications.dosage,
      frequency: dyMedications.frequency,
      notes: dyMedications.notes,
      sort_order: dyMedications.sort_order,
    })
    .from(dyMedications)
    .where(eq(dyMedications.user_id, userId))
    .orderBy(sql`COALESCE(${dyMedications.sort_order}, 9999)`, dyMedications.created_at);

  return c.json(rows);
});

medications.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    name: string;
    dosage?: string;
    frequency?: string;
    notes?: string;
  }>();
  const db = getDb(c.env.DB);

  const id = crypto.randomUUID();
  await db.insert(dyMedications).values({
    id,
    user_id: userId,
    name: body.name,
    dosage: body.dosage ?? null,
    frequency: body.frequency ?? null,
    notes: body.notes ?? null,
  });

  return c.json({ id, name: body.name, dosage: body.dosage ?? null, frequency: body.frequency ?? null, notes: body.notes ?? null });
});

medications.put("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const body = await c.req.json<{
    name?: string;
    dosage?: string | null;
    frequency?: string | null;
    notes?: string | null;
  }>();
  const db = getDb(c.env.DB);

  const set: { name?: string; dosage?: string | null; frequency?: string | null; notes?: string | null } = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.dosage !== undefined) set.dosage = body.dosage;
  if (body.frequency !== undefined) set.frequency = body.frequency;
  if (body.notes !== undefined) set.notes = body.notes;

  if (Object.keys(set).length === 0) return c.json({ ok: true });

  await db
    .update(dyMedications)
    .set(set)
    .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId)));

  return c.json({ ok: true });
});

medications.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .delete(dyMedications)
    .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId)));

  return c.json({ ok: true });
});

medications.put("/reorder", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ ids: string[] }>();
  const db = getDb(c.env.DB);

  const updates = body.ids.map((id, i) =>
    db
      .update(dyMedications)
      .set({ sort_order: i })
      .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId))),
  );

  await db.batch(updates as [typeof updates[0], ...typeof updates]);
  return c.json({ ok: true });
});

export { medications };
