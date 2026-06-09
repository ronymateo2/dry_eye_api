import type { ReminderDO } from "./durable-objects/reminder-do";

export type Env = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  CALENDAR_SYNC_DISABLED?: string;
  REMINDERS: DurableObjectNamespace<ReminderDO>;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

export type Variables = {
  userId: string;
  userTimezone: string;
};
