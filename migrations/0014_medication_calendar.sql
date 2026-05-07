-- Adds medication-level scheduled times (HH:MM) and tracking table for
-- recurring Google Calendar events (RRULE FREQ=DAILY).

ALTER TABLE dy_medications ADD COLUMN times_json TEXT;

CREATE TABLE dy_medication_calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  medication_id TEXT NOT NULL REFERENCES dy_medications(id) ON DELETE CASCADE,
  phase_index INTEGER,
  time_slot TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  rrule_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_med_cal_user ON dy_medication_calendar_events(user_id, medication_id);
CREATE INDEX idx_med_cal_renew ON dy_medication_calendar_events(rrule_until);
