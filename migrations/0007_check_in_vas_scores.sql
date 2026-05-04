PRAGMA foreign_keys=OFF;

CREATE TABLE dy_check_ins_new (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  logged_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  time_of_day   TEXT CHECK (time_of_day IN ('morning', 'evening', 'other', 'trigger')),
  eyelid_pain   REAL NOT NULL DEFAULT 0 CHECK (eyelid_pain BETWEEN 0 AND 10),
  temple_pain   REAL NOT NULL DEFAULT 0 CHECK (temple_pain BETWEEN 0 AND 10),
  masseter_pain REAL NOT NULL DEFAULT 0 CHECK (masseter_pain BETWEEN 0 AND 10),
  cervical_pain REAL NOT NULL DEFAULT 0 CHECK (cervical_pain BETWEEN 0 AND 10),
  orbital_pain  REAL NOT NULL DEFAULT 0 CHECK (orbital_pain BETWEEN 0 AND 10),
  stress_level  REAL NOT NULL DEFAULT 0 CHECK (stress_level BETWEEN 0 AND 10),
  trigger_type  TEXT CHECK (
    trigger_type IN ('climate','humidifier','stress','screens','tv','ergonomics','exercise','other')
  ),
  notes         TEXT
);

INSERT INTO dy_check_ins_new (
  id,
  user_id,
  logged_at,
  time_of_day,
  eyelid_pain,
  temple_pain,
  masseter_pain,
  cervical_pain,
  orbital_pain,
  stress_level,
  trigger_type,
  notes
)
SELECT
  id,
  user_id,
  logged_at,
  time_of_day,
  eyelid_pain,
  temple_pain,
  masseter_pain,
  cervical_pain,
  orbital_pain,
  stress_level,
  trigger_type,
  notes
FROM dy_check_ins;

DROP TABLE dy_check_ins;
ALTER TABLE dy_check_ins_new RENAME TO dy_check_ins;

CREATE INDEX IF NOT EXISTS dy_check_ins_user_logged
  ON dy_check_ins(user_id, logged_at DESC);

PRAGMA foreign_keys=ON;
