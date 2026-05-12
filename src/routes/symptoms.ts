import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dySymptoms, dySymptomEntries } from "../db";
import { and, eq, desc, gte, sql } from "drizzle-orm";
import { calcSymptomState, type SymptomIntensities } from "../lib/symptom-state";
import { getDayKey, buildLastDayKeys, getSafeTimezone } from "../lib/utils";

const symptoms = new Hono<{ Bindings: Env; Variables: Variables }>();

symptoms.use("*", authMiddleware);

// Legacy endpoint (keep for backwards compat)
symptoms.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    id: string;
    loggedAt: string;
    symptomType: string;
    notes?: string;
  }>();
  const db = getDb(c.env.DB);

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

  return c.json({ ok: true });
});

symptoms.post("/entries", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    id: string;
    logged_at: string;
    day_key: string;
    intensities: SymptomIntensities;
    triggers?: string[];
    note?: string;
  }>();
  const db = getDb(c.env.DB);

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
      tearing: body.intensities.tearing,
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
        tearing: sql`excluded.tearing`,
        stinging: sql`excluded.stinging`,
        pressure: sql`excluded.pressure`,
        triggers: sql`excluded.triggers`,
        note: sql`excluded.note`,
        calculated_state: sql`excluded.calculated_state`,
      },
    });

  return c.json({ ok: true, calculated_state: state });
});

symptoms.get("/today", async (c) => {
  const userId = c.get("userId");
  const timezone = getSafeTimezone(c.get("userTimezone"));
  const db = getDb(c.env.DB);

  const dayKeys7 = buildLastDayKeys(timezone, 7);
  const oldest = dayKeys7[0];

  const rows = await db
    .select()
    .from(dySymptomEntries)
    .where(
      and(
        eq(dySymptomEntries.user_id, userId),
        gte(dySymptomEntries.day_key, oldest),
      ),
    )
    .orderBy(desc(dySymptomEntries.logged_at));

  const latest = rows[0] ?? null;

  // Build trend per day_key
  const dayMap = new Map<string, number[]>();
  for (const r of rows) {
    const vals = [
      r.dryness, r.burning, r.photophobia, r.blurry_vision, r.tearing,
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
      tearing: 0,
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
          { key: "tearing" as const, value: latest.tearing },
          { key: "stinging" as const, value: latest.stinging ?? 0 },
          { key: "pressure" as const, value: latest.pressure ?? 0 },
        ]
          .filter((x) => x.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
      )
    : [];

  const latestFormatted = latest
    ? {
        id: latest.id,
        logged_at: latest.logged_at,
        day_key: latest.day_key,
        intensities: {
          dryness: latest.dryness,
          burning: latest.burning,
          photophobia: latest.photophobia,
          blurry_vision: latest.blurry_vision,
          tearing: latest.tearing,
          stinging: latest.stinging ?? undefined,
          pressure: latest.pressure ?? undefined,
        },
        triggers: latest.triggers ? (JSON.parse(latest.triggers) as string[]) : [],
        note: latest.note,
        calculated_state: latest.calculated_state,
        created_at: latest.created_at,
      }
    : null;

  return c.json({ ok: true, latest: latestFormatted, trend_7d, top_symptoms });
});

symptoms.get("/entries", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);
  const from = c.req.query("from");
  const to = c.req.query("to");
  const db = getDb(c.env.DB);

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

  const entries = rows.map((r) => ({
    id: r.id,
    logged_at: r.logged_at,
    day_key: r.day_key,
    intensities: {
      dryness: r.dryness,
      burning: r.burning,
      photophobia: r.photophobia,
      blurry_vision: r.blurry_vision,
      tearing: r.tearing,
      stinging: r.stinging ?? undefined,
      pressure: r.pressure ?? undefined,
    },
    triggers: r.triggers ? (JSON.parse(r.triggers) as string[]) : [],
    note: r.note,
    calculated_state: r.calculated_state,
    created_at: r.created_at,
  }));

  return c.json({ ok: true, entries, hasMore });
});

export { symptoms };
