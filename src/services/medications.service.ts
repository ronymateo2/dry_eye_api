import { and, asc, eq, gte, isNotNull, isNull, lt, max, sql } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyMedications, dyMedicationIntakes } from "../db";
import { getDayKey, dayKeyToUtcStart } from "../lib/utils";
import { dbTimestampToIso } from "../lib/dates";
import { findMedicationsNeedingRenewal } from "../lib/medication-calendar";

const RENEWAL_WINDOW_DAYS = 30;

export type MedicationInput = {
  name?: string;
  dosage?: string | null;
  frequency?: string | null;
  notes?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  phasesJson?: string | null;
  timesJson?: string[] | null;
};

export type IntakeInput = {
  id: string;
  medicationId: string;
  loggedAt: string;
  dosageTaken?: string | null;
  notes?: string | null;
};

export function timesToColumn(times: string[] | null | undefined): string | null | undefined {
  if (times === undefined) return undefined;
  if (times === null || times.length === 0) return null;
  return JSON.stringify(times);
}

export function listMedications(db: DrizzleDb, userId: string) {
  return db
    .select({
      id: dyMedications.id,
      name: dyMedications.name,
      dosage: dyMedications.dosage,
      frequency: dyMedications.frequency,
      notes: dyMedications.notes,
      sort_order: dyMedications.sort_order,
      start_date: dyMedications.start_date,
      end_date: dyMedications.end_date,
      phases_json: dyMedications.phases_json,
      times_json: dyMedications.times_json,
    })
    .from(dyMedications)
    .where(and(eq(dyMedications.user_id, userId), isNull(dyMedications.archived_at)))
    .orderBy(sql`COALESCE(${dyMedications.sort_order}, 9999)`, dyMedications.created_at);
}

export function findRenewalCandidates(db: DrizzleDb, userId: string): Promise<string[]> {
  const threshold = new Date(Date.now() + RENEWAL_WINDOW_DAYS * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
  return findMedicationsNeedingRenewal(db, userId, threshold);
}

export async function createMedication(db: DrizzleDb, userId: string, input: MedicationInput) {
  const id = crypto.randomUUID();
  await db.insert(dyMedications).values({
    id,
    user_id: userId,
    name: input.name ?? "",
    dosage: input.dosage ?? null,
    frequency: input.frequency ?? null,
    notes: input.notes ?? null,
    start_date: input.startDate ?? null,
    end_date: input.endDate ?? null,
    phases_json: input.phasesJson ?? null,
    times_json: timesToColumn(input.timesJson) ?? null,
  });

  const needsSync = Boolean(input.timesJson && input.timesJson.length > 0);
  return {
    record: {
      id,
      name: input.name ?? "",
      dosage: input.dosage ?? null,
      frequency: input.frequency ?? null,
      notes: input.notes ?? null,
    },
    needsSync,
  };
}

export async function reorderMedications(db: DrizzleDb, userId: string, ids: string[]) {
  const updates = ids.map((id, i) =>
    db
      .update(dyMedications)
      .set({ sort_order: i })
      .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId))),
  );
  if (updates.length === 0) return;
  await db.batch(updates as [(typeof updates)[0], ...typeof updates]);
}

export async function updateMedication(
  db: DrizzleDb,
  userId: string,
  id: string,
  input: MedicationInput,
): Promise<{ needsSync: boolean }> {
  const set: {
    name?: string;
    dosage?: string | null;
    frequency?: string | null;
    notes?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    phases_json?: string | null;
    times_json?: string | null;
  } = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.dosage !== undefined) set.dosage = input.dosage;
  if (input.frequency !== undefined) set.frequency = input.frequency;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.startDate !== undefined) set.start_date = input.startDate;
  if (input.endDate !== undefined) set.end_date = input.endDate;
  if (input.phasesJson !== undefined) set.phases_json = input.phasesJson;
  const timesCol = timesToColumn(input.timesJson);
  if (timesCol !== undefined) set.times_json = timesCol;

  if (Object.keys(set).length === 0) return { needsSync: false };

  await db
    .update(dyMedications)
    .set(set)
    .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId)));

  const needsSync =
    input.timesJson !== undefined ||
    input.phasesJson !== undefined ||
    input.startDate !== undefined ||
    input.endDate !== undefined ||
    input.dosage !== undefined ||
    input.name !== undefined;

  return { needsSync };
}

