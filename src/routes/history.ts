import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { getInitialHistory, getMoreHistory } from "../services/history.service";
import { parseLimit } from "../lib/http";

const history = new Hono<{ Bindings: Env; Variables: Variables }>();

history.use("*", authMiddleware);

history.get("/", async (c) => {
  const data = await getInitialHistory(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(data);
});

history.get("/more", async (c) => {
  const beforeDayKey = c.req.query("before") ?? "";
  if (!beforeDayKey) return c.json({ ok: false, error: "Missing before param" }, 400);

  const data = await getMoreHistory(
    getDb(c.env.DB),
    c.get("userId"),
    c.get("userTimezone"),
    beforeDayKey,
    parseLimit(c.req.query("limit"), 5, 50),
  );
  return c.json(data);
});

export { history };
