-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_users (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  email        TEXT UNIQUE,
  image        TEXT,
  timezone     TEXT NOT NULL DEFAULT 'America/Bogota',
  created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- ── Sessions (JWT-less fallback not needed; we use JWT — table kept for revocation) ──
CREATE TABLE IF NOT EXISTS dy_sessions (
  session_token TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  expires       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS dy_sessions_user_id ON dy_sessions(user_id);

-- ── OAuth accounts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_accounts (
  user_id              TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL,
  provider_account_id  TEXT NOT NULL,
  refresh_token        TEXT,
  access_token         TEXT,
  expires_at           INTEGER,
  PRIMARY KEY (provider, provider_account_id)
);

-- ── Check-ins ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_check_ins (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  logged_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  time_of_day   TEXT CHECK (time_of_day IN ('morning', 'evening', 'other', 'trigger')),
  eyelid_pain   INTEGER NOT NULL DEFAULT 0 CHECK (eyelid_pain BETWEEN 0 AND 10),
  temple_pain   INTEGER NOT NULL DEFAULT 0 CHECK (temple_pain BETWEEN 0 AND 10),
  masseter_pain INTEGER NOT NULL DEFAULT 0 CHECK (masseter_pain BETWEEN 0 AND 10),
  cervical_pain INTEGER NOT NULL DEFAULT 0 CHECK (cervical_pain BETWEEN 0 AND 10),
  orbital_pain  INTEGER NOT NULL DEFAULT 0 CHECK (orbital_pain BETWEEN 0 AND 10),
  stress_level  INTEGER NOT NULL DEFAULT 0 CHECK (stress_level BETWEEN 0 AND 10),
  trigger_type  TEXT CHECK (
    trigger_type IN ('climate','humidifier','stress','screens','tv','ergonomics','exercise','other')
  ),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS dy_check_ins_user_logged
  ON dy_check_ins(user_id, logged_at DESC);

-- ── Drop types ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_drop_types (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(name) <= 100),
  sort_order INTEGER,
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS dy_drop_types_user_id ON dy_drop_types(user_id);

-- ── Drops ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_drops (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  drop_type_id TEXT NOT NULL REFERENCES dy_drop_types(id) ON DELETE RESTRICT,
  logged_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  eye          TEXT NOT NULL CHECK (eye IN ('left', 'right', 'both')),
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS dy_drops_user_logged
  ON dy_drops(user_id, logged_at DESC);

-- ── Triggers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_triggers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  logged_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('climate','humidifier','stress','screens','tv','ergonomics','exercise','other')
  ),
  intensity    INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 3),
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS dy_triggers_user_logged
  ON dy_triggers(user_id, logged_at DESC);

-- ── Symptoms ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_symptoms (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  logged_at    TEXT NOT NULL,
  symptom_type TEXT NOT NULL,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS dy_symptoms_user_logged
  ON dy_symptoms(user_id, logged_at DESC);

-- ── Medications ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_medications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  dosage     TEXT,
  frequency  TEXT,
  notes      TEXT,
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS dy_medications_user
  ON dy_medications(user_id, sort_order);

-- ── Clinical observations (type definitions) ──────────────────────────────
CREATE TABLE IF NOT EXISTS dy_clinical_observations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  eye        TEXT NOT NULL DEFAULT 'none' CHECK (eye IN ('right','left','both','none')),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS dy_observations_user
  ON dy_clinical_observations(user_id, created_at DESC);

-- ── Observation occurrences ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_observation_occurrences (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  observation_id   TEXT NOT NULL REFERENCES dy_clinical_observations(id) ON DELETE CASCADE,
  logged_at        TEXT NOT NULL,
  intensity        INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 10),
  duration_minutes INTEGER CHECK (duration_minutes > 0),
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS dy_occurrences_user_logged
  ON dy_observation_occurrences(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS dy_occurrences_obs_logged
  ON dy_observation_occurrences(observation_id, logged_at DESC);

-- ── Sleep ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_sleep (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  day_key       TEXT NOT NULL,
  logged_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  sleep_hours   REAL NOT NULL CHECK (sleep_hours BETWEEN 0 AND 12),
  sleep_quality TEXT NOT NULL CHECK (
    sleep_quality IN ('muy_malo','malo','regular','bueno','excelente')
  ),
  UNIQUE (user_id, day_key)
);

CREATE INDEX IF NOT EXISTS dy_sleep_user_day ON dy_sleep(user_id, day_key DESC);

-- ── Lid hygiene raw log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_lid_hygiene (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  day_key         TEXT NOT NULL,
  logged_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  status          TEXT NOT NULL CHECK (status IN ('completed','skipped','partial')),
  deviation_value INTEGER CHECK (deviation_value BETWEEN -3 AND 3),
  friction_type   TEXT CHECK (friction_type IN ('mental','logistics','none')),
  user_note       TEXT
);

CREATE INDEX IF NOT EXISTS dy_lid_hygiene_user_day
  ON dy_lid_hygiene(user_id, day_key DESC);
CREATE INDEX IF NOT EXISTS dy_lid_hygiene_user_logged
  ON dy_lid_hygiene(user_id, logged_at DESC);

-- ── Hygiene daily summary ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_hygiene_daily (
  user_id          TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  day_key          TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('completed','skipped','partial')),
  deviation_value  INTEGER CHECK (deviation_value BETWEEN 0 AND 5),
  friction_type    TEXT CHECK (friction_type IN ('mental','logistics','none')),
  user_note        TEXT,
  last_logged_at   TEXT NOT NULL,
  completed_count  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, day_key)
);

CREATE INDEX IF NOT EXISTS dy_hygiene_daily_user_day
  ON dy_hygiene_daily(user_id, day_key DESC);

-- ── Hygiene per-user stats ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dy_hygiene_stats (
  user_id              TEXT PRIMARY KEY REFERENCES dy_users(id) ON DELETE CASCADE,
  first_day_key        TEXT NOT NULL,
  total_completed_days INTEGER NOT NULL DEFAULT 0,
  last_updated_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
