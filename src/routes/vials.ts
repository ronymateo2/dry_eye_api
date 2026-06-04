import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import {
  deleteVial,
  discardVial,
  getActiveVials,
  getVialHistory,
  openVial,
  type OpenVialInput,
} from "../services/vials.service";

const vials = new Hono<{ Bindings: Env; Variables: Variables }>();

vials.use("*", authMiddleware);

vials.get("/active", async (c) => {
  const rows = await getActiveVials(getDb(c.env.DB), c.get("userId"));
  return c.json(rows);
});

vials.get("/history", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);
  const { vials: rows, hasMore } = await getVialHistory(
    getDb(c.env.DB),
    c.get("userId"),
    limit,
    c.req.query("before"),
  );
  return c.json({ ok: true, vials: rows, hasMore });
});

vials.put("/:id/discard", async (c) => {
  const { id } = c.req.param();
  await discardVial(getDb(c.env.DB), c.get("userId"), id);
  return c.json({ ok: true });
});

vials.post("/", async (c) => {
  const body = await c.req.json<OpenVialInput>();
  const result = await openVial(getDb(c.env.DB), c.get("userId"), body);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ ok: true, id: result.id });
});

vials.delete("/:id", async (c) => {
  await deleteVial(getDb(c.env.DB), c.get("userId"), c.req.param("id"));
  return c.json({ ok: true });
});

export { vials };
