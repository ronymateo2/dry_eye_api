import { DurableObject } from "cloudflare:workers";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, dyUsers, dyMedications, dyMedicationIntakes, dyPushSubscriptions } from "../db";
import type { Env } from "../types";
import { getLastDropPerType } from "../services/drops.service";
import { dbTimestampToIso } from "../lib/dates";
import { sendPush, type StoredSub } from "../lib/web-push";
import {
  dayKeyInTz,
  isInQuietHours,
  localTimeToUtcMs,
  medSlotsForDay,
  nextDropDoseMs,
  quietEndMs,
} from "../lib/reminder-schedule";

const REPEAT_MS = 30 * 60_000;
const DAY_MS = 86_400_000;

type DueItem = { key: string; label: string };
type SentLog = Record<string, number>;

type LoadedCtx = {
  userId: string;
  enabled: boolean;
  tz: string;
  quietStart: string | null;
  quietEnd: string | null;
  subs: (StoredSub & { id: string })[];
  drops: Awaited<ReturnType<typeof getLastDropPerType>>;
  meds: {
    id: string;
    name: string;
    times_json: string | null;
    phases_json: string | null;
    start_date: string | null;
    end_date: string | null;
    archived_at: string | null;
  }[];
  intakeMaxMsByMed: Map<string, number>;
};

export class ReminderDO extends DurableObject<Env> {
  async refresh(userId: string): Promise<void> {
    await this.ctx.storage.put("userId", userId);
    const ctx = await this.load();
    await this.scheduleNext(ctx, Date.now());
  }

