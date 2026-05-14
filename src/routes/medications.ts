import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyMedications, dyMedicationIntakes } from "../db";
import { and, eq, isNotNull, isNull, sql, desc, max, gte, lt, asc } from "drizzle-orm";
import { getDayKey, dayKeyToUtcStart } from "../lib/utils";
import {
  syncMedicationCalendar,
  findMedicationsNeedingRenewal,
} from "../lib/medication-calendar";

const medications = new Hono<{ Bindings: Env; Variables: Variables }>();

const phasesJsonSchema = z
  .string()
  .refine((v) => { try { JSON.parse(v); return true; } catch { return false; } }, { message: "phasesJson must be valid JSON" })
  .nullable()
  .optional();

const timesArraySchema = z
  .array(z.string().regex(/^\d{2}:\d{2}$/, { message: "timesJson entries must be HH:MM" }))
  .nullable()
  .optional();

function timesToColumn(times: string[] | null | undefined): string | null | undefined {
  if (times === undefined) return undefined;
  if (times === null || times.length === 0) return null;
  return JSON.stringify(times);
}

type MedCtx = Context<{ Bindings: Env; Variables: Variables }>;

function scheduleCalendarSync(c: MedCtx, medicationId: string) {
  const userId = c.get("userId");
  const userTimezone = c.get("userTimezone");
  const db = getDb(c.env.DB);
  c.executionCtx.waitUntil(
    syncMedicationCalendar(db, c.env, userId, userTimezone, medicationId).catch((err) => {
      console.error("[medications] syncMedicationCalendar failed:", err);
    }),
  );
}

medications.use("*", authMiddleware);

medications.get("/", async (c) => {
  const userId = c.get("userId");
  const userTimezone = c.get("userTimezone");
  const db = getDb(c.env.DB);

  const rows = await db
    .select({
      id: dyMedications.id,
      name: dyMedications.name,
      dosage: dyMedications.dosage,
      frequency: dyMedications.frequency,
      notes: dyMedications.notes,
      sort_order: dyMedications.sort_order,
      start_date: dyMedications.start_date,
      end_date: dyMedications.end_date,
      phases_json: dyMedications.phases_json,
      times_json: dyMedications.times_json,
    })
    .from(dyMedications)
    .where(and(eq(dyMedications.user_id, userId), isNull(dyMedications.archived_at)))
    .orderBy(sql`COALESCE(${dyMedications.sort_order}, 9999)`, dyMedications.created_at);

  const renewThreshold = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const ids = await findMedicationsNeedingRenewal(db, userId, renewThreshold);
        await Promise.allSettled(
          ids.map((id) => syncMedicationCalendar(db, c.env, userId, userTimezone, id)),
        );
      } catch (err) {
        console.error("[medications] lazy renewal failed:", err);
      }
    })(),
  );

  return c.json(rows);
});

medications.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    name: string;
    dosage?: string;
    frequency?: string;
    notes?: string;
    startDate?: string | null;
    endDate?: string | null;
    phasesJson?: string | null;
    timesJson?: string[] | null;
  }>();
  const phases = phasesJsonSchema.safeParse(body.phasesJson);
  if (!phases.success) return c.text(phases.error.issues[0].message, 400);
  const times = timesArraySchema.safeParse(body.timesJson);
  if (!times.success) return c.text(times.error.issues[0].message, 400);

  const db = getDb(c.env.DB);

  const id = crypto.randomUUID();
  await db.insert(dyMedications).values({
    id,
    user_id: userId,
    name: body.name,
    dosage: body.dosage ?? null,
    frequency: body.frequency ?? null,
    notes: body.notes ?? null,
    start_date: body.startDate ?? null,
    end_date: body.endDate ?? null,
    phases_json: body.phasesJson ?? null,
    times_json: timesToColumn(body.timesJson) ?? null,
  });

  if (body.timesJson && body.timesJson.length > 0) {
    scheduleCalendarSync(c, id);
  }

  return c.json({ id, name: body.name, dosage: body.dosage ?? null, frequency: body.frequency ?? null, notes: body.notes ?? null });
});

medications.put("/reorder", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ ids: string[] }>();
  const db = getDb(c.env.DB);

  const updates = body.ids.map((id, i) =>
    db
      .update(dyMedications)
      .set({ sort_order: i })
      .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId))),
  );

  await db.batch(updates as [typeof updates[0], ...typeof updates]);
  return c.json({ ok: true });
});

