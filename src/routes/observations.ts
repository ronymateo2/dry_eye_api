import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyClinicalObservations, dyObservationOccurrences } from "../db";
import { and, eq, isNull, lt, desc, sql } from "drizzle-orm";

const observations = new Hono<{ Bindings: Env; Variables: Variables }>();

observations.use("*", authMiddleware);

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// Raw SQL for correlated subqueries — avoids Drizzle column refs being
// serialized as bind params at module level, which breaks the correlation.
const LAST_OCC_SQL = `(SELECT logged_at FROM dy_observation_occurrences WHERE observation_id = dy_clinical_observations.id ORDER BY logged_at DESC LIMIT 1)`;

// How many recent occurrences to embed in the list response for snippet display.
const SNIPPET_LIMIT = 3;

function makeObsSelect() {
  return {
    id: dyClinicalObservations.id,
    title: dyClinicalObservations.title,
    eye: dyClinicalObservations.eye,
    body_zone: dyClinicalObservations.body_zone,
    body_zone_custom: dyClinicalObservations.body_zone_custom,
    category: dyClinicalObservations.category,
    properties_schema: dyClinicalObservations.properties_schema,
    last_logged_at: sql<string | null>`(SELECT logged_at FROM dy_observation_occurrences WHERE observation_id = dy_clinical_observations.id ORDER BY logged_at DESC LIMIT 1)`.as("last_logged_at"),
    last_occurrences: sql<string | null>`(
      SELECT json_group_array(json_object(
        'intensity', sub.intensity,
        'notes', sub.notes,
        'field_values', sub.property_values,
        'logged_at', sub.logged_at
      ))
      FROM (
        SELECT intensity, notes, property_values, logged_at
        FROM dy_observation_occurrences
        WHERE observation_id = dy_clinical_observations.id
        ORDER BY logged_at DESC
        LIMIT ${SNIPPET_LIMIT}
      ) sub
    )`.as("last_occurrences"),
    occurrence_count: sql<number>`(SELECT COUNT(*) FROM dy_observation_occurrences WHERE observation_id = dy_clinical_observations.id)`.as("occurrence_count"),
  };
}

type LastOccurrence = {
  intensity: number | null;
  notes: string | null;
  field_values: string | null;
  logged_at: string;
};

type ObsSelectRow = {
  id: string; title: string; eye: string;
  body_zone: string | null; body_zone_custom: string | null;
  category: string | null; properties_schema: string | null;
  last_logged_at: string | null;
  last_occurrences: string | null;
  occurrence_count: number; matched_notes?: string | null;
};

function mapObsRow(r: ObsSelectRow) {
  const rawOccs = parseJson<LastOccurrence[]>(r.last_occurrences) ?? [];
  return {
    id: r.id,
    title: r.title,
    eye: r.eye,
    body_zone: r.body_zone,
    body_zone_custom: r.body_zone_custom,
    category: r.category,
    properties_schema: parseJson(r.properties_schema),
    last_logged_at: r.last_logged_at,
    last_occurrences: rawOccs.map((o) => ({
      intensity: o.intensity,
      notes: o.notes,
      field_values: parseJson(o.field_values),
      logged_at: o.logged_at,
    })),
    occurrence_count: r.occurrence_count,
    ...(r.matched_notes !== undefined ? { matched_notes: parseJson(r.matched_notes) } : {}),
  };
}

observations.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const results = await db
    .select(makeObsSelect())
    .from(dyClinicalObservations)
    .where(and(eq(dyClinicalObservations.user_id, userId), isNull(dyClinicalObservations.archived_at)))
    .orderBy(sql`${sql.raw(LAST_OCC_SQL)} DESC NULLS LAST`, desc(dyClinicalObservations.created_at));

  return c.json(results.map(mapObsRow));
});

observations.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    title: string;
    eye?: string;
    body_zone?: string;
    body_zone_custom?: string;
    category?: string;
    propertiesSchema?: unknown;
  }>();
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const id = crypto.randomUUID();
  await db.insert(dyClinicalObservations).values({
    id,
    user_id: userId,
    title: body.title,
    eye: body.eye ?? "none",
    body_zone: body.body_zone ?? null,
    body_zone_custom: body.body_zone_custom ?? null,
    category: body.category ?? null,
    properties_schema: body.propertiesSchema ? JSON.stringify(body.propertiesSchema) : null,
    updated_at: now,
  });

  const row = await db
    .select(makeObsSelect())
    .from(dyClinicalObservations)
    .where(eq(dyClinicalObservations.id, id))
    .get();

  return c.json(row ? mapObsRow(row) : null);
});

observations.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  await db
    .update(dyClinicalObservations)
    .set({ archived_at: now, updated_at: now })
    .where(and(eq(dyClinicalObservations.id, id), eq(dyClinicalObservations.user_id, userId)));

  return c.json({ ok: true });
});

