import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyClinicalObservations, dyObservationOccurrences } from "../db";
import { and, eq, lt, desc, sql } from "drizzle-orm";

const observations = new Hono<{ Bindings: Env; Variables: Variables }>();

observations.use("*", authMiddleware);

observations.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const results = await db
    .select({
      id: dyClinicalObservations.id,
      title: dyClinicalObservations.title,
      eye: dyClinicalObservations.eye,
      notes: dyClinicalObservations.notes,
      last_logged_at: sql<string | null>`MAX(${dyObservationOccurrences.logged_at})`.as("last_logged_at"),
      occurrence_count: sql<number>`COUNT(${dyObservationOccurrences.id})`.as("occurrence_count"),
    })
    .from(dyClinicalObservations)
    .leftJoin(
      dyObservationOccurrences,
      eq(dyObservationOccurrences.observation_id, dyClinicalObservations.id),
    )
    .where(eq(dyClinicalObservations.user_id, userId))
    .groupBy(dyClinicalObservations.id)
    .orderBy(
      sql`MAX(${dyObservationOccurrences.logged_at}) DESC NULLS LAST`,
      desc(dyClinicalObservations.created_at),
    );

  return c.json(results);
});

observations.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ title: string; eye?: string; notes?: string }>();
  const db = getDb(c.env.DB);

  const id = crypto.randomUUID();
  await db.insert(dyClinicalObservations).values({
    id,
    user_id: userId,
    title: body.title,
    eye: body.eye ?? "none",
    notes: body.notes ?? null,
  });

  const row = await db
    .select({ id: dyClinicalObservations.id, title: dyClinicalObservations.title, eye: dyClinicalObservations.eye, notes: dyClinicalObservations.notes })
    .from(dyClinicalObservations)
    .where(eq(dyClinicalObservations.id, id))
    .get();

  return c.json(row);
});

observations.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .delete(dyClinicalObservations)
    .where(and(eq(dyClinicalObservations.id, id), eq(dyClinicalObservations.user_id, userId)));

  return c.json({ ok: true });
});

observations.get("/search", async (c) => {
  const userId = c.get("userId");
  const raw = c.req.query("q")?.trim() ?? "";
  if (!raw) return c.json([]);

  const db = getDb(c.env.DB);
  const ftsQuery = raw
    .replace(/["*^()]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w}*`)
    .join(" ");

  if (!ftsQuery) return c.json([]);

  const results = await db
    .select({
      id: dyClinicalObservations.id,
      title: dyClinicalObservations.title,
      eye: dyClinicalObservations.eye,
      notes: dyClinicalObservations.notes,
      last_logged_at: sql<string | null>`MAX(${dyObservationOccurrences.logged_at})`.as("last_logged_at"),
      occurrence_count: sql<number>`COUNT(${dyObservationOccurrences.id})`.as("occurrence_count"),
    })
    .from(dyClinicalObservations)
    .leftJoin(dyObservationOccurrences, eq(dyObservationOccurrences.observation_id, dyClinicalObservations.id))
    .where(
      and(
        eq(dyClinicalObservations.user_id, userId),
        sql`(
          ${dyClinicalObservations.id} IN (
            SELECT obs.id FROM dy_clinical_observations obs
            JOIN dy_clinical_observations_fts fts ON fts.rowid = obs.rowid
            WHERE dy_clinical_observations_fts MATCH ${ftsQuery}
          )
          OR ${dyClinicalObservations.id} IN (
            SELECT occ.observation_id FROM dy_observation_occurrences occ
            JOIN dy_observation_occurrences_fts fts ON fts.rowid = occ.rowid
            WHERE dy_observation_occurrences_fts MATCH ${ftsQuery}
          )
        )`,
      ),
    )
    .groupBy(dyClinicalObservations.id)
    .orderBy(
      sql`MAX(${dyObservationOccurrences.logged_at}) DESC NULLS LAST`,
      desc(dyClinicalObservations.created_at),
    );

  return c.json(results);
});

observations.get("/occurrences", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "5"), 50);
  const before = c.req.query("before") ?? new Date().toISOString();
  const db = getDb(c.env.DB);

  const results = await db
    .select({
      id: dyObservationOccurrences.id,
      observation_id: dyObservationOccurrences.observation_id,
      logged_at: dyObservationOccurrences.logged_at,
      intensity: dyObservationOccurrences.intensity,
      duration_minutes: dyObservationOccurrences.duration_minutes,
      notes: dyObservationOccurrences.notes,
      title: dyClinicalObservations.title,
      eye: dyClinicalObservations.eye,
    })
    .from(dyObservationOccurrences)
    .innerJoin(
      dyClinicalObservations,
      eq(dyObservationOccurrences.observation_id, dyClinicalObservations.id),
    )
    .where(and(eq(dyObservationOccurrences.user_id, userId), lt(dyObservationOccurrences.logged_at, before)))
    .orderBy(desc(dyObservationOccurrences.logged_at))
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const occurrences = results.slice(0, limit).map((r) => ({
    id: r.id,
    observationId: r.observation_id,
    loggedAt: r.logged_at,
    intensity: r.intensity,
    durationMinutes: r.duration_minutes,
    notes: r.notes,
    title: r.title,
    eye: r.eye,
  }));

  return c.json({ ok: true, occurrences, hasMore });
});

observations.post("/:id/occurrences", async (c) => {
  const userId = c.get("userId");
  const { id: observationId } = c.req.param();
  const body = await c.req.json<{
    id: string;
    loggedAt: string;
    intensity: number;
    durationMinutes?: number | null;
    notes?: string;
  }>();
  const db = getDb(c.env.DB);

  const values = {
    id: body.id,
    user_id: userId,
    observation_id: observationId,
    logged_at: body.loggedAt,
    intensity: body.intensity,
    duration_minutes: body.durationMinutes ?? null,
    notes: body.notes ?? null,
  };

  await db
    .insert(dyObservationOccurrences)
    .values(values)
    .onConflictDoUpdate({
      target: dyObservationOccurrences.id,
      set: {
        logged_at: values.logged_at,
        intensity: values.intensity,
        duration_minutes: values.duration_minutes,
        notes: values.notes,
      },
    });

  return c.json({ ok: true });
});

export { observations };
