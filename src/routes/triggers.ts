import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { saveTrigger, type TriggerInput } from "../services/triggers.service";

const triggers = new Hono<{ Bindings: Env; Variables: Variables }>();

triggers.use("*", authMiddleware);

triggers.post("/", async (c) => {
  const body = await c.req.json<TriggerInput>();
  await saveTrigger(getDb(c.env.DB), c.get("userId"), body);
  return c.json({ ok: true });
});

export { triggers };
