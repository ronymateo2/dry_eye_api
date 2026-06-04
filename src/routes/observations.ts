import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { ok, parseLimit } from "../lib/http";
import {
  archiveObservation,
  createObservation,
  deleteOccurrence,
  listObservationOccurrences,
  listObservations,
  listOccurrenceFeed,
  saveOccurrence,
  searchObservations,
  updateObservation,
  validateOccurrenceInput,
  type CreateObservationInput,
  type SaveOccurrenceInput,
  type UpdateObservationInput,
} from "../services/observations.service";

const observations = new Hono<{ Bindings: Env; Variables: Variables }>();

observations.use("*", authMiddleware);

observations.get("/", async (c) => {
  return c.json(await listObservations(getDb(c.env.DB), c.get("userId")));
});

observations.post("/", async (c) => {
  const body = await c.req.json<CreateObservationInput>();
  return c.json(await createObservation(getDb(c.env.DB), c.get("userId"), body));
});

observations.delete("/:id", async (c) => {
  await archiveObservation(getDb(c.env.DB), c.get("userId"), c.req.param("id"));
  return c.json(ok);
});

observations.put("/:id", async (c) => {
  const body = await c.req.json<UpdateObservationInput>();
  return c.json(await updateObservation(getDb(c.env.DB), c.get("userId"), c.req.param("id"), body));
});

observations.get("/search", async (c) => {
  const raw = c.req.query("q")?.trim() ?? "";
  if (!raw) return c.json([]);
  return c.json(await searchObservations(getDb(c.env.DB), c.get("userId"), raw));
});

observations.get("/occurrences", async (c) => {
  const before = c.req.query("before") ?? new Date().toISOString();
  const data = await listOccurrenceFeed(
    getDb(c.env.DB),
    c.get("userId"),
    parseLimit(c.req.query("limit"), 5, 50),
    before,
  );
  return c.json(data);
});

observations.get("/:id/occurrences", async (c) => {
  const data = await listObservationOccurrences(
    getDb(c.env.DB),
    c.get("userId"),
    c.req.param("id"),
    parseLimit(c.req.query("limit"), 3, 20),
  );
  return c.json(data);
});

observations.post("/:id/occurrences", async (c) => {
  const body = await c.req.json<SaveOccurrenceInput>();
  const validationError = validateOccurrenceInput(body);
  if (validationError) return c.text(validationError, 400);

  await saveOccurrence(getDb(c.env.DB), c.get("userId"), c.req.param("id"), body);
  return c.json(ok);
});

observations.delete("/:obsId/occurrences/:occId", async (c) => {
  const { obsId, occId } = c.req.param();
  await deleteOccurrence(getDb(c.env.DB), c.get("userId"), obsId, occId);
  return c.json(ok);
});

export { observations };
