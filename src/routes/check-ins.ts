import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyCheckIns } from "../db";

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
    trigger_type: body.triggerType ?? null,
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
        notes: values.notes,
      },
    });

  return c.json({ ok: true });
});

export { checkIns };
