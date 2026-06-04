import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import {
  archiveDropType,
  createDropType,
  listArchivedDropTypes,
  listDropTypes,
  reorderDropTypes,
  unarchiveDropType,
  updateDropType,
  type CreateDropTypeInput,
  type UpdateDropTypeInput,
} from "../services/drop-types.service";

const dropTypes = new Hono<{ Bindings: Env; Variables: Variables }>();

dropTypes.use("*", authMiddleware);

dropTypes.get("/", async (c) => {
  const rows = await listDropTypes(getDb(c.env.DB), c.get("userId"));
  return c.json(rows);
});

dropTypes.post("/", async (c) => {
  const body = await c.req.json<CreateDropTypeInput>();
  const created = await createDropType(getDb(c.env.DB), c.get("userId"), body);
  return c.json(created);
});

dropTypes.put("/reorder", async (c) => {
  const body = await c.req.json<{ ids: string[] }>();
  await reorderDropTypes(getDb(c.env.DB), c.get("userId"), body.ids);
  return c.json({ ok: true });
});

dropTypes.put("/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<UpdateDropTypeInput>();
  await updateDropType(getDb(c.env.DB), c.get("userId"), id, body);
  return c.json({ ok: true });
});

dropTypes.delete("/:id", async (c) => {
  const { id } = c.req.param();
  await archiveDropType(getDb(c.env.DB), c.get("userId"), id);
  return c.json({ ok: true });
});

dropTypes.get("/archived", async (c) => {
  const rows = await listArchivedDropTypes(getDb(c.env.DB), c.get("userId"));
  return c.json(rows);
});

dropTypes.post("/:id/unarchive", async (c) => {
  const { id } = c.req.param();
  await unarchiveDropType(getDb(c.env.DB), c.get("userId"), id);
  return c.json({ ok: true });
});

export { dropTypes };
