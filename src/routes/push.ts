import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb, dyPushSubscriptions, dyUsers } from "../db";
import { touchReminders } from "../lib/web-push";

const push = new Hono<{ Bindings: Env; Variables: Variables }>();

push.use("*", authMiddleware);

push.get("/vapid-public-key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY }));

push.get("/debug", async (c) => {
  const userId = c.get("userId");
  const stub = c.env.REMINDERS.get(c.env.REMINDERS.idFromName(userId));
  return c.json(await stub.debug(userId));
});

push.post("/subscribe", async (c) => {
  const body = await c.req.json<{
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }>();
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.text("invalid subscription", 400);
  }

  const userId = c.get("userId");
  const db = getDb(c.env.DB);
  const nowIso = new Date().toISOString();

  await db
    .insert(dyPushSubscriptions)
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      last_used_at: nowIso,
    })
    .onConflictDoUpdate({
      target: dyPushSubscriptions.endpoint,
      set: {
        user_id: userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        failure_count: 0,
        last_used_at: nowIso,
      },
    });

  await db.update(dyUsers).set({ notifications_enabled: true }).where(eq(dyUsers.id, userId));

  c.executionCtx.waitUntil(touchReminders(c.env, userId).catch(() => {}));
  return c.json({ ok: true });
});

push.delete("/subscribe", async (c) => {
  const endpoint = c.req.query("endpoint");
  if (!endpoint) return c.text("endpoint required", 400);
  const userId = c.get("userId");
  const db = getDb(c.env.DB);
  await db
    .delete(dyPushSubscriptions)
    .where(and(eq(dyPushSubscriptions.user_id, userId), eq(dyPushSubscriptions.endpoint, endpoint)));
  return c.json({ ok: true });
});

push.put("/preferences", async (c) => {
  const body = await c.req.json<{
    enabled?: boolean;
    quietStart?: string | null;
    quietEnd?: string | null;
  }>();
  const userId = c.get("userId");
  const db = getDb(c.env.DB);

  const patch: Partial<typeof dyUsers.$inferInsert> = {};
  if (typeof body.enabled === "boolean") patch.notifications_enabled = body.enabled;
  if (body.quietStart !== undefined) patch.quiet_start = body.quietStart;
  if (body.quietEnd !== undefined) patch.quiet_end = body.quietEnd;

  if (Object.keys(patch).length > 0) {
    await db.update(dyUsers).set(patch).where(eq(dyUsers.id, userId));
  }

  c.executionCtx.waitUntil(touchReminders(c.env, userId).catch(() => {}));
  return c.json({ ok: true });
});

export { push };
