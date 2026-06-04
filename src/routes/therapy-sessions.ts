import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import {
  listTherapySessions,
  saveTherapySession,
  type TherapySessionInput,
} from "../services/therapy-sessions.service";

const therapySessions = new Hono<{ Bindings: Env; Variables: Variables }>();

therapySessions.use("*", authMiddleware);

therapySessions.post("/", async (c) => {
  const body = await c.req.json<TherapySessionInput>();
  await saveTherapySession(getDb(c.env.DB), c.get("userId"), body);
  return c.json({ ok: true });
});

therapySessions.get("/", async (c) => {
  const sessions = await listTherapySessions(getDb(c.env.DB), c.get("userId"), c.req.query("before"));
  return c.json({ ok: true, sessions });
});

export { therapySessions };
