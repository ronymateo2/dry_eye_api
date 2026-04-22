import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDayKey } from "../lib/utils";
import { getSpearmanCorrelation } from "../lib/stats";
import type { TriggerType } from "../lib/domain-types";
import { getDb, dyUsers, dyCheckIns, dySleep, dyDrops, dyTriggers } from "../db";
import { eq, asc } from "drizzle-orm";

const report = new Hono<{ Bindings: Env; Variables: Variables }>();

report.use("*", authMiddleware);

const MIN_RECORDS = 14;

function formatDateRange(from: string, to: string): string {
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return { y, m: m ?? 1, d: d ?? 1 }; };
  const f = parse(from);
  const t = parse(to);
  if (f.y === t.y) {
    if (f.m === t.m) return `${f.d} — ${t.d} ${months[t.m - 1]} ${t.y}`;
    return `${f.d} ${months[f.m - 1]} — ${t.d} ${months[t.m - 1]} ${t.y}`;
  }
  return `${f.d} ${months[f.m - 1]} ${f.y} — ${t.d} ${months[t.m - 1]} ${t.y}`;
}

function correlationLabel(s: number | null): string {
  if (s === null) return "—";
  const abs = Math.abs(s);
  if (abs >= 0.7) return s < 0 ? "fuerte negativa" : "fuerte positiva";
  if (abs >= 0.4) return s < 0 ? "moderada" : "moderada positiva";
  return "débil";
}

report.get("/", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const db = getDb(c.env.DB);

  const [userRows, checkInsRows, sleepRows, dropsRows, triggersRows] = await db.batch([
    db.select({ name: dyUsers.name }).from(dyUsers).where(eq(dyUsers.id, userId)),
    db
      .select({ logged_at: dyCheckIns.logged_at, eyelid_pain: dyCheckIns.eyelid_pain, temple_pain: dyCheckIns.temple_pain, masseter_pain: dyCheckIns.masseter_pain, cervical_pain: dyCheckIns.cervical_pain, orbital_pain: dyCheckIns.orbital_pain })
      .from(dyCheckIns)
      .where(eq(dyCheckIns.user_id, userId))
      .orderBy(asc(dyCheckIns.logged_at))
      .limit(2000),
    db
      .select({ day_key: dySleep.day_key, sleep_hours: dySleep.sleep_hours, sleep_quality: dySleep.sleep_quality })
      .from(dySleep)
      .where(eq(dySleep.user_id, userId))
      .orderBy(asc(dySleep.day_key))
      .limit(2000),
    db
      .select({ logged_at: dyDrops.logged_at, quantity: dyDrops.quantity })
      .from(dyDrops)
      .where(eq(dyDrops.user_id, userId))
      .limit(2000),
    db
      .select({ logged_at: dyTriggers.logged_at, trigger_type: dyTriggers.trigger_type })
      .from(dyTriggers)
      .where(eq(dyTriggers.user_id, userId))
      .limit(2000),
  ]);

  const userName = userRows[0]?.name ?? null;
  const checkInsCount = checkInsRows.length;
  const hasEnoughData = checkInsCount >= MIN_RECORDS;

  let dateRange = "—";
  if (checkInsRows.length > 0) {
    const firstKey = getDayKey(checkInsRows[0].logged_at, timezone);
    const lastKey = getDayKey(checkInsRows[checkInsRows.length - 1].logged_at, timezone);
    dateRange = formatDateRange(firstKey, lastKey);
  }

  const masseterByDay = new Map<string, { sum: number; count: number }>();
  const trendBucket = new Map<string, { count: number; painSum: number }>();
  let averagePain = null as { eyelid: number; temple: number; masseter: number; cervical: number; orbital: number } | null;

  if (checkInsRows.length > 0) {
    const totals = { eyelid: 0, temple: 0, masseter: 0, cervical: 0, orbital: 0 };
    for (const ci of checkInsRows) {
      totals.eyelid += ci.eyelid_pain;
      totals.temple += ci.temple_pain;
      totals.masseter += ci.masseter_pain;
      totals.cervical += ci.cervical_pain;
      totals.orbital += ci.orbital_pain;
      const dk = getDayKey(ci.logged_at, timezone);
      const mb = masseterByDay.get(dk) ?? { sum: 0, count: 0 };
      mb.sum += ci.masseter_pain;
      mb.count++;
      masseterByDay.set(dk, mb);
      const tb = trendBucket.get(dk) ?? { count: 0, painSum: 0 };
      tb.count++;
      tb.painSum += (ci.eyelid_pain + ci.temple_pain + ci.masseter_pain + ci.cervical_pain + ci.orbital_pain) / 5;
      trendBucket.set(dk, tb);
    }
    const n = checkInsRows.length;
    averagePain = {
      eyelid: +(totals.eyelid / n).toFixed(1),
      temple: +(totals.temple / n).toFixed(1),
      masseter: +(totals.masseter / n).toFixed(1),
      cervical: +(totals.cervical / n).toFixed(1),
      orbital: +(totals.orbital / n).toFixed(1),
    };
  }

  const averageSleepHours = sleepRows.length > 0
    ? +(sleepRows.reduce((s, r) => s + Number(r.sleep_hours), 0) / sleepRows.length).toFixed(1)
    : null;

  const sqScore: Record<string, number> = { muy_malo: 1, malo: 2, regular: 3, bueno: 4, excelente: 5 };
  const averageSleepQuality = sleepRows.length > 0
    ? +(sleepRows.reduce((s, r) => s + (sqScore[r.sleep_quality] ?? 3), 0) / sleepRows.length).toFixed(1)
    : null;

  const correlationPoints = sleepRows
    .map((s) => {
      const mb = masseterByDay.get(s.day_key);
      if (!mb) return null;
      return { sleepHours: Number(s.sleep_hours), masseterPain: +(mb.sum / mb.count).toFixed(2) };
    })
    .filter((p): p is { sleepHours: number; masseterPain: number } => p !== null);

  const spearmanRaw = correlationPoints.length >= MIN_RECORDS
    ? getSpearmanCorrelation(correlationPoints.map((p) => p.sleepHours), correlationPoints.map((p) => p.masseterPain))
    : null;
  const spearman = spearmanRaw !== null ? +spearmanRaw.toFixed(2) : null;

  const trendPoints = Array.from(trendBucket.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, b]) => ({ dayKey, averagePain: +(b.painSum / b.count).toFixed(2) }));

  const totalDropQty = dropsRows.reduce((s, d) => s + d.quantity, 0);
  const dropsPerDay = dropsRows.length > 0 && trendPoints.length > 0
    ? +(totalDropQty / trendPoints.length).toFixed(1)
    : null;

  const triggerDaysByType = new Map<TriggerType, Set<string>>();
  for (const t of triggersRows) {
    const dk = getDayKey(t.logged_at, timezone);
    const ds = triggerDaysByType.get(t.trigger_type as TriggerType) ?? new Set<string>();
    ds.add(dk);
    triggerDaysByType.set(t.trigger_type as TriggerType, ds);
  }
  const topTriggers = Array.from(triggerDaysByType.entries())
    .map(([triggerType, ds]) => ({ triggerType, days: ds.size }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  return c.json({
    ok: true,
    userName,
    checkInsCount,
    dateRange,
    hasEnoughData,
    averagePain,
    averageSleepHours,
    averageSleepQuality,
    spearman,
    correlationLabel: correlationLabel(spearman),
    correlationPoints,
    trendPoints,
    dropsPerDay,
    topTriggers,
  });
});

export { report };
