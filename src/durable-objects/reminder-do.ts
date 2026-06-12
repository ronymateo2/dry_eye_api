import { DurableObject } from "cloudflare:workers";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, dyUsers, dyMedications, dyMedicationIntakes, dyPushSubscriptions } from "../db";
import type { DrizzleDb } from "../db";
import type { Env } from "../types";
import { getLastDropPerType } from "../services/drops.service";
import { sendPush, type StoredSub } from "../lib/web-push";
import {
  dayKeyInTz,
  isDropCompletedToday,
  isDropLoggedToday,
  isInQuietHours,
  localTimeToUtcMs,
  medSlotsForDay,
  nextDropDoseMs,
  quietEndMs,
} from "../lib/reminder-schedule";

const DAY_MS = 86_400_000;
const REPEAT_MS = 30 * 60_000; // cadencia de re-notify mientras una dosis sigue vencida
const ALARM_LEAD_MS = 1_000; // mínimo colchón para no agendar en el pasado
const SENT_TTL_MS = DAY_MS; // cuánto retener el dedup de envíos

type DueItem = { key: string; label: string };
type SentLog = Record<string, number>;

type ReminderCtx = {
  userId: string;
  enabled: boolean;
  tz: string;
  quietStart: string | null;
  quietEnd: string | null;
  subs: (StoredSub & { id: string })[];
  drops: Awaited<ReturnType<typeof getLastDropPerType>>;
  meds: MedRow[];
  intakeCountByMed: Map<string, number>;
};

type MedRow = {
  id: string;
  name: string;
  times_json: string | null;
  phases_json: string | null;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
};

// Acumulador del cronograma: dosis vencidas ahora + el próximo instante futuro.
class Schedule {
  readonly due: DueItem[] = [];
  nextFutureMs: number | null = null;

  markDue(key: string, label: string): void {
    this.due.push({ key, label });
  }

  considerFuture(ms: number, now: number): void {
    if (ms > now && (this.nextFutureMs === null || ms < this.nextFutureMs)) {
      this.nextFutureMs = ms;
    }
  }

  // Próxima alarma = la dosis futura más cercana, o re-notify en 30min si algo sigue vencido.
  nextAlarmMs(now: number): number | null {
    let next = Number.POSITIVE_INFINITY;
    if (this.nextFutureMs !== null) next = Math.min(next, this.nextFutureMs);
    if (this.due.length > 0) next = Math.min(next, now + REPEAT_MS);
    return Number.isFinite(next) ? next : null;
  }
}

export class ReminderDO extends DurableObject<Env> {
  // Llamado tras cualquier cambio de cronograma (registrar dosis, editar horario, suscribir).
  async refresh(userId: string): Promise<void> {
    await this.ctx.storage.put("userId", userId);
    const ctx = await this.load();
    await this.rescheduleAlarm(ctx, Date.now());
  }

  // Disparado por Cloudflare a la hora agendada: envía push y re-agenda.
  async alarm(): Promise<void> {
    const ctx = await this.load();
    if (!ctx) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const now = Date.now();
    if (isInQuietHours(now, ctx.tz, ctx.quietStart, ctx.quietEnd)) {
      await this.ctx.storage.setAlarm(quietEndMs(now, ctx.tz, ctx.quietEnd!));
      return;
    }

    const schedule = this.buildSchedule(ctx, now);
    console.log(
      "[reminder:alarm]",
      ctx.userId,
      "due:",
      schedule.due.map((d) => d.label),
      "next:",
      schedule.nextFutureMs ? new Date(schedule.nextFutureMs).toISOString() : null,
    );

    await this.notifyDue(ctx, schedule.due, now);
    await this.applyAlarm(schedule, now);
  }

  // ---- carga de estado desde D1 ----

  private async load(): Promise<ReminderCtx | null> {
    const userId = await this.ctx.storage.get<string>("userId");
    if (!userId) return null;

    const db = getDb(this.env.DB);
    const user = await this.loadUser(db, userId);
    if (!user) return null;

    const base = {
      userId,
      tz: user.timezone,
      quietStart: user.quiet_start,
      quietEnd: user.quiet_end,
    };

    if (user.notifications_enabled !== true) {
      return { ...base, enabled: false, subs: [], drops: [], meds: [], intakeCountByMed: new Map() };
    }

    const [subs, drops, meds] = await Promise.all([
      this.loadSubs(db, userId),
      getLastDropPerType(db, userId),
      this.loadMeds(db, userId),
    ]);
    const intakeCountByMed = await this.loadTodayIntakeCount(db, userId, user.timezone);

    return { ...base, enabled: true, subs, drops, meds, intakeCountByMed };
  }

  private loadUser(db: DrizzleDb, userId: string) {
    return db
      .select({
        notifications_enabled: dyUsers.notifications_enabled,
        timezone: dyUsers.timezone,
        quiet_start: dyUsers.quiet_start,
        quiet_end: dyUsers.quiet_end,
      })
      .from(dyUsers)
      .where(eq(dyUsers.id, userId))
      .get();
  }

  private loadSubs(db: DrizzleDb, userId: string) {
    return db
      .select({
        id: dyPushSubscriptions.id,
        endpoint: dyPushSubscriptions.endpoint,
        p256dh: dyPushSubscriptions.p256dh,
        auth: dyPushSubscriptions.auth,
      })
      .from(dyPushSubscriptions)
      .where(eq(dyPushSubscriptions.user_id, userId));
  }

  private loadMeds(db: DrizzleDb, userId: string): Promise<MedRow[]> {
    return db
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
  }

