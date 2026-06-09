import { parsePhasesJson, parseTimesJson } from "./medication-calendar";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function dayKeyInTz(ms: number, tz: string): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: tz });
}

function tzOffsetMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - ms;
}

// Wall-clock local time (dayKey + "HH:MM" in tz) -> UTC epoch ms.
export function localTimeToUtcMs(dayKey: string, hhmm: string, tz: string): number {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = tzOffsetMs(naiveUtc, tz);
  return naiveUtc - offset;
}

// Gotas: dosis vigente = última registrada + intervalo. null si PRN o sin registro.
export function nextDropDoseMs(
  lastLoggedAt: string | null,
  intervalHours: number | null,
): number | null {
  if (!lastLoggedAt || !intervalHours) return null;
  return new Date(lastLoggedAt).getTime() + intervalHours * HOUR_MS;
}

type MedWindow = {
  start_date: string | null;
  end_date: string | null;
  phases_json: string | null;
  times_json: string | null;
  archived_at: string | null;
};

export function medActiveOn(med: MedWindow, dayKey: string): boolean {
  if (med.archived_at) return false;
  const phases = parsePhasesJson(med.phases_json);
  if (phases.length > 0) {
    return phases.some((p) => {
      if (!p.start_date) return false;
      const end = p.end_date ?? med.end_date;
      return p.start_date <= dayKey && (!end || dayKey <= end);
    });
  }
  const start = med.start_date;
  const end = med.end_date;
  return (!start || start <= dayKey) && (!end || dayKey <= end);
}

export type MedSlot = { slotMs: number; timeSlot: string };

export function medSlotsForDay(med: MedWindow, tz: string, dayKey: string): MedSlot[] {
  if (!medActiveOn(med, dayKey)) return [];
  return parseTimesJson(med.times_json).map((timeSlot) => ({
    timeSlot,
    slotMs: localTimeToUtcMs(dayKey, timeSlot, tz),
  }));
}

// HH:MM local actual en tz.
function localHhmm(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function isInQuietHours(
  now: number,
  tz: string,
  quietStart: string | null,
  quietEnd: string | null,
): boolean {
  if (!quietStart || !quietEnd || quietStart === quietEnd) return false;
  const cur = localHhmm(now, tz);
  if (quietStart < quietEnd) return cur >= quietStart && cur < quietEnd;
  // ventana que cruza medianoche (ej. 22:00 -> 07:00)
  return cur >= quietStart || cur < quietEnd;
}

// Próximo instante UTC en que termina la ventana de silencio (>= now).
export function quietEndMs(now: number, tz: string, quietEnd: string): number {
  const todayKey = dayKeyInTz(now, tz);
  const todayEnd = localTimeToUtcMs(todayKey, quietEnd, tz);
  if (todayEnd > now) return todayEnd;
  return localTimeToUtcMs(dayKeyInTz(now + DAY_MS, tz), quietEnd, tz);
}
