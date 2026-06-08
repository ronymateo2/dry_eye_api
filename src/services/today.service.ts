import type { DrizzleDb } from "../db";
import { getDayKey, buildLastDayKeys } from "../lib/utils";
import { lastCheckInQuery, mapLastCheckIn } from "./check-ins.service";
import { sleepTodayQuery, mapSleepToday } from "./sleep.service";
import {
  lastDropPerTypeQuery,
  mapLastDropPerType,
  recentDropsQuery,
  mapRecentDrops,
} from "./drops.service";
import { todayEventsQuery } from "./calendar.service";
import {
  listMedications,
  todayIntakesWindow,
  todayIntakesQuery,
  mapTodayIntakes,
  lastIntakePerMedQuery,
  mapLastIntakePerMed,
} from "./medications.service";
import { getActiveVials } from "./vials.service";
import { symptomEntriesQuery, buildTodaySummary } from "./symptoms.service";
import { listDropTypes } from "./drop-types.service";

export async function getTodayBundle(db: DrizzleDb, userId: string, timezone: string) {
  const todayKey = getDayKey(new Date().toISOString(), timezone);
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { startUtc, endUtc } = todayIntakesWindow(timezone);
  const dayKeys7 = buildLastDayKeys(timezone, 7);

  const [
    checkIn,
    sleep,
    lastPerType,
    events,
    meds,
    intakesToday,
    lastIntakePerMed,
    vials,
    symptomRows,
    dropTypes,
    recent,
  ] = await db.batch([
    lastCheckInQuery(db, userId),
    sleepTodayQuery(db, userId, todayKey),
    lastDropPerTypeQuery(db, userId),
    todayEventsQuery(db, userId, todayKey),
    listMedications(db, userId),
    todayIntakesQuery(db, userId, startUtc, endUtc),
    lastIntakePerMedQuery(db, userId),
    getActiveVials(db, userId),
    symptomEntriesQuery(db, userId, dayKeys7[0]),
    listDropTypes(db, userId),
    recentDropsQuery(db, userId, since),
  ]);

  return {
    ok: true,
    checkInLast: mapLastCheckIn(checkIn),
    sleepToday: mapSleepToday(sleep),
    dropsLastPerType: mapLastDropPerType(lastPerType),
    calendarEventsToday: { events },
    medications: meds,
    medicationIntakesToday: mapTodayIntakes(intakesToday),
    medicationIntakesLastPerMed: mapLastIntakePerMed(lastIntakePerMed),
    vialsActive: vials,
    symptomsToday: buildTodaySummary(dayKeys7, symptomRows),
    dropTypes,
    dropsRecent24h: mapRecentDrops(recent),
  };
}
