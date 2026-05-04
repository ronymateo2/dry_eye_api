import type { DrizzleDb } from "../db";
import { dyAccounts } from "../db";
import { and, eq } from "drizzle-orm";
import type { Env } from "../types";

export async function getValidAccessToken(
  db: DrizzleDb,
  userId: string,
  env: Env,
): Promise<string | null> {
  const account = await db
    .select({
      access_token: dyAccounts.access_token,
      refresh_token: dyAccounts.refresh_token,
      expires_at: dyAccounts.expires_at,
    })
    .from(dyAccounts)
    .where(and(eq(dyAccounts.user_id, userId), eq(dyAccounts.provider, "google")))
    .get();

  if (!account?.refresh_token) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (account.expires_at && account.expires_at > nowSec + 60) {
    return account.access_token ?? null;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { access_token: string; expires_in: number };

  await db
    .update(dyAccounts)
    .set({
      access_token: data.access_token,
      expires_at: nowSec + data.expires_in,
    })
    .where(and(eq(dyAccounts.user_id, userId), eq(dyAccounts.provider, "google")));

  return data.access_token;
}

export async function createCalendarEvent(
  accessToken: string,
  params: { dropTypeName: string; scheduledAt: Date; timezone: string },
): Promise<string | null> {
  const start = params.scheduledAt.toISOString();
  const end = new Date(params.scheduledAt.getTime() + 15 * 60 * 1000).toISOString();

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: `Gotas: ${params.dropTypeName}`,
      description: "Dosis programada — Weqe",
      start: { dateTime: start, timeZone: params.timezone },
      end: { dateTime: end, timeZone: params.timezone },
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 0 }],
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[calendar] createCalendarEvent failed:", res.status, body);
    return null;
  }
  const data = (await res.json()) as { id: string };
  return data.id ?? null;
}

export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
): Promise<void> {
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
}