  // Última toma de hoy por medicina (ms) — para saber qué slot ya fue registrado.
  private async loadTodayIntakeCount(
    db: DrizzleDb,
    userId: string,
    tz: string,
  ): Promise<Map<string, number>> {
    const todayStartIso = new Date(
      localTimeToUtcMs(dayKeyInTz(Date.now(), tz), "00:00", tz),
    ).toISOString();

    const rows = await db
      .select({
        medication_id: dyMedicationIntakes.medication_id,
        count: sql<number>`COUNT(*)`,
      })
      .from(dyMedicationIntakes)
      .where(and(eq(dyMedicationIntakes.user_id, userId), gte(dyMedicationIntakes.logged_at, todayStartIso)))
      .groupBy(dyMedicationIntakes.medication_id);

    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.medication_id, Number(r.count));
    }
    return map;
  }

  // ---- cómputo del cronograma ----

  private buildSchedule(ctx: ReminderCtx, now: number): Schedule {
    const schedule = new Schedule();
    this.addDropDoses(schedule, ctx, now);
    this.addMedDoses(schedule, ctx, now);
    return schedule;
  }

  // Gotas: schedule por-día y relativo. Solo cuenta si se registró una gota hoy (ancla del día)
  // y la dosis vigente todavía es de hoy; si la próxima cae mañana, se da por completada.
  private addDropDoses(schedule: Schedule, ctx: ReminderCtx, now: number): void {
    const todayKey = dayKeyInTz(now, ctx.tz);
    for (const d of ctx.drops) {
      if (d.end_date && todayKey > d.end_date) continue;
      if (!isDropLoggedToday(d.last_logged_at, now, ctx.tz)) continue;
      if (isDropCompletedToday(d.last_logged_at, d.interval_hours, now, ctx.tz)) continue;
      const nextMs = nextDropDoseMs(d.last_logged_at, d.interval_hours);
      if (nextMs === null) continue;
      if (nextMs <= now) {
        schedule.markDue(`drop:${d.drop_type_id}:${Math.floor(nextMs / 60_000)}`, d.name);
      } else {
        schedule.considerFuture(nextMs, now);
      }
    }
  }

  // Medicinas: horarios fijos (times_json) en hoy/mañana. Por-conteo (igual que la UI):
  // J tomas de hoy consumen los primeros J slots del día (ordenados por hora), sin importar
  // la hora exacta. Los slots restantes que ya pasaron son recordatorio; los futuros se agendan.
  private addMedDoses(schedule: Schedule, ctx: ReminderCtx, now: number): void {
    const todayKey = dayKeyInTz(now, ctx.tz);
    const days = [todayKey, dayKeyInTz(now + DAY_MS, ctx.tz)];
    for (const m of ctx.meds) {
      for (const dayKey of days) {
        const slots = medSlotsForDay(m, ctx.tz, dayKey).sort((a, b) => a.slotMs - b.slotMs);
        const taken = dayKey === todayKey ? (ctx.intakeCountByMed.get(m.id) ?? 0) : 0;
        for (let i = taken; i < slots.length; i++) {
          const slot = slots[i]!;
          if (slot.slotMs > now) {
            schedule.considerFuture(slot.slotMs, now);
          } else {
            schedule.markDue(`med:${m.id}:${dayKey}:${slot.timeSlot}`, m.name);
          }
        }
      }
    }
  }

  // ---- agenda de la alarma ----

  private async rescheduleAlarm(ctx: ReminderCtx | null, now: number): Promise<void> {
    if (!ctx || !ctx.enabled || ctx.subs.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.applyAlarm(this.buildSchedule(ctx, now), now);
  }

  private async applyAlarm(schedule: Schedule, now: number): Promise<void> {
    const next = schedule.nextAlarmMs(now);
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.max(next, now + ALARM_LEAD_MS));
    }
  }

  // ---- envío + dedup ----

  private async notifyDue(ctx: ReminderCtx, due: DueItem[], now: number): Promise<void> {
    if (due.length === 0 || ctx.subs.length === 0) return;

    const sent = (await this.ctx.storage.get<SentLog>("sent")) ?? {};
    const fresh = due.filter((d) => !sent[d.key] || now - sent[d.key] >= REPEAT_MS);
    if (fresh.length === 0) return;

    await this.dispatch(ctx, due);

    for (const d of fresh) sent[d.key] = now;
    this.pruneSent(sent, now);
    await this.ctx.storage.put("sent", sent);
  }

  private async dispatch(ctx: ReminderCtx, due: DueItem[]): Promise<void> {
    const labels = [...new Set(due.map((d) => d.label))];
    const payload =
      labels.length === 1
        ? { title: "Hora de tu dosis", body: labels[0], tag: "weqe-doses", url: "/" }
        : { title: `${labels.length} dosis pendientes`, body: labels.join(", "), tag: "weqe-doses", url: "/" };

    const dead: string[] = [];
    await Promise.allSettled(
      ctx.subs.map(async (sub) => {
        try {
          const status = await sendPush(sub, payload, this.env);
          if (status === 404 || status === 410) dead.push(sub.id);
        } catch {
          // error transitorio: la sub se reintenta en la próxima alarma
        }
      }),
    );

    await this.removeDeadSubs(dead);
  }

  private async removeDeadSubs(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = getDb(this.env.DB);
    await Promise.allSettled(
      ids.map((id) => db.delete(dyPushSubscriptions).where(eq(dyPushSubscriptions.id, id))),
    );
  }

  private pruneSent(sent: SentLog, now: number): void {
    for (const key of Object.keys(sent)) {
      if (now - sent[key] > SENT_TTL_MS) delete sent[key];
    }
  }
}
