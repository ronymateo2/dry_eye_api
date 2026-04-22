import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyTriggers } from "../db";

const triggers = new Hono<{ Bindings: Env; Variables: Variables }>();

triggers.use("*", authMiddleware);

triggers.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    id: string;
    loggedAt: string;
    triggerType: string;
    intensity: number;
    notes?: string;
  }>();
  const db = getDb(c.env.DB);

  await db
    .insert(dyTriggers)
    .values({
      id: body.id,
      user_id: userId,
      logged_at: body.loggedAt,
      trigger_type: body.triggerType,
      intensity: body.intensity,
      notes: body.notes ?? null,
    })
    .onConflictDoNothing();

  return c.json({ ok: true });
});

export { triggers };
