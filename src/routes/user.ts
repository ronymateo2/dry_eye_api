import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyUsers } from "../db";
import { eq } from "drizzle-orm";
import { signToken, makePayload } from "../lib/jwt";

const user = new Hono<{ Bindings: Env; Variables: Variables }>();

user.use("*", authMiddleware);

user.get("/me", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const row = await db
    .select({
      id: dyUsers.id,
      name: dyUsers.name,
      email: dyUsers.email,
      image: dyUsers.image,
      timezone: dyUsers.timezone,
      theme: dyUsers.theme,
      created_at: dyUsers.created_at,
    })
    .from(dyUsers)
    .where(eq(dyUsers.id, userId))
    .get();

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

user.put("/me", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ timezone?: string; name?: string; theme?: string }>();
  const db = getDb(c.env.DB);

  const set: { timezone?: string; name?: string; theme?: string } = {};
  if (body.timezone !== undefined) set.timezone = body.timezone;
  if (body.name !== undefined) set.name = body.name;
  if (body.theme !== undefined) set.theme = body.theme;

  if (Object.keys(set).length === 0) return c.json({ ok: true });

  await db.update(dyUsers).set(set).where(eq(dyUsers.id, userId));

  const row = await db
    .select({
      id: dyUsers.id,
      name: dyUsers.name,
      email: dyUsers.email,
      image: dyUsers.image,
      timezone: dyUsers.timezone,
      theme: dyUsers.theme,
    })
    .from(dyUsers)
    .where(eq(dyUsers.id, userId))
    .get();

  if (set.timezone && row) {
    const token = await signToken(makePayload(userId, row.timezone), c.env.JWT_SECRET);
    return c.json({ ...row, token });
  }

  return c.json(row);
});

export { user };
