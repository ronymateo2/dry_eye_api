import type { ReminderDO } from "./durable-objects/reminder-do";

export type RateLimit = {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  CALENDAR_SYNC_DISABLED?: string;
  DEV_LOGIN_ENABLED?: string;
  REMINDERS: DurableObjectNamespace<ReminderDO>;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  ERRORS_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMITER: RateLimit;
};

export type Variables = {
  userId: string;
  userTimezone: string;
};
