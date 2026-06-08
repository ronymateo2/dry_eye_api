import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dySymptoms, dySymptomEntries } from "../db";
import { calcSymptomState, type SymptomIntensities } from "../lib/symptom-state";
import { buildLastDayKeys } from "../lib/utils";

export type LegacySymptomInput = { id: string; loggedAt: string; symptomType: string; notes?: string };

export type SymptomEntryInput = {
  id: string;
  logged_at: string;
  day_key: string;
  intensities: SymptomIntensities;
  triggers?: string[];
  note?: string;
};

type EntryRow = typeof dySymptomEntries.$inferSelect;

function mapEntryRow(r: EntryRow) {
  return {
    id: r.id,
    logged_at: r.logged_at,
    day_key: r.day_key,
    intensities: {
      dryness: r.dryness,
      burning: r.burning,
      photophobia: r.photophobia,
      blurry_vision: r.blurry_vision,
      stinging: r.stinging ?? undefined,
      pressure: r.pressure ?? undefined,
    },
    triggers: r.triggers ? (JSON.parse(r.triggers) as string[]) : [],
    note: r.note,
    calculated_state: r.calculated_state,
    created_at: r.created_at,
  };
}

export async function saveLegacySymptom(db: DrizzleDb, userId: string, body: LegacySymptomInput) {
  await db
    .insert(dySymptoms)
    .values({
      id: body.id,
      user_id: userId,
      logged_at: body.loggedAt,
      symptom_type: body.symptomType,
      notes: body.notes ?? null,
    })
    .onConflictDoNothing();
}

export async function saveSymptomEntry(db: DrizzleDb, userId: string, body: SymptomEntryInput) {
  const state = calcSymptomState(body.intensities);

  await db
    .insert(dySymptomEntries)
    .values({
      id: body.id,
      user_id: userId,
      logged_at: body.logged_at,
      day_key: body.day_key,
      dryness: body.intensities.dryness,
      burning: body.intensities.burning,
      photophobia: body.intensities.photophobia,
      blurry_vision: body.intensities.blurry_vision,
      stinging: body.intensities.stinging ?? null,
      pressure: body.intensities.pressure ?? null,
      triggers: body.triggers ? JSON.stringify(body.triggers) : null,
      note: body.note ?? null,
      calculated_state: state,
    })
    .onConflictDoUpdate({
      target: dySymptomEntries.id,
      set: {
        logged_at: sql`excluded.logged_at`,
        day_key: sql`excluded.day_key`,
        dryness: sql`excluded.dryness`,
        burning: sql`excluded.burning`,
        photophobia: sql`excluded.photophobia`,
        blurry_vision: sql`excluded.blurry_vision`,
        stinging: sql`excluded.stinging`,
        pressure: sql`excluded.pressure`,
        triggers: sql`excluded.triggers`,
        note: sql`excluded.note`,
        calculated_state: sql`excluded.calculated_state`,
      },
    });

  return state;
}

export const symptomEntriesQuery = (db: DrizzleDb, userId: string, oldest: string) =>
  db
    .select()
    .from(dySymptomEntries)
    .where(and(eq(dySymptomEntries.user_id, userId), gte(dySymptomEntries.day_key, oldest)))
    .orderBy(desc(dySymptomEntries.logged_at));

export async function getSymptomsToday(db: DrizzleDb, userId: string, timezone: string) {
  const dayKeys7 = buildLastDayKeys(timezone, 7);
  const rows = await symptomEntriesQuery(db, userId, dayKeys7[0]);
  return buildTodaySummary(dayKeys7, rows);
}

export function buildTodaySummary(dayKeys7: string[], rows: EntryRow[]) {
  const latest = rows[0] ?? null;

  const dayMap = new Map<string, number[]>();
  for (const r of rows) {
    const vals = [
      r.dryness, r.burning, r.photophobia, r.blurry_vision,
      r.stinging ?? 0, r.pressure ?? 0,
    ].filter((v) => v > 0);
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const existing = dayMap.get(r.day_key) ?? [];
    existing.push(avg);
    dayMap.set(r.day_key, existing);
  }

  const trend_7d = dayKeys7.map((dk) => {
    const avgs = dayMap.get(dk) ?? [];
    const avg_intensity = avgs.length > 0 ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 0;
    const state = calcSymptomState({
      dryness: Math.round(avg_intensity),
      burning: 0,
      photophobia: 0,
      blurry_vision: 0,
    });
    return { day_key: dk, avg_intensity: Math.round(avg_intensity * 10) / 10, state };
  });

  const top_symptoms = latest
    ? (
        [
          { key: "dryness" as const, value: latest.dryness },
          { key: "burning" as const, value: latest.burning },
          { key: "photophobia" as const, value: latest.photophobia },
          { key: "blurry_vision" as const, value: latest.blurry_vision },
          { key: "stinging" as const, value: latest.stinging ?? 0 },
          { key: "pressure" as const, value: latest.pressure ?? 0 },
        ]
          .filter((x) => x.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
      )
    : [];

  return { ok: true, latest: latest ? mapEntryRow(latest) : null, trend_7d, top_symptoms };
}

export async function listSymptomEntries(
  db: DrizzleDb,
  userId: string,
  limit: number,
  from: string | undefined,
  to: string | undefined,
) {
  const conditions = [eq(dySymptomEntries.user_id, userId)];
  if (from) conditions.push(gte(dySymptomEntries.logged_at, from));
  if (to) conditions.push(sql`${dySymptomEntries.logged_at} <= ${to}`);

  const rows = await db
    .select()
    .from(dySymptomEntries)
    .where(and(...conditions))
    .orderBy(desc(dySymptomEntries.logged_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  return { entries: rows.map(mapEntryRow), hasMore };
}
