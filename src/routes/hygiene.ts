import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import {
  getHygieneDashboard,
  getHygieneSessions,
  getHygieneToday,
  logHygiene,
  type HygieneInput,
} from "../services/hygiene.service";

const hygiene = new Hono<{ Bindings: Env; Variables: Variables }>();

hygiene.use("*", authMiddleware);

hygiene.post("/", async (c) => {
  const body = await c.req.json<HygieneInput>();
  const dayKey = await logHygiene(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"), body);
  return c.json({ ok: true, dayKey });
});

hygiene.get("/today", async (c) => {
  const data = await getHygieneToday(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(data);
});

hygiene.get("/dashboard", async (c) => {
  const data = await getHygieneDashboard(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(data);
});

hygiene.get("/sessions", async (c) => {
  const sessions = await getHygieneSessions(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json({ sessions });
});

export { hygiene };
