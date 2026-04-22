export const DEFAULT_TIMEZONE = "America/Bogota";

export function getSafeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function getDayKey(isoDate: string, timezone: string): string {
  return new Date(isoDate).toLocaleDateString("en-CA", { timeZone: timezone });
}

export function dayKeyToUtcStart(dayKey: string, timezone: string): string {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(utcNoon);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)!.value);
  const localNoonMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = utcNoon.getTime() - localNoonMs;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + offsetMs).toISOString();
}

export function buildLastDayKeys(timezone: string, totalDays: number): string[] {
  return Array.from({ length: totalDays }, (_, i) => {
    const offset = totalDays - 1 - i;
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    return date.toLocaleDateString("en-CA", { timeZone: timezone });
  });
}
