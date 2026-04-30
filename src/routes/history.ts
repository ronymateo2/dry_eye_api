import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDayKey, dayKeyToUtcStart } from "../lib/utils";
import { getDb, dyCheckIns, dyDrops, dyDropTypes, dyTriggers, dySymptoms, dyObservationOccurrences, dyClinicalObservations, dySleep, dyHygieneDaily, dyLidHygiene } from "../db";
import { and, eq, gte, lt, desc } from "drizzle-orm";

const history = new Hono<{ Bindings: Env; Variables: Variables }>();

history.use("*", authMiddleware);

history.get("/", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const db = getDb(c.env.DB);

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const yesterdayKey = getDayKey(yesterday, timezone);
  const utcWindowStart = dayKeyToUtcStart(yesterdayKey, timezone);

  const [checkInsRows, dropsRows, triggersRows, symptomsRows, obsRows, sleepRows, hygieneRows, hygieneSessionRows, olderCheckIns, olderObs] =
    await db.batch([
      db
        .select({ id: dyCheckIns.id, logged_at: dyCheckIns.logged_at, eyelid_pain: dyCheckIns.eyelid_pain, temple_pain: dyCheckIns.temple_pain, masseter_pain: dyCheckIns.masseter_pain, cervical_pain: dyCheckIns.cervical_pain, orbital_pain: dyCheckIns.orbital_pain, trigger_type: dyCheckIns.trigger_type, notes: dyCheckIns.notes })
        .from(dyCheckIns)
        .where(and(eq(dyCheckIns.user_id, userId), gte(dyCheckIns.logged_at, utcWindowStart)))
        .orderBy(desc(dyCheckIns.logged_at)),
      db
        .select({ id: dyDrops.id, logged_at: dyDrops.logged_at, quantity: dyDrops.quantity, eye: dyDrops.eye, drop_type_name: dyDropTypes.name })
        .from(dyDrops)
        .innerJoin(dyDropTypes, eq(dyDrops.drop_type_id, dyDropTypes.id))
        .where(and(eq(dyDrops.user_id, userId), gte(dyDrops.logged_at, utcWindowStart)))
        .orderBy(desc(dyDrops.logged_at)),
      db
        .select({ id: dyTriggers.id, logged_at: dyTriggers.logged_at, trigger_type: dyTriggers.trigger_type, intensity: dyTriggers.intensity })
        .from(dyTriggers)
        .where(and(eq(dyTriggers.user_id, userId), gte(dyTriggers.logged_at, utcWindowStart)))
        .orderBy(desc(dyTriggers.logged_at)),
      db
        .select({ id: dySymptoms.id, logged_at: dySymptoms.logged_at, symptom_type: dySymptoms.symptom_type })
        .from(dySymptoms)
        .where(and(eq(dySymptoms.user_id, userId), gte(dySymptoms.logged_at, utcWindowStart)))
        .orderBy(desc(dySymptoms.logged_at)),
      db
        .select({ id: dyObservationOccurrences.id, logged_at: dyObservationOccurrences.logged_at, intensity: dyObservationOccurrences.intensity, duration_minutes: dyObservationOccurrences.duration_minutes, notes: dyObservationOccurrences.notes, title: dyClinicalObservations.title, obs_eye: dyClinicalObservations.eye })
        .from(dyObservationOccurrences)
        .innerJoin(dyClinicalObservations, eq(dyObservationOccurrences.observation_id, dyClinicalObservations.id))
        .where(and(eq(dyObservationOccurrences.user_id, userId), gte(dyObservationOccurrences.logged_at, utcWindowStart)))
        .orderBy(desc(dyObservationOccurrences.logged_at)),
      db
        .select({ id: dySleep.id, logged_at: dySleep.logged_at, sleep_hours: dySleep.sleep_hours, sleep_quality: dySleep.sleep_quality })
        .from(dySleep)
        .where(and(eq(dySleep.user_id, userId), gte(dySleep.logged_at, utcWindowStart)))
        .orderBy(desc(dySleep.logged_at)),
      db
        .select({ day_key: dyHygieneDaily.day_key, last_logged_at: dyHygieneDaily.last_logged_at, status: dyHygieneDaily.status, deviation_value: dyHygieneDaily.deviation_value, friction_type: dyHygieneDaily.friction_type, user_note: dyHygieneDaily.user_note, completed_count: dyHygieneDaily.completed_count })
        .from(dyHygieneDaily)
        .where(and(eq(dyHygieneDaily.user_id, userId), gte(dyHygieneDaily.day_key, yesterdayKey)))
        .orderBy(desc(dyHygieneDaily.day_key)),
      db
        .select({ id: dyLidHygiene.id, day_key: dyLidHygiene.day_key, logged_at: dyLidHygiene.logged_at })
        .from(dyLidHygiene)
        .where(and(eq(dyLidHygiene.user_id, userId), gte(dyLidHygiene.day_key, yesterdayKey)))
        .orderBy(desc(dyLidHygiene.logged_at)),
      db.select({ id: dyCheckIns.id }).from(dyCheckIns).where(and(eq(dyCheckIns.user_id, userId), lt(dyCheckIns.logged_at, utcWindowStart))).limit(1),
      db.select({ id: dyObservationOccurrences.id }).from(dyObservationOccurrences).where(and(eq(dyObservationOccurrences.user_id, userId), lt(dyObservationOccurrences.logged_at, utcWindowStart))).limit(1),
    ]);

  const hasMore = olderCheckIns.length > 0 || olderObs.length > 0;
  const data = buildGroups(timezone, checkInsRows, dropsRows, triggersRows, symptomsRows, obsRows, sleepRows, hygieneRows, hygieneSessionRows);
  return c.json({ ...data, hasMore });
});

