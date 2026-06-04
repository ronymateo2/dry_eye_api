import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyClinicalObservations, dyObservationOccurrences } from "../db";
import { parseJson, stringifyNullable } from "../lib/json";

const LAST_OCC_SQL = `(SELECT logged_at FROM dy_observation_occurrences WHERE observation_id = dy_clinical_observations.id ORDER BY logged_at DESC LIMIT 1)`;
const SNIPPET_LIMIT = 3;

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
  use_intensity: number; use_duration: number;
  last_logged_at: string | null;
  last_occurrences: string | null;
  occurrence_count: number; matched_notes?: string | null;
};

export type CreateObservationInput = {
  title: string;
  eye?: string;
  body_zone?: string;
  body_zone_custom?: string;
  category?: string;
  propertiesSchema?: unknown;
  useIntensity?: boolean;
  useDuration?: boolean;
};

export type UpdateObservationInput = {
  title?: string;
  eye?: string;
  body_zone?: string | null;
  body_zone_custom?: string | null;
  category?: string | null;
  propertiesSchema?: unknown;
  useIntensity?: boolean;
  useDuration?: boolean;
};

export type SaveOccurrenceInput = {
  id: string;
  loggedAt: string;
  intensity?: number | null;
  durationMinutes?: number | null;
  notes?: string;
  propertyValues?: unknown;
  links?: unknown;
};

