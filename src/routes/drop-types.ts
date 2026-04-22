import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyDropTypes } from "../db";
import { and, eq, sql } from "drizzle-orm";

const dropTypes = new Hono<{ Bindings: Env; Variables: Variables }>();

dropTypes.use("*", authMiddleware);

dropTypes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
    .select({ id: dyDropTypes.id, name: dyDropTypes.name, sort_order: dyDropTypes.sort_order })
    .from(dyDropTypes)
    .where(eq(dyDropTypes.user_id, userId))
    .orderBy(sql`COALESCE(${dyDropTypes.sort_order}, 9999)`, dyDropTypes.name);

  return c.json(rows);
});

dropTypes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name: string }>();
  const db = getDb(c.env.DB);

  const id = crypto.randomUUID();
  await db.insert(dyDropTypes).values({ id, user_id: userId, name: body.name.trim() });

  return c.json({ id, name: body.name.trim() });
});

dropTypes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .delete(dyDropTypes)
    .where(and(eq(dyDropTypes.id, id), eq(dyDropTypes.user_id, userId)));

  return c.json({ ok: true });
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

export { dropTypes };