export async function archiveMedication(db: DrizzleDb, userId: string, id: string) {
  await db
    .update(dyMedications)
    .set({ archived_at: new Date().toISOString() })
    .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId)));
}

export function listArchivedMedications(db: DrizzleDb, userId: string) {
  return db
    .select({
      id: dyMedications.id,
      name: dyMedications.name,
      dosage: dyMedications.dosage,
      frequency: dyMedications.frequency,
      notes: dyMedications.notes,
      sort_order: dyMedications.sort_order,
      start_date: dyMedications.start_date,
      end_date: dyMedications.end_date,
      phases_json: dyMedications.phases_json,
      times_json: dyMedications.times_json,
      archived_at: dyMedications.archived_at,
    })
    .from(dyMedications)
    .where(and(eq(dyMedications.user_id, userId), isNotNull(dyMedications.archived_at)))
    .orderBy(dyMedications.archived_at);
}

export async function unarchiveMedication(db: DrizzleDb, userId: string, id: string) {
  await db
    .update(dyMedications)
    .set({ archived_at: null, sort_order: null })
    .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId)));
}

export async function saveIntake(db: DrizzleDb, userId: string, input: IntakeInput) {
  const values = {
    id: input.id,
    user_id: userId,
    medication_id: input.medicationId,
    logged_at: input.loggedAt,
    dosage_taken: input.dosageTaken ?? null,
    notes: input.notes ?? null,
  };

  await db
    .insert(dyMedicationIntakes)
    .values(values)
    .onConflictDoUpdate({
      target: dyMedicationIntakes.id,
      set: {
        logged_at: values.logged_at,
        dosage_taken: values.dosage_taken,
        notes: values.notes,
      },
    });
}

export function todayIntakesWindow(timezone: string) {
  const todayKey = getDayKey(new Date().toISOString(), timezone);
  const startUtc = dayKeyToUtcStart(todayKey, timezone);
  const endUtc = new Date(new Date(startUtc).getTime() + 86_400_000).toISOString();
  return { startUtc, endUtc };
}

export const todayIntakesQuery = (db: DrizzleDb, userId: string, startUtc: string, endUtc: string) =>
  db
    .select({
      id: dyMedicationIntakes.id,
      medication_id: dyMedicationIntakes.medication_id,
      logged_at: dyMedicationIntakes.logged_at,
      dosage_taken: dyMedicationIntakes.dosage_taken,
      notes: dyMedicationIntakes.notes,
    })
    .from(dyMedicationIntakes)
    .where(
      and(
        eq(dyMedicationIntakes.user_id, userId),
        gte(dyMedicationIntakes.logged_at, startUtc),
        lt(dyMedicationIntakes.logged_at, endUtc),
      ),
    )
    .orderBy(asc(dyMedicationIntakes.logged_at));

export function mapTodayIntakes(rows: Awaited<ReturnType<typeof todayIntakesQuery>>) {
  return rows.map((r) => ({ ...r, logged_at: dbTimestampToIso(r.logged_at) }));
}

export async function getTodayIntakes(db: DrizzleDb, userId: string, timezone: string) {
  const { startUtc, endUtc } = todayIntakesWindow(timezone);
  return mapTodayIntakes(await todayIntakesQuery(db, userId, startUtc, endUtc));
}

export const lastIntakePerMedQuery = (db: DrizzleDb, userId: string) =>
  db
    .select({
      medication_id: dyMedicationIntakes.medication_id,
      last_logged_at: max(dyMedicationIntakes.logged_at),
    })
    .from(dyMedicationIntakes)
    .where(eq(dyMedicationIntakes.user_id, userId))
    .groupBy(dyMedicationIntakes.medication_id);

export function mapLastIntakePerMed(rows: Awaited<ReturnType<typeof lastIntakePerMedQuery>>) {
  return rows.map((r) => ({
    ...r,
    last_logged_at: r.last_logged_at ? dbTimestampToIso(r.last_logged_at) : null,
  }));
}

export async function getLastIntakePerMed(db: DrizzleDb, userId: string) {
  return mapLastIntakePerMed(await lastIntakePerMedQuery(db, userId));
}

export async function deleteIntake(db: DrizzleDb, userId: string, id: string) {
  await db
    .delete(dyMedicationIntakes)
    .where(and(eq(dyMedicationIntakes.id, id), eq(dyMedicationIntakes.user_id, userId)));
}
