import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { getSleepToday, upsertSleep, type SleepInput } from "../services/sleep.service";

const sleep = new Hono<{ Bindings: Env; Variables: Variables }>();

sleep.use("*", authMiddleware);

sleep.get("/today", async (c) => {
  const row = await getSleepToday(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(row);
});

sleep.put("/", async (c) => {
  const body = await c.req.json<SleepInput>();
  const dayKey = await upsertSleep(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"), body);
  return c.json({ ok: true, dayKey });
});

export { sleep };
