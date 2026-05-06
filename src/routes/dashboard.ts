import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDayKey, buildLastDayKeys } from "../lib/utils";
import { getSpearmanCorrelation } from "../lib/stats";
import type { TriggerType } from "../lib/domain-types";
import { getDb, dyCheckIns, dySleep, dyDrops, dyDropTypes, dyTherapySessions } from "../db";
import { eq, desc } from "drizzle-orm";

const dashboard = new Hono<{ Bindings: Env; Variables: Variables }>();

dashboard.use("*", authMiddleware);

const MIN_CORRELATION_SAMPLES = 14;

function shortLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return dayKey;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function correlationInsight(spearman: number | null, samples: number): string {
  if (samples < MIN_CORRELATION_SAMPLES)
    return `Necesitas ${MIN_CORRELATION_SAMPLES} registros matutinos con sueno para activar esta correlacion clinica.`;
  if (spearman === null)
    return "No hay suficiente variacion en los datos para calcular correlacion.";
  if (spearman <= -0.5)
    return "A mas horas de sueno, menor dolor de masetero en tu registro reciente.";
  if (spearman < -0.2)
    return "Hay una tendencia moderada: dormir mas se asocia con menos dolor de masetero.";
  if (spearman < 0.2)
    return "La relacion entre horas de sueno y dolor de masetero es debil por ahora.";
  if (spearman < 0.5)
    return "Hay una tendencia moderada: dormir mas se asocia con mayor dolor de masetero.";
  return "La relacion observada es fuerte: mas horas de sueno coinciden con mayor dolor de masetero.";
}

