import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { getLastCheckIn, saveCheckIn, type CheckInInput } from "../services/check-ins.service";

const checkIns = new Hono<{ Bindings: Env; Variables: Variables }>();

checkIns.use("*", authMiddleware);

checkIns.post("/", async (c) => {
  const body = await c.req.json<CheckInInput>();
  await saveCheckIn(getDb(c.env.DB), c.get("userId"), body);
  return c.json({ ok: true });
});

checkIns.get("/last", async (c) => {
  const row = await getLastCheckIn(getDb(c.env.DB), c.get("userId"));
  return c.json(row);
});

export { checkIns };
