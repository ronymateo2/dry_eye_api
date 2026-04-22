import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyDrops, dyDropTypes } from "../db";
import { eq, desc } from "drizzle-orm";

const drops = new Hono<{ Bindings: Env; Variables: Variables }>();

drops.use("*", authMiddleware);

drops.post("/", async (c) => {
  const userId = c.get("userId");
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

export { drops };
