-- Tracks Google Calendar events created per drop type per day
CREATE TABLE dy_calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  drop_type_id TEXT NOT NULL REFERENCES dy_drop_types(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX idx_cal_events_user_day_type
  ON dy_calendar_events(user_id, day_key, drop_type_id);

-- Flag: user authorized Google Calendar scope
ALTER TABLE dy_accounts ADD COLUMN calendar_authorized INTEGER NOT NULL DEFAULT 0;
