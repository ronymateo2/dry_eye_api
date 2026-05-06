import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyTherapySessions } from "../db";
import { and, eq, gte, lt, desc } from "drizzle-orm";

const therapySessions = new Hono<{ Bindings: Env; Variables: Variables }>();

therapySessions.use("*", authMiddleware);

therapySessions.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ id: string; loggedAt: string; therapyType?: string; notes?: string | null }>();
  const db = getDb(c.env.DB);

  await db.insert(dyTherapySessions).values({
    id: body.id,
    user_id: userId,
    logged_at: body.loggedAt,
    therapy_type: body.therapyType ?? "miofascial",
    notes: body.notes ?? null,
  });

  return c.json({ ok: true });
});

therapySessions.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);
  const before = c.req.query("before");
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const rows = await db
    .select({
      id: dyTherapySessions.id,
      logged_at: dyTherapySessions.logged_at,
      therapy_type: dyTherapySessions.therapy_type,
      notes: dyTherapySessions.notes,
    })
    .from(dyTherapySessions)
    .where(
      and(
        eq(dyTherapySessions.user_id, userId),
        gte(dyTherapySessions.logged_at, cutoff),
        ...(before ? [lt(dyTherapySessions.logged_at, before)] : []),
      ),
    )
    .orderBy(desc(dyTherapySessions.logged_at))
    .limit(50);

  return c.json({ ok: true, sessions: rows });
});

export { therapySessions };
