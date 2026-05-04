export type Env = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  CALENDAR_SYNC_DISABLED?: string;
};

export type Variables = {
  userId: string;
  userTimezone: string;
};
