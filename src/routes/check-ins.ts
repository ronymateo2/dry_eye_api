import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyCheckIns } from "../db";
import { desc, eq } from "drizzle-orm";

const checkIns = new Hono<{ Bindings: Env; Variables: Variables }>();

checkIns.use("*", authMiddleware);

checkIns.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    id: string;
    loggedAt: string;
    timeOfDay: string | null;
    eyelidPain: number;
    templePain: number;
    masseterPain: number;
    cervicalPain: number;
    orbitalPain: number;
    stressLevel: number;
    triggerType?: string | null;
    triggerTypes?: string[] | null;
    painQuality?: string[] | null;
    notes?: string;
  }>();
  const db = getDb(c.env.DB);

  const values = {
    id: body.id,
    user_id: userId,
    logged_at: body.loggedAt,
    time_of_day: body.timeOfDay ?? null,
    eyelid_pain: body.eyelidPain,
    temple_pain: body.templePain,
    masseter_pain: body.masseterPain,
    cervical_pain: body.cervicalPain,
    orbital_pain: body.orbitalPain,
    stress_level: body.stressLevel,
    trigger_type: body.triggerTypes?.[0] ?? body.triggerType ?? null,
    trigger_types: body.triggerTypes
      ? JSON.stringify([...new Set(body.triggerTypes)])
      : body.triggerType
        ? JSON.stringify([body.triggerType])
        : null,
    pain_quality: body.painQuality ? JSON.stringify(body.painQuality) : null,
    notes: body.notes ?? null,
  };

  await db
    .insert(dyCheckIns)
    .values(values)
    .onConflictDoUpdate({
      target: dyCheckIns.id,
      set: {
        logged_at: values.logged_at,
        time_of_day: values.time_of_day,
        eyelid_pain: values.eyelid_pain,
        temple_pain: values.temple_pain,
        masseter_pain: values.masseter_pain,
        cervical_pain: values.cervical_pain,
        orbital_pain: values.orbital_pain,
        stress_level: values.stress_level,
        trigger_type: values.trigger_type,
        trigger_types: values.trigger_types,
        pain_quality: values.pain_quality,
        notes: values.notes,
      },
    });

  return c.json({ ok: true });
});

checkIns.get("/last", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const row = await db
    .select({
      id: dyCheckIns.id,
      logged_at: dyCheckIns.logged_at,
      time_of_day: dyCheckIns.time_of_day,
      eyelid_pain: dyCheckIns.eyelid_pain,
      temple_pain: dyCheckIns.temple_pain,
      masseter_pain: dyCheckIns.masseter_pain,
      cervical_pain: dyCheckIns.cervical_pain,
      orbital_pain: dyCheckIns.orbital_pain,
      stress_level: dyCheckIns.stress_level,
      trigger_type: dyCheckIns.trigger_type,
      trigger_types: dyCheckIns.trigger_types,
      pain_quality: dyCheckIns.pain_quality,
      notes: dyCheckIns.notes,
    })
    .from(dyCheckIns)
    .where(eq(dyCheckIns.user_id, userId))
    .orderBy(desc(dyCheckIns.logged_at))
    .limit(1)
    .get();

  if (!row) return c.json(null);

  const loggedAt = new Date(
    row.logged_at.replace(" ", "T").replace(/\+00$/, "Z"),
  ).toISOString();

  return c.json({ ...row, logged_at: loggedAt });
});

export { checkIns };