medications.put("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const body = await c.req.json<{
    name?: string;
    dosage?: string | null;
    frequency?: string | null;
    notes?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    phasesJson?: string | null;
    timesJson?: string[] | null;
  }>();
  const phases = phasesJsonSchema.safeParse(body.phasesJson);
  if (!phases.success) return c.text(phases.error.issues[0].message, 400);
  const times = timesArraySchema.safeParse(body.timesJson);
  if (!times.success) return c.text(times.error.issues[0].message, 400);

  const db = getDb(c.env.DB);

  const set: { name?: string; dosage?: string | null; frequency?: string | null; notes?: string | null; start_date?: string | null; end_date?: string | null; phases_json?: string | null; times_json?: string | null } = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.dosage !== undefined) set.dosage = body.dosage;
  if (body.frequency !== undefined) set.frequency = body.frequency;
  if (body.notes !== undefined) set.notes = body.notes;
  if (body.startDate !== undefined) set.start_date = body.startDate;
  if (body.endDate !== undefined) set.end_date = body.endDate;
  if (body.phasesJson !== undefined) set.phases_json = body.phasesJson;
  const timesCol = timesToColumn(body.timesJson);
  if (timesCol !== undefined) set.times_json = timesCol;

  if (Object.keys(set).length === 0) return c.json({ ok: true });

  await db
    .update(dyMedications)
    .set(set)
    .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId)));

  const calendarRelevantChange =
    body.timesJson !== undefined ||
    body.phasesJson !== undefined ||
    body.startDate !== undefined ||
    body.endDate !== undefined ||
    body.dosage !== undefined ||
    body.name !== undefined;
  if (calendarRelevantChange) {
    scheduleCalendarSync(c, id);
  }

  return c.json({ ok: true });
});

medications.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .update(dyMedications)
    .set({ archived_at: new Date().toISOString() })
    .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId)));

  scheduleCalendarSync(c, id);

  return c.json({ ok: true });
});

medications.get("/archived", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
    .select({
      id: dyMedications.id,
      name: dyMedications.name,
      dosage: dyMedications.dosage,
      frequency: dyMedications.frequency,
      notes: dyMedications.notes,
      sort_order: dyMedications.sort_order,
      start_date: dyMedications.start_date,
      end_date: dyMedications.end_date,
      phases_json: dyMedications.phases_json,
      times_json: dyMedications.times_json,
      archived_at: dyMedications.archived_at,
    })
    .from(dyMedications)
    .where(and(eq(dyMedications.user_id, userId), isNotNull(dyMedications.archived_at)))
    .orderBy(dyMedications.archived_at);

  return c.json(rows);
});

medications.post("/:id/unarchive", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .update(dyMedications)
    .set({ archived_at: null, sort_order: null })
    .where(and(eq(dyMedications.id, id), eq(dyMedications.user_id, userId)));

  return c.json({ ok: true });
});

medications.post("/:id/sync-calendar", async (c) => {
  const userId = c.get("userId");
  const userTimezone = c.get("userTimezone");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  const result = await syncMedicationCalendar(db, c.env, userId, userTimezone, id);
  return c.json({ ok: true, ...result });
});

// Intakes

medications.post("/intakes", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    id: string;
    medicationId: string;
    loggedAt: string;
    dosageTaken?: string | null;
    notes?: string | null;
  }>();
  const db = getDb(c.env.DB);

  const values = {
    id: body.id,
    user_id: userId,
    medication_id: body.medicationId,
    logged_at: body.loggedAt,
    dosage_taken: body.dosageTaken ?? null,
    notes: body.notes ?? null,
  };

  await db
    .insert(dyMedicationIntakes)
    .values(values)
    .onConflictDoUpdate({
      target: dyMedicationIntakes.id,
      set: {
        logged_at: values.logged_at,
        dosage_taken: values.dosage_taken,
        notes: values.notes,
      },
    });

  return c.json({ ok: true });
});

medications.get("/intakes/today", async (c) => {
  const userId = c.get("userId");
  const tz = c.get("userTimezone");
  const db = getDb(c.env.DB);

  const todayKey = getDayKey(new Date().toISOString(), tz);
  const startUtc = dayKeyToUtcStart(todayKey, tz);
  const endUtc = new Date(new Date(startUtc).getTime() + 86_400_000).toISOString();

  const rows = await db
    .select({
      id: dyMedicationIntakes.id,
      medication_id: dyMedicationIntakes.medication_id,
      logged_at: dyMedicationIntakes.logged_at,
      dosage_taken: dyMedicationIntakes.dosage_taken,
      notes: dyMedicationIntakes.notes,
    })
    .from(dyMedicationIntakes)
    .where(
      and(
        eq(dyMedicationIntakes.user_id, userId),
        gte(dyMedicationIntakes.logged_at, startUtc),
        lt(dyMedicationIntakes.logged_at, endUtc),
      ),
    )
    .orderBy(asc(dyMedicationIntakes.logged_at));

  return c.json(
    rows.map((r) => ({
      ...r,
      logged_at: new Date(r.logged_at.replace(" ", "T").replace(/\+00$/, "Z")).toISOString(),
    })),
  );
});

medications.get("/intakes/last-per-med", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const rows = await db
    .select({
      medication_id: dyMedicationIntakes.medication_id,
      last_logged_at: max(dyMedicationIntakes.logged_at),
    })
    .from(dyMedicationIntakes)
    .where(eq(dyMedicationIntakes.user_id, userId))
    .groupBy(dyMedicationIntakes.medication_id);

  return c.json(
    rows.map((r) => ({
      ...r,
      last_logged_at: r.last_logged_at
        ? new Date(r.last_logged_at.replace(" ", "T").replace(/\+00$/, "Z")).toISOString()
        : null,
    })),
  );
});

medications.delete("/intakes/:id", async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const db = getDb(c.env.DB);

  await db
    .delete(dyMedicationIntakes)
    .where(and(eq(dyMedicationIntakes.id, id), eq(dyMedicationIntakes.user_id, userId)));

  return c.json({ ok: true });
});

export { medications };
