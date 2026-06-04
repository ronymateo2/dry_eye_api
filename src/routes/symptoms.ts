import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { getSafeTimezone } from "../lib/utils";
import {
  getSymptomsToday,
  listSymptomEntries,
  saveLegacySymptom,
  saveSymptomEntry,
  type LegacySymptomInput,
  type SymptomEntryInput,
} from "../services/symptoms.service";

const symptoms = new Hono<{ Bindings: Env; Variables: Variables }>();

symptoms.use("*", authMiddleware);

// Legacy endpoint (keep for backwards compat)
symptoms.post("/", async (c) => {
  const body = await c.req.json<LegacySymptomInput>();
  await saveLegacySymptom(getDb(c.env.DB), c.get("userId"), body);
  return c.json({ ok: true });
});

symptoms.post("/entries", async (c) => {
  const body = await c.req.json<SymptomEntryInput>();
  const state = await saveSymptomEntry(getDb(c.env.DB), c.get("userId"), body);
  return c.json({ ok: true, calculated_state: state });
});

symptoms.get("/today", async (c) => {
  const data = await getSymptomsToday(getDb(c.env.DB), c.get("userId"), getSafeTimezone(c.get("userTimezone")));
  return c.json(data);
});

symptoms.get("/entries", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);
  const { entries, hasMore } = await listSymptomEntries(
    getDb(c.env.DB),
    c.get("userId"),
    limit,
    c.req.query("from"),
    c.req.query("to"),
  );
  return c.json({ ok: true, entries, hasMore });
});

export { symptoms };