history.get("/more", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const beforeDayKey = c.req.query("before") ?? "";
  const limitDays = parseInt(c.req.query("limit") ?? "5");
  const db = getDb(c.env.DB);

  if (!beforeDayKey) return c.json({ ok: false, error: "Missing before param" }, 400);

  const utcBefore = dayKeyToUtcStart(beforeDayKey, timezone);
  const rowLimit = limitDays * 30 + 30;

  const [checkInsRows, dropsRows, triggersRows, symptomsRows, obsRows, sleepRows, hygieneRows, hygieneSessionRows] =
    await db.batch([
      db
        .select({ id: dyCheckIns.id, logged_at: dyCheckIns.logged_at, eyelid_pain: dyCheckIns.eyelid_pain, temple_pain: dyCheckIns.temple_pain, masseter_pain: dyCheckIns.masseter_pain, cervical_pain: dyCheckIns.cervical_pain, orbital_pain: dyCheckIns.orbital_pain, trigger_type: dyCheckIns.trigger_type, notes: dyCheckIns.notes })
        .from(dyCheckIns)
        .where(and(eq(dyCheckIns.user_id, userId), lt(dyCheckIns.logged_at, utcBefore)))
        .orderBy(desc(dyCheckIns.logged_at))
        .limit(rowLimit),
      db
        .select({ id: dyDrops.id, logged_at: dyDrops.logged_at, quantity: dyDrops.quantity, eye: dyDrops.eye, drop_type_name: dyDropTypes.name })
        .from(dyDrops)
        .innerJoin(dyDropTypes, eq(dyDrops.drop_type_id, dyDropTypes.id))
        .where(and(eq(dyDrops.user_id, userId), lt(dyDrops.logged_at, utcBefore)))
        .orderBy(desc(dyDrops.logged_at))
        .limit(rowLimit),
      db
        .select({ id: dyTriggers.id, logged_at: dyTriggers.logged_at, trigger_type: dyTriggers.trigger_type, intensity: dyTriggers.intensity })
        .from(dyTriggers)
        .where(and(eq(dyTriggers.user_id, userId), lt(dyTriggers.logged_at, utcBefore)))
        .orderBy(desc(dyTriggers.logged_at))
        .limit(rowLimit),
      db
        .select({ id: dySymptoms.id, logged_at: dySymptoms.logged_at, symptom_type: dySymptoms.symptom_type })
        .from(dySymptoms)
        .where(and(eq(dySymptoms.user_id, userId), lt(dySymptoms.logged_at, utcBefore)))
        .orderBy(desc(dySymptoms.logged_at))
        .limit(rowLimit),
      db
        .select({ id: dyObservationOccurrences.id, logged_at: dyObservationOccurrences.logged_at, intensity: dyObservationOccurrences.intensity, duration_minutes: dyObservationOccurrences.duration_minutes, notes: dyObservationOccurrences.notes, title: dyClinicalObservations.title, obs_eye: dyClinicalObservations.eye })
        .from(dyObservationOccurrences)
        .innerJoin(dyClinicalObservations, eq(dyObservationOccurrences.observation_id, dyClinicalObservations.id))
        .where(and(eq(dyObservationOccurrences.user_id, userId), lt(dyObservationOccurrences.logged_at, utcBefore)))
        .orderBy(desc(dyObservationOccurrences.logged_at))
        .limit(rowLimit),
      db
        .select({ id: dySleep.id, logged_at: dySleep.logged_at, sleep_hours: dySleep.sleep_hours, sleep_quality: dySleep.sleep_quality })
        .from(dySleep)
        .where(and(eq(dySleep.user_id, userId), lt(dySleep.logged_at, utcBefore)))
        .orderBy(desc(dySleep.logged_at))
        .limit(rowLimit),
      db
        .select({ day_key: dyHygieneDaily.day_key, last_logged_at: dyHygieneDaily.last_logged_at, status: dyHygieneDaily.status, deviation_value: dyHygieneDaily.deviation_value, friction_type: dyHygieneDaily.friction_type, user_note: dyHygieneDaily.user_note, completed_count: dyHygieneDaily.completed_count })
        .from(dyHygieneDaily)
        .where(and(eq(dyHygieneDaily.user_id, userId), lt(dyHygieneDaily.day_key, beforeDayKey)))
        .orderBy(desc(dyHygieneDaily.day_key))
        .limit(limitDays),
      db
        .select({ id: dyLidHygiene.id, day_key: dyLidHygiene.day_key, logged_at: dyLidHygiene.logged_at })
        .from(dyLidHygiene)
        .where(and(eq(dyLidHygiene.user_id, userId), lt(dyLidHygiene.day_key, beforeDayKey)))
        .orderBy(desc(dyLidHygiene.logged_at))
        .limit(limitDays * 20),
    ]);

  const data = buildGroups(timezone, checkInsRows, dropsRows, triggersRows, symptomsRows, obsRows, sleepRows, hygieneRows, hygieneSessionRows);
  const hasMore = data.groups.length > limitDays;
  return c.json({ ...data, groups: data.groups.slice(0, limitDays), hasMore });
});