function makeObsSelect() {
  return {
    id: dyClinicalObservations.id,
    title: dyClinicalObservations.title,
    eye: dyClinicalObservations.eye,
    body_zone: dyClinicalObservations.body_zone,
    body_zone_custom: dyClinicalObservations.body_zone_custom,
    category: dyClinicalObservations.category,
    properties_schema: dyClinicalObservations.properties_schema,
    use_intensity: dyClinicalObservations.use_intensity,
    use_duration: dyClinicalObservations.use_duration,
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

export function mapObsRow(r: ObsSelectRow) {
  const rawOccs = parseJson<LastOccurrence[]>(r.last_occurrences) ?? [];
  return {
    id: r.id,
    title: r.title,
    eye: r.eye,
    body_zone: r.body_zone,
    body_zone_custom: r.body_zone_custom,
    category: r.category,
    properties_schema: parseJson(r.properties_schema),
    use_intensity: r.use_intensity === 1,
    use_duration: r.use_duration === 1,
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

export function buildFtsQuery(raw: string): string {
  return raw
    .replace(/["*^()]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w}*`)
    .join(" ");
}

export function validateOccurrenceInput(body: SaveOccurrenceInput): string | null {
  if (
    body.intensity !== undefined &&
    body.intensity !== null &&
    (typeof body.intensity !== "number" || body.intensity < 0 || body.intensity > 10)
  ) {
    return "intensity debe ser 0–10";
  }
  return null;
}

export async function listObservations(db: DrizzleDb, userId: string) {
  const results = await db
    .select(makeObsSelect())
    .from(dyClinicalObservations)
    .where(and(eq(dyClinicalObservations.user_id, userId), isNull(dyClinicalObservations.archived_at)))
    .orderBy(sql`${sql.raw(LAST_OCC_SQL)} DESC NULLS LAST`, desc(dyClinicalObservations.created_at));

  return results.map(mapObsRow);
}

export async function createObservation(db: DrizzleDb, userId: string, body: CreateObservationInput) {
  const id = crypto.randomUUID();
  await db.insert(dyClinicalObservations).values({
    id,
    user_id: userId,
    title: body.title,
    eye: body.eye ?? "none",
    body_zone: body.body_zone ?? null,
    body_zone_custom: body.body_zone_custom ?? null,
    category: body.category ?? null,
    properties_schema: stringifyNullable(body.propertiesSchema),
    use_intensity: body.useIntensity ? 1 : 0,
    use_duration: body.useDuration ? 1 : 0,
    updated_at: new Date().toISOString(),
  });

  return getObservation(db, id);
}

export async function archiveObservation(db: DrizzleDb, userId: string, id: string) {
  const now = new Date().toISOString();
  await db
    .update(dyClinicalObservations)
    .set({ archived_at: now, updated_at: now })
    .where(and(eq(dyClinicalObservations.id, id), eq(dyClinicalObservations.user_id, userId)));
}

export async function updateObservation(
  db: DrizzleDb,
  userId: string,
  id: string,
  body: UpdateObservationInput,
) {
  const now = new Date().toISOString();
  let oldSchema: { id?: string; key: string }[] = [];
  if ("propertiesSchema" in body) {
    const existing = await db
      .select({ properties_schema: dyClinicalObservations.properties_schema })
      .from(dyClinicalObservations)
      .where(and(eq(dyClinicalObservations.id, id), eq(dyClinicalObservations.user_id, userId)))
      .get();
    oldSchema = parseJson<{ id?: string; key: string }[]>(existing?.properties_schema) ?? [];
  }

  const patch: Record<string, unknown> = { updated_at: now };
  if (body.title !== undefined) patch.title = body.title;
  if (body.eye !== undefined) patch.eye = body.eye;
  if ("body_zone" in body) patch.body_zone = body.body_zone ?? null;
  if ("body_zone_custom" in body) patch.body_zone_custom = body.body_zone_custom ?? null;
  if ("category" in body) patch.category = body.category ?? null;
  if ("propertiesSchema" in body) patch.properties_schema = stringifyNullable(body.propertiesSchema);
  if ("useIntensity" in body) patch.use_intensity = body.useIntensity ? 1 : 0;
  if ("useDuration" in body) patch.use_duration = body.useDuration ? 1 : 0;

  await db
    .update(dyClinicalObservations)
    .set(patch)
    .where(and(eq(dyClinicalObservations.id, id), eq(dyClinicalObservations.user_id, userId)));

  if ("propertiesSchema" in body && oldSchema.length > 0) {
    await migrateOccurrencePropertyKeys(db, id, oldSchema, body.propertiesSchema);
  }

  return getObservation(db, id);
}

async function migrateOccurrencePropertyKeys(
  db: DrizzleDb,
  observationId: string,
  oldSchema: { id?: string; key: string }[],
  propertiesSchema: unknown,
) {
  const newSchema = (propertiesSchema as { id?: string; key: string }[] | null) ?? [];
  const oldById = new Map(oldSchema.filter((p) => p.id).map((p) => [p.id!, p.key]));

  for (const newProp of newSchema) {
    if (!newProp.id) continue;
    const oldKey = oldById.get(newProp.id);
    if (!oldKey || oldKey === newProp.key) continue;

    await db.run(sql`
      UPDATE dy_observation_occurrences
      SET property_values = json_set(
        json_remove(property_values, '$.' || ${oldKey}),
        '$.' || ${newProp.key},
        json_extract(property_values, '$.' || ${oldKey})
      )
      WHERE observation_id = ${observationId}
        AND json_extract(property_values, '$.' || ${oldKey}) IS NOT NULL
    `);
  }
}

async function getObservation(db: DrizzleDb, id: string) {
  const row = await db
    .select(makeObsSelect())
    .from(dyClinicalObservations)
    .where(eq(dyClinicalObservations.id, id))
    .get();

  return row ? mapObsRow(row) : null;
}

export async function searchObservations(db: DrizzleDb, userId: string, raw: string) {
  const ftsQuery = buildFtsQuery(raw);
  if (!ftsQuery) return [];

  const results = await db
    .select({
      ...makeObsSelect(),
      matched_notes: sql<string | null>`(
        SELECT json_group_array(json_object('note', n.notes, 'logged_at', n.logged_at, 'property_values', n.property_values))
        FROM (
          SELECT occ_inner.notes, occ_inner.logged_at, occ_inner.property_values
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

  return results.map(mapObsRow);
}

export async function listOccurrenceFeed(db: DrizzleDb, userId: string, limit: number, before: string) {
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

  return { ok: true, occurrences, hasMore };
}

export async function listObservationOccurrences(
  db: DrizzleDb,
  userId: string,
  observationId: string,
  limit: number,
) {
  const results = await db
    .select({
      id: dyObservationOccurrences.id,
      logged_at: dyObservationOccurrences.logged_at,
      intensity: dyObservationOccurrences.intensity,
      duration_minutes: dyObservationOccurrences.duration_minutes,
      notes: dyObservationOccurrences.notes,
      property_values: dyObservationOccurrences.property_values,
      links: dyObservationOccurrences.links,
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

  return results.map((r) => ({
    id: r.id,
    loggedAt: r.logged_at,
    intensity: r.intensity,
    durationMinutes: r.duration_minutes,
    notes: r.notes,
    propertyValues: parseJson(r.property_values),
    links: parseJson(r.links),
  }));
}

export async function saveOccurrence(
  db: DrizzleDb,
  userId: string,
  observationId: string,
  body: SaveOccurrenceInput,
) {
  const now = new Date().toISOString();
  const values = {
    id: body.id,
    user_id: userId,
    observation_id: observationId,
    logged_at: body.loggedAt,
    intensity: body.intensity != null ? Math.round(body.intensity) : null,
    duration_minutes: body.durationMinutes != null ? Math.round(body.durationMinutes) : null,
    notes: body.notes ?? null,
    property_values: stringifyNullable(body.propertyValues),
    links: stringifyNullable(body.links),
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
        duration_minutes: values.duration_minutes,
        notes: values.notes,
        property_values: values.property_values,
        links: values.links,
        updated_at: now,
      },
    });
}

export async function deleteOccurrence(db: DrizzleDb, userId: string, obsId: string, occId: string) {
  await db
    .delete(dyObservationOccurrences)
    .where(
      and(
        eq(dyObservationOccurrences.id, occId),
        eq(dyObservationOccurrences.observation_id, obsId),
        eq(dyObservationOccurrences.user_id, userId),
      ),
    );
}
