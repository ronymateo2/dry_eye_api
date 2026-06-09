import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { syncMedicationCalendar } from "../lib/medication-calendar";
import { touchReminders } from "../lib/web-push";
import {
  archiveMedication,
  createMedication,
  deleteIntake,
  findRenewalCandidates,
  getLastIntakePerMed,
  getTodayIntakes,
  listArchivedMedications,
  listMedications,
  reorderMedications,
  saveIntake,
  unarchiveMedication,
  updateMedication,
  type MedicationInput,
} from "../services/medications.service";

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

function scheduleReminderRefresh(c: MedCtx) {
  c.executionCtx.waitUntil(touchReminders(c.env, c.get("userId")).catch(() => {}));
}

function validateMedicationBody(body: MedicationInput): string | null {
  const phases = phasesJsonSchema.safeParse(body.phasesJson);
  if (!phases.success) return phases.error.issues[0].message;
  const times = timesArraySchema.safeParse(body.timesJson);
  if (!times.success) return times.error.issues[0].message;
  return null;
}

medications.use("*", authMiddleware);

medications.get("/", async (c) => {
  const userId = c.get("userId");
  const userTimezone = c.get("userTimezone");
  const db = getDb(c.env.DB);

  const rows = await listMedications(db, userId);

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const ids = await findRenewalCandidates(db, userId);
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
  const body = await c.req.json<MedicationInput>();
  const error = validateMedicationBody(body);
  if (error) return c.text(error, 400);

  const { record, needsSync } = await createMedication(getDb(c.env.DB), c.get("userId"), body);
  if (needsSync) scheduleCalendarSync(c, record.id);
  scheduleReminderRefresh(c);

  return c.json(record);
});

medications.put("/reorder", async (c) => {
  const body = await c.req.json<{ ids: string[] }>();
  await reorderMedications(getDb(c.env.DB), c.get("userId"), body.ids);
  return c.json({ ok: true });
});

medications.put("/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<MedicationInput>();
  const error = validateMedicationBody(body);
  if (error) return c.text(error, 400);

  const { needsSync } = await updateMedication(getDb(c.env.DB), c.get("userId"), id, body);
  if (needsSync) scheduleCalendarSync(c, id);
  scheduleReminderRefresh(c);

  return c.json({ ok: true });
});

medications.delete("/:id", async (c) => {
  const { id } = c.req.param();
  await archiveMedication(getDb(c.env.DB), c.get("userId"), id);
  scheduleCalendarSync(c, id);
  scheduleReminderRefresh(c);
  return c.json({ ok: true });
});

medications.get("/archived", async (c) => {
  const rows = await listArchivedMedications(getDb(c.env.DB), c.get("userId"));
  return c.json(rows);
});

medications.post("/:id/unarchive", async (c) => {
  const { id } = c.req.param();
  await unarchiveMedication(getDb(c.env.DB), c.get("userId"), id);
  return c.json({ ok: true });
});

medications.post("/:id/sync-calendar", async (c) => {
  const { id } = c.req.param();
  const result = await syncMedicationCalendar(
    getDb(c.env.DB),
    c.env,
    c.get("userId"),
    c.get("userTimezone"),
    id,
  );
  return c.json({ ok: true, ...result });
});

// Intakes

medications.post("/intakes", async (c) => {
  const body = await c.req.json<{
    id: string;
    medicationId: string;
    loggedAt: string;
    dosageTaken?: string | null;
    notes?: string | null;
  }>();
  await saveIntake(getDb(c.env.DB), c.get("userId"), body);
  scheduleReminderRefresh(c);
  return c.json({ ok: true });
});

medications.get("/intakes/today", async (c) => {
  const rows = await getTodayIntakes(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(rows);
});

medications.get("/intakes/last-per-med", async (c) => {
  const rows = await getLastIntakePerMed(getDb(c.env.DB), c.get("userId"));
  return c.json(rows);
});

medications.delete("/intakes/:id", async (c) => {
  const { id } = c.req.param();
  await deleteIntake(getDb(c.env.DB), c.get("userId"), id);
  scheduleReminderRefresh(c);
  return c.json({ ok: true });
});

export { medications };
