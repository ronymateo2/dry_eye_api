import type { DrizzleDb } from "../db";
import { dyTriggers } from "../db";

export type TriggerInput = {
  id: string;
  loggedAt: string;
  triggerType: string;
  intensity: number;
  notes?: string;
};

export async function saveTrigger(db: DrizzleDb, userId: string, body: TriggerInput) {
  await db
    .insert(dyTriggers)
    .values({
      id: body.id,
      user_id: userId,
      logged_at: body.loggedAt,
      trigger_type: body.triggerType,
      intensity: body.intensity,
      notes: body.notes ?? null,
    })
    .onConflictDoNothing();
}
