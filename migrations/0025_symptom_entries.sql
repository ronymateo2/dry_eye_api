CREATE TABLE dy_symptom_entries (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  logged_at     TEXT NOT NULL,
  day_key       TEXT NOT NULL,

  dryness       INTEGER NOT NULL,
  burning       INTEGER NOT NULL,
  photophobia   INTEGER NOT NULL,
  blurry_vision INTEGER NOT NULL,
  tearing       INTEGER NOT NULL,
  stinging      INTEGER,
  pressure      INTEGER,

  triggers      TEXT,
  note          TEXT,
  calculated_state TEXT NOT NULL,

  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX dy_symptom_entries_user_logged ON dy_symptom_entries(user_id, logged_at DESC);
CREATE INDEX dy_symptom_entries_user_day    ON dy_symptom_entries(user_id, day_key);
