import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { DrizzleDb } from "../db";
import { dyTherapySessions } from "../db";

export type TherapySessionInput = {
  id: string;
  loggedAt: string;
  therapyType?: string;
  notes?: string | null;
};

export async function saveTherapySession(db: DrizzleDb, userId: string, body: TherapySessionInput) {
  await db.insert(dyTherapySessions).values({
    id: body.id,
    user_id: userId,
    logged_at: body.loggedAt,
    therapy_type: body.therapyType ?? "miofascial",
    notes: body.notes ?? null,
  });
}

export async function listTherapySessions(db: DrizzleDb, userId: string, before: string | undefined) {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();

  return db
    .select({
      id: dyTherapySessions.id,
      logged_at: dyTherapySessions.logged_at,
      therapy_type: dyTherapySessions.therapy_type,
      notes: dyTherapySessions.notes,
    })
    .from(dyTherapySessions)
    .where(
      and(
        eq(dyTherapySessions.user_id, userId),
        gte(dyTherapySessions.logged_at, cutoff),
        ...(before ? [lt(dyTherapySessions.logged_at, before)] : []),
      ),
    )
    .orderBy(desc(dyTherapySessions.logged_at))
    .limit(50);
}
