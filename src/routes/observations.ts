import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyClinicalObservations, dyObservationOccurrences } from "../db";
import { and, eq, isNull, lt, desc, sql } from "drizzle-orm";

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
      body_zone: dyClinicalObservations.body_zone,
      category: dyClinicalObservations.category,
      notes: dyClinicalObservations.notes,
      last_logged_at: sql<string | null>`MAX(${dyObservationOccurrences.logged_at})`.as("last_logged_at"),
      occurrence_count: sql<number>`COUNT(${dyObservationOccurrences.id})`.as("occurrence_count"),
    })
    .from(dyClinicalObservations)
    .leftJoin(
      dyObservationOccurrences,
      eq(dyObservationOccurrences.observation_id, dyClinicalObservations.id),
    )
    .where(and(eq(dyClinicalObservations.user_id, userId), isNull(dyClinicalObservations.archived_at)))
    .groupBy(dyClinicalObservations.id)
    .orderBy(
      sql`MAX(${dyObservationOccurrences.logged_at}) DESC NULLS LAST`,
      desc(dyClinicalObservations.created_at),
    );

  return c.json(results);
});

observations.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ title: string; eye?: string; body_zone?: string; category?: string; notes?: string }>();
  const db = getDb(c.env.DB);

  const id = crypto.randomUUID();
  await db.insert(dyClinicalObservations).values({
    id,
    user_id: userId,
    title: body.title,
    eye: body.eye ?? "none",
    body_zone: body.body_zone ?? null,
    category: body.category ?? null,
    notes: body.notes ?? null,
  });

  const row = await db
    .select({
      id: dyClinicalObservations.id,
      title: dyClinicalObservations.title,
      eye: dyClinicalObservations.eye,
      body_zone: dyClinicalObservations.body_zone,
      category: dyClinicalObservations.category,
      notes: dyClinicalObservations.notes,
    })
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
    .update(dyClinicalObservations)
    .set({ archived_at: new Date().toISOString() })
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
      body_zone: dyClinicalObservations.body_zone,
      category: dyClinicalObservations.category,
      notes: dyClinicalObservations.notes,
      last_logged_at: sql<string | null>`MAX(${dyObservationOccurrences.logged_at})`.as("last_logged_at"),
      occurrence_count: sql<number>`COUNT(${dyObservationOccurrences.id})`.as("occurrence_count"),
      matched_notes: sql<string | null>`(
        SELECT json_group_array(n.notes)
        FROM (
          SELECT occ_inner.notes
          FROM dy_observation_occurrences occ_inner
          WHERE occ_inner.observation_id = ${dyClinicalObservations.id}
            AND occ_inner.rowid IN (
              SELECT rowid FROM dy_observation_occurrences_fts
              WHERE dy_observation_occurrences_fts MATCH ${ftsQuery}
            )
          ORDER BY occ_inner.logged_at DESC
          LIMIT 5
        ) n
      )`.as("matched_notes"),
    })
    .from(dyClinicalObservations)
    .leftJoin(dyObservationOccurrences, eq(dyObservationOccurrences.observation_id, dyClinicalObservations.id))
    .where(
      and(
        eq(dyClinicalObservations.user_id, userId),
        isNull(dyClinicalObservations.archived_at),
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
      trigger_type: dyObservationOccurrences.trigger_type,
      pain_quality: dyObservationOccurrences.pain_quality,
      notes: dyObservationOccurrences.notes,
      title: dyClinicalObservations.title,
      eye: dyClinicalObservations.eye,
      body_zone: dyClinicalObservations.body_zone,
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
    triggerType: r.trigger_type,
    painQuality: r.pain_quality,
    notes: r.notes,
    title: r.title,
    eye: r.eye,
    bodyZone: r.body_zone,
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
    triggerType?: string | null;
    painQuality?: string | null;
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
    trigger_type: body.triggerType ?? null,
    pain_quality: body.painQuality ?? null,
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
        trigger_type: values.trigger_type,
        pain_quality: values.pain_quality,
        notes: values.notes,
      },
    });

  return c.json({ ok: true });
});

export { observations };
