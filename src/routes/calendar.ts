import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { logError } from "../lib/log-error";
import {
  getCalendarStatus,
  getTodayCalendarEvents,
  reprocessCalendarDay,
  syncCalendarDay,
  type SyncDayInput,
} from "../services/calendar.service";

const calendar = new Hono<{ Bindings: Env; Variables: Variables }>();

calendar.use("*", authMiddleware);

calendar.get("/status", async (c) => {
  const data = await getCalendarStatus(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(data);
});

calendar.get("/events/today", async (c) => {
  const data = await getTodayCalendarEvents(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(data);
});

calendar.post("/sync-day", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<SyncDayInput>();
  const db = getDb(c.env.DB);

  try {
    const result = await syncCalendarDay(db, c.env, userId, c.get("userTimezone"), body);
    if (result.ok === false) return c.json(result, 400);
    if ("reason" in result && result.reason === "token_unavailable") {
      c.executionCtx.waitUntil(
        logError(db, {
          method: "POST",
          path: "/api/calendar/sync-day",
          user_id: userId,
          message: `calendar sync skipped: token_unavailable — dropTypeId=${body.dropTypeId} dayKey=${body.dayKey}`,
        }).catch(() => {}),
      );
    }
    return c.json(result);
  } catch (err) {
    console.error("[calendar] /sync-day error:", userId, body.dropTypeId, body.dayKey, err);
    return c.json({ ok: false, error: "sync_failed" }, 500);
  }
});

calendar.post("/reprocess", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ dropTypeId: string; dayKey: string }>();
  const db = getDb(c.env.DB);

  try {
    const result = await reprocessCalendarDay(db, c.env, userId, c.get("userTimezone"), body);
    if (result.ok === false) return c.json(result, 400);
    if ("reason" in result && result.reason === "token_unavailable") {
      c.executionCtx.waitUntil(
        logError(db, {
          method: "POST",
          path: "/api/calendar/reprocess",
          user_id: userId,
          message: `calendar reprocess skipped: token_unavailable — dropTypeId=${body.dropTypeId} dayKey=${body.dayKey}`,
        }).catch(() => {}),
      );
    }
    return c.json(result);
  } catch (err) {
    console.error("[calendar] /reprocess error:", userId, body.dropTypeId, body.dayKey, err);
    return c.json({ ok: false, error: "reprocess_failed" }, 500);
  }
});

export { calendar };
