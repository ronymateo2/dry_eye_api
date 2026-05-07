import { and, eq, lte } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import {
  dyAccounts,
  dyMedications,
  dyMedicationCalendarEvents,
} from "../db";
import type { Env } from "../types";
import {
  getValidAccessToken,
  createRecurringMedicationEvent,
  deleteCalendarEvent,
} from "./calendar";

type MedicationPhase = {
  label: string;
  dosage: string;
  start_date: string;
  end_date: string | null;
};

type Segment = {
  phaseIndex: number | null;
  startDate: string;
  untilDate: string;
  dosage: string | null;
  label: string | null;
};

const ONE_YEAR_DAYS = 365;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function parseTimesJson(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string" && /^\d{2}:\d{2}$/.test(t));
  } catch {
    return [];
  }
}

function parsePhasesJson(json: string | null): MedicationPhase[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed as MedicationPhase[];
  } catch {
    return [];
  }
}

function buildSegments(med: {
  start_date: string | null;
  end_date: string | null;
  dosage: string | null;
  phases_json: string | null;
}): Segment[] {
  const today = todayDateString();
  const phases = parsePhasesJson(med.phases_json);
  const defaultUntil = med.end_date ?? addDaysToDate(today, ONE_YEAR_DAYS);

  if (phases.length === 0) {
    const start = maxDate(med.start_date ?? today, today);
    if (start > defaultUntil) return [];
    return [
      {
        phaseIndex: null,
        startDate: start,
        untilDate: defaultUntil,
        dosage: med.dosage,
        label: null,
      },
    ];
  }

  const segs: Segment[] = [];
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (!p.start_date) continue;
    const start = maxDate(p.start_date, today);
    const until = p.end_date ?? defaultUntil;
    if (start > until) continue;
    segs.push({
      phaseIndex: i,
      startDate: start,
      untilDate: until,
      dosage: p.dosage || med.dosage,
      label: p.label || null,
    });
  }
  return segs;
}

function buildSummary(name: string, seg: Segment): string {
  const parts: string[] = [name];
  if (seg.dosage) parts.push(`(${seg.dosage})`);
  if (seg.label) parts.push(`— ${seg.label}`);
  return `Medicamento: ${parts.join(" ")}`;
}

export async function syncMedicationCalendar(
  db: DrizzleDb,
  env: Env,
  userId: string,
  userTimezone: string,
  medicationId: string,
): Promise<{ created: number; deleted: number; skipped?: string }> {
  if (env.CALENDAR_SYNC_DISABLED === "true") {
    return { created: 0, deleted: 0, skipped: "disabled" };
  }

  const account = await db
    .select({ calendar_authorized: dyAccounts.calendar_authorized })
    .from(dyAccounts)
    .where(and(eq(dyAccounts.user_id, userId), eq(dyAccounts.provider, "google")))
    .get();

  if (!account?.calendar_authorized) {
    return { created: 0, deleted: 0, skipped: "not_authorized" };
  }

  const med = await db
    .select({
      id: dyMedications.id,
      name: dyMedications.name,
      dosage: dyMedications.dosage,
      notes: dyMedications.notes,
      start_date: dyMedications.start_date,
      end_date: dyMedications.end_date,
      phases_json: dyMedications.phases_json,
      times_json: dyMedications.times_json,
      archived_at: dyMedications.archived_at,
    })
    .from(dyMedications)
    .where(and(eq(dyMedications.id, medicationId), eq(dyMedications.user_id, userId)))
    .get();

  if (!med) return { created: 0, deleted: 0, skipped: "not_found" };

  const accessToken = await getValidAccessToken(db, userId, env);
  if (!accessToken) return { created: 0, deleted: 0, skipped: "token_unavailable" };

  const existing = await db
    .select({
      id: dyMedicationCalendarEvents.id,
      google_event_id: dyMedicationCalendarEvents.google_event_id,
    })
    .from(dyMedicationCalendarEvents)
    .where(
      and(
        eq(dyMedicationCalendarEvents.user_id, userId),
        eq(dyMedicationCalendarEvents.medication_id, medicationId),
      ),
    );

  let deleted = 0;
  if (existing.length > 0) {
    await Promise.allSettled(
      existing.map((e) => deleteCalendarEvent(accessToken, e.google_event_id)),
    );
    await db
      .delete(dyMedicationCalendarEvents)
      .where(
        and(
          eq(dyMedicationCalendarEvents.user_id, userId),
          eq(dyMedicationCalendarEvents.medication_id, medicationId),
        ),
      );
    deleted = existing.length;
  }

  const times = parseTimesJson(med.times_json);
  if (med.archived_at || times.length === 0) {
    return { created: 0, deleted };
  }

  const segments = buildSegments(med);
  if (segments.length === 0) return { created: 0, deleted };

  let created = 0;
  for (const seg of segments) {
    for (const timeSlot of times) {
      const eventId = await createRecurringMedicationEvent(accessToken, {
        summary: buildSummary(med.name, seg),
        description: med.notes ?? undefined,
        startDate: seg.startDate,
        untilDate: seg.untilDate,
        timeSlot,
        timezone: userTimezone,
      });
      if (!eventId) continue;
      await db.insert(dyMedicationCalendarEvents).values({
        id: crypto.randomUUID(),
        user_id: userId,
        medication_id: medicationId,
        phase_index: seg.phaseIndex,
        time_slot: timeSlot,
        google_event_id: eventId,
        rrule_until: seg.untilDate,
      });
      created++;
    }
  }

  return { created, deleted };
}

export async function findMedicationsNeedingRenewal(
  db: DrizzleDb,
  userId: string,
  thresholdDate: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ medication_id: dyMedicationCalendarEvents.medication_id })
    .from(dyMedicationCalendarEvents)
    .where(
      and(
        eq(dyMedicationCalendarEvents.user_id, userId),
        lte(dyMedicationCalendarEvents.rrule_until, thresholdDate),
      ),
    );
  return rows.map((r) => r.medication_id);
}