dashboard.get("/", async (c) => {
  const userId = c.get("userId");
  const timezone = c.get("userTimezone");
  const db = getDb(c.env.DB);

  const [checkInsRows, sleepRows, dropsRows, therapyRows] = await db.batch([
    db
      .select({
        logged_at: dyCheckIns.logged_at,
        eyelid_pain: dyCheckIns.eyelid_pain,
        temple_pain: dyCheckIns.temple_pain,
        masseter_pain: dyCheckIns.masseter_pain,
        cervical_pain: dyCheckIns.cervical_pain,
        orbital_pain: dyCheckIns.orbital_pain,
        trigger_type: dyCheckIns.trigger_type,
      })
      .from(dyCheckIns)
      .where(eq(dyCheckIns.user_id, userId))
      .orderBy(desc(dyCheckIns.logged_at))
      .limit(500),
    db
      .select({ day_key: dySleep.day_key, sleep_hours: dySleep.sleep_hours })
      .from(dySleep)
      .where(eq(dySleep.user_id, userId))
      .orderBy(desc(dySleep.day_key))
      .limit(500),
    db
      .select({
        logged_at: dyDrops.logged_at,
        quantity: dyDrops.quantity,
        drop_type_name: dyDropTypes.name,
      })
      .from(dyDrops)
      .innerJoin(dyDropTypes, eq(dyDrops.drop_type_id, dyDropTypes.id))
      .where(eq(dyDrops.user_id, userId))
      .orderBy(desc(dyDrops.logged_at))
      .limit(500),
    db
      .select({ logged_at: dyTherapySessions.logged_at })
      .from(dyTherapySessions)
      .where(eq(dyTherapySessions.user_id, userId))
      .orderBy(desc(dyTherapySessions.logged_at))
      .limit(500),
  ]);

  const sleepByDay = new Map<string, number>();
  for (const s of sleepRows) {
    sleepByDay.set(s.day_key, Number(s.sleep_hours));
  }

  const last30DayKeys = buildLastDayKeys(timezone, 30);
  const last30Set = new Set(last30DayKeys);

  const trendBucket = new Map<string, { count: number; eyelidPain: number; templePain: number; masseterPain: number; cervicalPain: number; orbitalPain: number }>();
  const highPainDaySet = new Set<string>();
  const correlationPoints: { sleepHours: number; masseterPain: number }[] = [];
  const triggerDaysByType = new Map<TriggerType, Set<string>>();
  const triggerZoneMap = new Map<TriggerType, { count: number; eyelidSum: number; templeSum: number; dayKeys: Set<string> }>();

  for (const ci of checkInsRows) {
    const dayKey = getDayKey(ci.logged_at, timezone);
    if (last30Set.has(dayKey)) {
      const cur = trendBucket.get(dayKey) ?? { count: 0, eyelidPain: 0, templePain: 0, masseterPain: 0, cervicalPain: 0, orbitalPain: 0 };
      cur.count++;
      cur.eyelidPain += ci.eyelid_pain;
      cur.templePain += ci.temple_pain;
      cur.masseterPain += ci.masseter_pain;
      cur.cervicalPain += ci.cervical_pain;
      cur.orbitalPain += ci.orbital_pain;
      trendBucket.set(dayKey, cur);
    }
    const mean = (ci.eyelid_pain + ci.temple_pain + ci.masseter_pain + ci.cervical_pain + ci.orbital_pain) / 5;
    if (mean >= 7) highPainDaySet.add(dayKey);

    const sh = sleepByDay.get(dayKey);
    if (sh !== undefined) correlationPoints.push({ sleepHours: sh, masseterPain: ci.masseter_pain });

    if (ci.trigger_type) {
      const t = ci.trigger_type as TriggerType;
      const tz = triggerZoneMap.get(t) ?? { count: 0, eyelidSum: 0, templeSum: 0, dayKeys: new Set() };
      tz.count++;
      tz.eyelidSum += ci.eyelid_pain;
      tz.templeSum += ci.temple_pain;
      tz.dayKeys.add(dayKey);
      triggerZoneMap.set(t, tz);
    }
  }

  for (const ci of checkInsRows) {
    if (!ci.trigger_type) continue;
    const dayKey = getDayKey(ci.logged_at, timezone);
    if (!highPainDaySet.has(dayKey)) continue;
    const t = ci.trigger_type as TriggerType;
    const ds = triggerDaysByType.get(t) ?? new Set<string>();
    ds.add(dayKey);
    triggerDaysByType.set(t, ds);
  }

  const trendPoints = last30DayKeys.map((dayKey) => {
    const b = trendBucket.get(dayKey);
    if (!b || b.count === 0) return { dayKey, label: shortLabel(dayKey), eyelidPain: null, templePain: null, masseterPain: null, cervicalPain: null, orbitalPain: null };
    return {
      dayKey,
      label: shortLabel(dayKey),
      eyelidPain: +(b.eyelidPain / b.count).toFixed(2),
      templePain: +(b.templePain / b.count).toFixed(2),
      masseterPain: +(b.masseterPain / b.count).toFixed(2),
      cervicalPain: +(b.cervicalPain / b.count).toFixed(2),
      orbitalPain: +(b.orbitalPain / b.count).toFixed(2),
    };
  });

  const daysWithData = trendPoints.filter((p) => p.eyelidPain !== null).length;
  const meanOf = (p: (typeof trendPoints)[0]) =>
    p.eyelidPain !== null
      ? (p.eyelidPain + (p.templePain ?? 0) + (p.masseterPain ?? 0) + (p.cervicalPain ?? 0) + (p.orbitalPain ?? 0)) / 5
      : null;
  const last7 = trendPoints.slice(-7).map(meanOf).filter((v): v is number => v !== null);
  const last30 = trendPoints.map(meanOf).filter((v): v is number => v !== null);
  const average7d = last7.length ? +(last7.reduce((a, b) => a + b, 0) / last7.length).toFixed(2) : null;
  const average30d = last30.length ? +(last30.reduce((a, b) => a + b, 0) / last30.length).toFixed(2) : null;

  const spearmanRaw = getSpearmanCorrelation(
    correlationPoints.map((p) => p.sleepHours),
    correlationPoints.map((p) => p.masseterPain),
  );
  const spearman = spearmanRaw !== null ? +spearmanRaw.toFixed(3) : null;

  const highPainTriggerStats = Array.from(triggerDaysByType.entries())
    .map(([triggerType, ds]) => ({ triggerType, days: ds.size }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  const triggerZonePainStats = Array.from(triggerZoneMap.entries())
    .map(([triggerType, d]) => ({
      triggerType,
      avgEyelidPain: +(d.eyelidSum / d.count).toFixed(2),
      avgTemplePain: +(d.templeSum / d.count).toFixed(2),
      days: d.dayKeys.size,
    }))
    .sort((a, b) => b.avgEyelidPain + b.avgTemplePain - (a.avgEyelidPain + a.avgTemplePain));

  const dropsBucket = new Map<string, Map<string, number>>();
  const weekdayBucket = new Map<number, { total: number; dayKeys: Set<string> }>();
  const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  for (const drop of dropsRows) {
    const dayKey = getDayKey(drop.logged_at, timezone);
    if (last30Set.has(dayKey)) {
      const dm = dropsBucket.get(dayKey) ?? new Map<string, number>();
      dm.set(drop.drop_type_name, (dm.get(drop.drop_type_name) ?? 0) + drop.quantity);
      dropsBucket.set(dayKey, dm);
    }
    const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
    const jsDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const isoDow = (jsDow + 6) % 7;
    const wb = weekdayBucket.get(isoDow) ?? { total: 0, dayKeys: new Set<string>() };
    wb.total += drop.quantity;
    wb.dayKeys.add(dayKey);
    weekdayBucket.set(isoDow, wb);
  }

  const allDropTypes = Array.from(new Set(Array.from(dropsBucket.values()).flatMap((m) => [...m.keys()]))).sort();
  const dropsPoints = last30DayKeys.map((dayKey) => {
    const dm = dropsBucket.get(dayKey);
    const quantities: Record<string, number> = {};
    for (const t of allDropTypes) quantities[t] = dm?.get(t) ?? 0;
    return { dayKey, label: shortLabel(dayKey), quantities };
  });

  const dropsByWeekday = WEEKDAY_LABELS.map((label, i) => {
    const wb = weekdayBucket.get(i);
    return {
      weekday: i,
      label,
      avg: wb && wb.dayKeys.size > 0 ? +(wb.total / wb.dayKeys.size).toFixed(1) : null,
      uniqueDays: wb?.dayKeys.size ?? 0,
    };
  });

  let therapyCorrelation: { therapyDays: number; avgPainAfterTherapy: number; avgPainBaseline: number } | null = null;

  if (therapyRows.length >= 3) {
    const painByDay = new Map<string, { sum: number; count: number }>();
    for (const ci of checkInsRows) {
      const dk = getDayKey(ci.logged_at, timezone);
      const mean = (ci.eyelid_pain + ci.temple_pain + ci.masseter_pain + ci.cervical_pain + ci.orbital_pain) / 5;
      const cur = painByDay.get(dk) ?? { sum: 0, count: 0 };
      cur.sum += mean; cur.count++;
      painByDay.set(dk, cur);
    }

    const therapyDaySet = new Set(therapyRows.map((r) => getDayKey(r.logged_at, timezone)));

    const afterTherapyPains: number[] = [];
    for (const dk of therapyDaySet) {
      const [y, m, d] = dk.split("-").map(Number) as [number, number, number];
      const nextKey = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      const pb = painByDay.get(nextKey);
      if (pb) afterTherapyPains.push(pb.sum / pb.count);
    }

    const afterSet = new Set([...therapyDaySet].map((dk) => {
      const [y, m, d] = dk.split("-").map(Number) as [number, number, number];
      return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    }));
    const baselinePains: number[] = [];
    for (const [dk, pb] of painByDay) {
      if (!therapyDaySet.has(dk) && !afterSet.has(dk)) baselinePains.push(pb.sum / pb.count);
    }

    if (afterTherapyPains.length >= 3 && baselinePains.length >= 3) {
      therapyCorrelation = {
        therapyDays: therapyDaySet.size,
        avgPainAfterTherapy: +(afterTherapyPains.reduce((a, b) => a + b, 0) / afterTherapyPains.length).toFixed(2),
        avgPainBaseline: +(baselinePains.reduce((a, b) => a + b, 0) / baselinePains.length).toFixed(2),
      };
    }
  }

  return c.json({
    ok: true,
    timezone,
    trend: { points: trendPoints, daysWithData, average7d, average30d },
    correlation: {
      minimumRequired: MIN_CORRELATION_SAMPLES,
      sampleSize: correlationPoints.length,
      spearman,
      insight: correlationInsight(spearman, correlationPoints.length),
      points: correlationPoints,
    },
    highPainTriggerStats,
    triggerZonePainStats,
    drops: { dropTypes: allDropTypes, points: dropsPoints },
    dropsByWeekday,
    therapyCorrelation,
  });
});

export { dashboard };
