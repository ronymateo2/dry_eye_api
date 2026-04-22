import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dySymptoms } from "../db";

const symptoms = new Hono<{ Bindings: Env; Variables: Variables }>();

symptoms.use("*", authMiddleware);

symptoms.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    id: string;
    loggedAt: string;
    symptomType: string;
    notes?: string;
  }>();
  const db = getDb(c.env.DB);

  await db
    .insert(dySymptoms)
    .values({
      id: body.id,
      user_id: userId,
      logged_at: body.loggedAt,
      symptom_type: body.symptomType,
      notes: body.notes ?? null,
    })
    .onConflictDoNothing();

  return c.json({ ok: true });
});

export { symptoms };
