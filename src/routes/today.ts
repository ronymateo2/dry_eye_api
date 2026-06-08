import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { getTodayBundle } from "../services/today.service";

const today = new Hono<{ Bindings: Env; Variables: Variables }>();

today.use("*", authMiddleware);

today.get("/", async (c) => {
  const bundle = await getTodayBundle(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(bundle);
});

export { today };