type CheckInRow = { id: string; logged_at: string; eyelid_pain: number; temple_pain: number; masseter_pain: number; cervical_pain: number; orbital_pain: number; trigger_type: string | null; notes: string | null };
type DropRow = { id: string; logged_at: string; quantity: number; eye: string; drop_type_name: string };
type TriggerRow = { id: string; logged_at: string; trigger_type: string; intensity: number };
type SymptomRow = { id: string; logged_at: string; symptom_type: string };
type ObsRow = { id: string; logged_at: string; intensity: number; duration_minutes: number | null; notes: string | null; title: string; obs_eye: string };
type SleepRow = { id: string; logged_at: string; sleep_hours: number; sleep_quality: string };
type HygieneRow = { day_key: string; last_logged_at: string; status: string; deviation_value: number | null; friction_type: string | null; user_note: string | null; completed_count: number };
type HygieneSessionRow = { id: string; day_key: string; logged_at: string };

function buildGroups(
  timezone: string,
  checkInsRows: CheckInRow[],
  dropsRows: DropRow[],
  triggersRows: TriggerRow[],
  symptomsRows: SymptomRow[],
  obsRows: ObsRow[],
  sleepRows: SleepRow[],
  hygieneRows: HygieneRow[],
  hygieneSessionRows: HygieneSessionRow[],
) {
  type Entry = { id: string; kind: string; loggedAt: string; [key: string]: unknown };
  const entries: Entry[] = [];

  for (const ci of checkInsRows) {
    entries.push({ id: ci.id, kind: "check_in", loggedAt: ci.logged_at, eyelidPain: ci.eyelid_pain, templePain: ci.temple_pain, masseterPain: ci.masseter_pain, cervicalPain: ci.cervical_pain, orbitalPain: ci.orbital_pain, triggerType: ci.trigger_type, notes: ci.notes });
  }
  for (const d of dropsRows) {
    entries.push({ id: d.id, kind: "drop", loggedAt: d.logged_at, quantity: d.quantity, eye: d.eye, name: d.drop_type_name });
  }
  for (const t of triggersRows) {
    entries.push({ id: t.id, kind: "trigger", loggedAt: t.logged_at, triggerType: t.trigger_type, intensity: t.intensity });
  }
  for (const s of symptomsRows) {
    entries.push({ id: s.id, kind: "symptom", loggedAt: s.logged_at, symptomType: s.symptom_type });
  }
  for (const o of obsRows) {
    entries.push({ id: o.id, kind: "observation", loggedAt: o.logged_at, title: o.title, eye: o.obs_eye, notes: o.notes ?? "", intensity: o.intensity, durationMinutes: o.duration_minutes });
  }

  const sleepByDay = new Map<string, Entry>();
  for (const s of sleepRows) {
    const localDay = getDayKey(s.logged_at, timezone);
    if (!sleepByDay.has(localDay)) {
      sleepByDay.set(localDay, { id: s.id, kind: "sleep", loggedAt: s.logged_at, sleepHours: s.sleep_hours, sleepQuality: s.sleep_quality });
    }
  }
  entries.push(...sleepByDay.values());

  entries.sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime());

  const grouped = new Map<string, Entry[]>();
  for (const h of hygieneRows) {
    if (!grouped.has(h.day_key)) grouped.set(h.day_key, []);
  }
  for (const e of entries) {
    const dk = getDayKey(e.loggedAt, timezone);
    const cur = grouped.get(dk) ?? [];
    cur.push(e);
    grouped.set(dk, cur);
  }

  const groups = Array.from(grouped.entries())
    .map(([dayKey, ents]) => ({ dayKey, entries: ents }))
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey));

  const sessionsByDay = new Map<string, { id: string; loggedAt: string }[]>();
  for (const s of hygieneSessionRows) {
    const cur = sessionsByDay.get(s.day_key) ?? [];
    cur.push({ id: s.id, loggedAt: s.logged_at });
    sessionsByDay.set(s.day_key, cur);
  }

  const hygiene = hygieneRows.map((h) => ({
    dayKey: h.day_key,
    loggedAt: h.last_logged_at,
    status: h.status,
    deviationValue: h.deviation_value,
    frictionType: h.friction_type,
    userNote: h.user_note,
    completedCount: h.completed_count,
    sessions: sessionsByDay.get(h.day_key) ?? [],
  }));
  return { ok: true, timezone, groups, hygiene, hasMore: false };
}

export { history };