  async alarm(): Promise<void> {
    const ctx = await this.load();
    if (!ctx || !ctx.enabled || ctx.subs.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const now = Date.now();
    if (isInQuietHours(now, ctx.tz, ctx.quietStart, ctx.quietEnd)) {
      await this.ctx.storage.setAlarm(quietEndMs(now, ctx.tz, ctx.quietEnd!));
      return;
    }

    const { dueItems, nextFutureMs } = this.compute(ctx, now);
    console.log("[reminder:alarm]", ctx.userId, "due:", dueItems.map((d) => d.label), "next:", nextFutureMs ? new Date(nextFutureMs).toISOString() : null);
    if (dueItems.length > 0) {
      const sent = (await this.ctx.storage.get<SentLog>("sent")) ?? {};
      const toSend = dueItems.filter((d) => !sent[d.key] || now - sent[d.key] >= REPEAT_MS);
      if (toSend.length > 0) {
        await this.dispatch(ctx, dueItems);
        for (const d of toSend) sent[d.key] = now;
        this.pruneSent(sent, now);
        await this.ctx.storage.put("sent", sent);
      }
    }

    await this.scheduleNext(ctx, now);
  }

  private async load(): Promise<LoadedCtx | null> {
    const userId = await this.ctx.storage.get<string>("userId");
    if (!userId) return null;
    const db = getDb(this.env.DB);

    const user = await db
      .select({
        notifications_enabled: dyUsers.notifications_enabled,
        timezone: dyUsers.timezone,
        quiet_start: dyUsers.quiet_start,
        quiet_end: dyUsers.quiet_end,
      })
      .from(dyUsers)
      .where(eq(dyUsers.id, userId))
      .get();
    if (!user) return null;

    const enabled = user.notifications_enabled === true;
    if (!enabled) {
      return {
        userId,
        enabled: false,
        tz: user.timezone,
        quietStart: user.quiet_start,
        quietEnd: user.quiet_end,
        subs: [],
        drops: [],
        meds: [],
        intakeMaxMsByMed: new Map(),
      };
    }

    const subs = await db
      .select({
        id: dyPushSubscriptions.id,
        endpoint: dyPushSubscriptions.endpoint,
        p256dh: dyPushSubscriptions.p256dh,
        auth: dyPushSubscriptions.auth,
      })
      .from(dyPushSubscriptions)
      .where(eq(dyPushSubscriptions.user_id, userId));

    const drops = await getLastDropPerType(db, userId);

    const meds = await db
      .select({
        id: dyMedications.id,
        name: dyMedications.name,
        times_json: dyMedications.times_json,
        phases_json: dyMedications.phases_json,
        start_date: dyMedications.start_date,
        end_date: dyMedications.end_date,
        archived_at: dyMedications.archived_at,
      })
      .from(dyMedications)
      .where(and(eq(dyMedications.user_id, userId), isNull(dyMedications.archived_at)));

    const now = Date.now();
    const todayStartIso = new Date(
      localTimeToUtcMs(dayKeyInTz(now, user.timezone), "00:00", user.timezone),
    ).toISOString();
    const intakeRows = await db
      .select({
        medication_id: dyMedicationIntakes.medication_id,
        last_logged_at: sql<string>`MAX(${dyMedicationIntakes.logged_at})`,
      })
      .from(dyMedicationIntakes)
      .where(
        and(eq(dyMedicationIntakes.user_id, userId), gte(dyMedicationIntakes.logged_at, todayStartIso)),
      )
      .groupBy(dyMedicationIntakes.medication_id);

    const intakeMaxMsByMed = new Map<string, number>();
    for (const r of intakeRows) {
      intakeMaxMsByMed.set(r.medication_id, new Date(dbTimestampToIso(r.last_logged_at)).getTime());
    }

    return {
      userId,
      enabled,
      tz: user.timezone,
      quietStart: user.quiet_start,
      quietEnd: user.quiet_end,
      subs,
      drops,
      meds,
      intakeMaxMsByMed,
    };
  }

  private compute(ctx: LoadedCtx, now: number): { dueItems: DueItem[]; nextFutureMs: number | null } {
    const dueItems: DueItem[] = [];
    let nextFutureMs: number | null = null;
    const consider = (ms: number) => {
      if (ms > now && (nextFutureMs === null || ms < nextFutureMs)) nextFutureMs = ms;
    };
    const todayKey = dayKeyInTz(now, ctx.tz);

    for (const d of ctx.drops) {
      if (d.is_vial) continue;
      if (d.end_date && todayKey > d.end_date) continue;
      const nextMs = nextDropDoseMs(d.last_logged_at, d.interval_hours);
      if (nextMs === null) continue;
      if (nextMs <= now) {
        dueItems.push({ key: `drop:${d.drop_type_id}:${Math.floor(nextMs / 60_000)}`, label: d.name });
      } else {
        consider(nextMs);
      }
    }

    const tomorrowKey = dayKeyInTz(now + DAY_MS, ctx.tz);
    for (const m of ctx.meds) {
      const lastIntakeMs = ctx.intakeMaxMsByMed.get(m.id) ?? null;
      for (const dayKey of [todayKey, tomorrowKey]) {
        for (const slot of medSlotsForDay(m, ctx.tz, dayKey)) {
          if (slot.slotMs <= now) {
            const taken = lastIntakeMs !== null && lastIntakeMs >= slot.slotMs;
            if (!taken) {
              dueItems.push({ key: `med:${m.id}:${dayKey}:${slot.timeSlot}`, label: m.name });
            }
          } else {
            consider(slot.slotMs);
          }
        }
      }
    }

    return { dueItems, nextFutureMs };
  }

  private async scheduleNext(ctx: LoadedCtx | null, now: number): Promise<void> {
    if (!ctx || !ctx.enabled || ctx.subs.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const { dueItems, nextFutureMs } = this.compute(ctx, now);
    let next = Number.POSITIVE_INFINITY;
    if (nextFutureMs !== null) next = Math.min(next, nextFutureMs);
    if (dueItems.length > 0) next = Math.min(next, now + REPEAT_MS);
    if (!Number.isFinite(next)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(next, now + 1_000));
  }

  private async dispatch(ctx: LoadedCtx, dueItems: DueItem[]): Promise<void> {
    const labels = [...new Set(dueItems.map((d) => d.label))];
    const payload =
      labels.length === 1
        ? { title: "Hora de tu dosis", body: labels[0], tag: "weqe-doses", url: "/" }
        : {
            title: `${labels.length} dosis pendientes`,
            body: labels.join(", "),
            tag: "weqe-doses",
            url: "/",
          };

    const dead: string[] = [];
    await Promise.allSettled(
      ctx.subs.map(async (sub) => {
        try {
          const status = await sendPush(sub, payload, this.env);
          if (status === 404 || status === 410) dead.push(sub.id);
        } catch {
          // ignore transient send errors; sub se reintenta en la próxima alarma
        }
      }),
    );

    if (dead.length > 0) {
      const db = getDb(this.env.DB);
      await Promise.allSettled(
        dead.map((id) => db.delete(dyPushSubscriptions).where(eq(dyPushSubscriptions.id, id))),
      );
    }
  }

  private pruneSent(sent: SentLog, now: number): void {
    for (const key of Object.keys(sent)) {
      if (now - sent[key] > DAY_MS) delete sent[key];
    }
  }

  async debug(userId: string) {
    await this.ctx.storage.put("userId", userId);
    const alarmAt = await this.ctx.storage.getAlarm();
    const now = Date.now();
    const ctx = await this.load();
    if (!ctx) {
      return { now, alarmAt, enabled: false, subs: 0, dueItems: [], nextDoseIso: null };
    }
    const { dueItems, nextFutureMs } = this.compute(ctx, now);
    return {
      now,
      nowIso: new Date(now).toISOString(),
      alarmAt,
      alarmIso: alarmAt ? new Date(alarmAt).toISOString() : null,
      alarmInMin: alarmAt ? Math.round((alarmAt - now) / 60_000) : null,
      enabled: ctx.enabled,
      subs: ctx.subs.length,
      tz: ctx.tz,
      quiet: { start: ctx.quietStart, end: ctx.quietEnd },
      overdueNow: dueItems.map((d) => d.label),
      nextDoseIso: nextFutureMs ? new Date(nextFutureMs).toISOString() : null,
    };
  }
}
