import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import {
  deleteDrop,
  getDropStatsPerType,
  getLastDrop,
  getLastDropPerType,
  getRecentDrops,
  getTodayDrops,
  saveDrop,
  type DropInput,
} from "../services/drops.service";

const drops = new Hono<{ Bindings: Env; Variables: Variables }>();

drops.use("*", authMiddleware);

drops.post("/", async (c) => {
  const body = await c.req.json<DropInput>();
  await saveDrop(getDb(c.env.DB), c.get("userId"), body);
  return c.json({ ok: true });
});

drops.get("/last", async (c) => {
  const row = await getLastDrop(getDb(c.env.DB), c.get("userId"));
  return c.json(row);
});

drops.get("/last-per-type", async (c) => {
  const rows = await getLastDropPerType(getDb(c.env.DB), c.get("userId"));
  return c.json(rows);
});

drops.get("/stats-per-type", async (c) => {
  const rows = await getDropStatsPerType(getDb(c.env.DB), c.get("userId"));
  return c.json(rows);
});

drops.get("/today", async (c) => {
  const rows = await getTodayDrops(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(rows);
});

drops.get("/recent", async (c) => {
  const rows = await getRecentDrops(getDb(c.env.DB), c.get("userId"), {
    dropTypeId: c.req.query("dropTypeId"),
    hours: Math.min(Number(c.req.query("hours") ?? "24"), 168),
    hasVial: c.req.query("hasVial") === "true",
  });
  return c.json(rows);
});

drops.delete("/:id", async (c) => {
  const deleted = await deleteDrop(getDb(c.env.DB), c.get("userId"), c.req.param("id"));
  if (!deleted) return c.text("Not found", 404);
  return c.json({ ok: true });
});

export { drops };