observations.put("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const body = await c.req.json<{
    title?: string;
    eye?: string;
    body_zone?: string | null;
    body_zone_custom?: string | null;
    category?: string | null;
    propertiesSchema?: unknown;
  }>();
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = { updated_at: now };
  if (body.title !== undefined) patch.title = body.title;
  if (body.eye !== undefined) patch.eye = body.eye;
  if ("body_zone" in body) patch.body_zone = body.body_zone ?? null;
  if ("body_zone_custom" in body) patch.body_zone_custom = body.body_zone_custom ?? null;
  if ("category" in body) patch.category = body.category ?? null;
  if ("propertiesSchema" in body) {
    patch.properties_schema = body.propertiesSchema ? JSON.stringify(body.propertiesSchema) : null;
  }

  await db
    .update(dyClinicalObservations)
    .set(patch)
    .where(and(eq(dyClinicalObservations.id, id), eq(dyClinicalObservations.user_id, userId)));

  const row = await db
    .select(makeObsSelect())
    .from(dyClinicalObservations)
    .where(eq(dyClinicalObservations.id, id))
    .get();

  return c.json(row ? mapObsRow(row) : null);
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
      ...makeObsSelect(),
      matched_notes: sql<string | null>`(
        SELECT json_group_array(json_object('note', n.notes, 'logged_at', n.logged_at))
        FROM (
          SELECT occ_inner.notes, occ_inner.logged_at
          FROM dy_observation_occurrences occ_inner
          WHERE occ_inner.observation_id = dy_clinical_observations.id
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
    .orderBy(sql`${sql.raw(LAST_OCC_SQL)} DESC NULLS LAST`, desc(dyClinicalObservations.created_at));

  return c.json(results.map(mapObsRow));
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
      notes: dyObservationOccurrences.notes,
      property_values: dyObservationOccurrences.property_values,
      links: dyObservationOccurrences.links,
      updated_at: dyObservationOccurrences.updated_at,
      title: dyClinicalObservations.title,
      eye: dyClinicalObservations.eye,
      body_zone: dyClinicalObservations.body_zone,
      body_zone_custom: dyClinicalObservations.body_zone_custom,
      properties_schema: dyClinicalObservations.properties_schema,
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
    notes: r.notes,
    propertyValues: parseJson(r.property_values),
    links: parseJson(r.links),
    updatedAt: r.updated_at,
    title: r.title,
    eye: r.eye,
    bodyZone: r.body_zone,
    bodyZoneCustom: r.body_zone_custom,
    propertiesSchema: parseJson(r.properties_schema),
  }));

  return c.json({ ok: true, occurrences, hasMore });
});

observations.get("/:id/occurrences", async (c) => {
  const userId = c.get("userId");
  const { id: observationId } = c.req.param();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "3"), 20);
  const db = getDb(c.env.DB);

  const results = await db
    .select({
      id: dyObservationOccurrences.id,
      logged_at: dyObservationOccurrences.logged_at,
      intensity: dyObservationOccurrences.intensity,
      notes: dyObservationOccurrences.notes,
      property_values: dyObservationOccurrences.property_values,
    })
    .from(dyObservationOccurrences)
    .where(
      and(
        eq(dyObservationOccurrences.user_id, userId),
        eq(dyObservationOccurrences.observation_id, observationId),
      ),
    )
    .orderBy(desc(dyObservationOccurrences.logged_at))
    .limit(limit);

  return c.json(results.map((r) => ({
    id: r.id,
    loggedAt: r.logged_at,
    intensity: r.intensity,
    notes: r.notes,
    propertyValues: parseJson(r.property_values),
  })));
});

observations.post("/:id/occurrences", async (c) => {
  const userId = c.get("userId");
  const { id: observationId } = c.req.param();
  const body = await c.req.json<{
    id: string;
    loggedAt: string;
    intensity: number;
    notes?: string;
    propertyValues?: unknown;
    links?: unknown;
  }>();

  if (typeof body.intensity !== "number" || body.intensity < 0 || body.intensity > 10) {
    return c.text("intensity debe ser 0–10", 400);
  }

  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const values = {
    id: body.id,
    user_id: userId,
    observation_id: observationId,
    logged_at: body.loggedAt,
    intensity: Math.round(body.intensity),
    notes: body.notes ?? null,
    property_values: body.propertyValues ? JSON.stringify(body.propertyValues) : null,
    links: body.links ? JSON.stringify(body.links) : null,
    updated_at: now,
  };

  await db
    .insert(dyObservationOccurrences)
    .values(values)
    .onConflictDoUpdate({
      target: dyObservationOccurrences.id,
      set: {
        logged_at: values.logged_at,
        intensity: values.intensity,
        notes: values.notes,
        property_values: values.property_values,
        links: values.links,
        updated_at: now,
      },
    });

  return c.json({ ok: true });
});

export { observations };
