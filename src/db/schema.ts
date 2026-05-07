import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const dyUsers = sqliteTable("dy_users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  image: text("image"),
  timezone: text("timezone").notNull().default("America/Bogota"),
  theme: text("theme").notNull().default("dark"),
  created_at: text("created_at").notNull().default(now),
});

export const dySessions = sqliteTable(
  "dy_sessions",
  {
    session_token: text("session_token").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    expires: text("expires").notNull(),
  },
  (t) => [index("dy_sessions_user_id").on(t.user_id)],
);

export const dyAccounts = sqliteTable(
  "dy_accounts",
  {
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    provider_account_id: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    calendar_authorized: integer("calendar_authorized").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.provider, t.provider_account_id] })],
);

export const dyCheckIns = sqliteTable(
  "dy_check_ins",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    logged_at: text("logged_at").notNull().default(now),
    time_of_day: text("time_of_day"),
    eyelid_pain: real("eyelid_pain").notNull().default(0),
    temple_pain: real("temple_pain").notNull().default(0),
    masseter_pain: real("masseter_pain").notNull().default(0),
    cervical_pain: real("cervical_pain").notNull().default(0),
    orbital_pain: real("orbital_pain").notNull().default(0),
    stress_level: real("stress_level").notNull().default(0),
    trigger_type: text("trigger_type"),
    trigger_types: text("trigger_types"),
    pain_quality: text("pain_quality"),
    notes: text("notes"),
  },
  (t) => [index("dy_check_ins_user_logged").on(t.user_id, t.logged_at)],
);

export const dyDropTypes = sqliteTable(
  "dy_drop_types",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sort_order: integer("sort_order"),
    interval_hours: integer("interval_hours"),
    start_date: text("start_date"),
    end_date: text("end_date"),
    suspension_note: text("suspension_note"),
    archived_at: text("archived_at"),
  },
  (t) => [index("dy_drop_types_user_id").on(t.user_id)],
);

export const dyDrops = sqliteTable(
  "dy_drops",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    drop_type_id: text("drop_type_id")
      .notNull()
      .references(() => dyDropTypes.id, { onDelete: "restrict" }),
    logged_at: text("logged_at").notNull().default(now),
    quantity: integer("quantity").notNull(),
    eye: text("eye").notNull(),
    notes: text("notes"),
  },
  (t) => [index("dy_drops_user_logged").on(t.user_id, t.logged_at)],
);

export const dyTriggers = sqliteTable(
  "dy_triggers",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    logged_at: text("logged_at").notNull().default(now),
    trigger_type: text("trigger_type").notNull(),
    intensity: integer("intensity").notNull(),
    notes: text("notes"),
  },
  (t) => [index("dy_triggers_user_logged").on(t.user_id, t.logged_at)],
);

export const dySymptoms = sqliteTable(
  "dy_symptoms",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    logged_at: text("logged_at").notNull(),
    symptom_type: text("symptom_type").notNull(),
    notes: text("notes"),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("dy_symptoms_user_logged").on(t.user_id, t.logged_at)],
);

export const dyMedications = sqliteTable(
  "dy_medications",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dosage: text("dosage"),
    frequency: text("frequency"),
    notes: text("notes"),
    sort_order: integer("sort_order"),
    start_date: text("start_date"),
    end_date: text("end_date"),
    phases_json: text("phases_json"),
    archived_at: text("archived_at"),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("dy_medications_user").on(t.user_id, t.sort_order)],
);

export const dyMedicationIntakes = sqliteTable(
  "dy_medication_intakes",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    medication_id: text("medication_id")
      .notNull()
      .references(() => dyMedications.id, { onDelete: "restrict" }),
    logged_at: text("logged_at").notNull().default(now),
    dosage_taken: text("dosage_taken"),
    notes: text("notes"),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [
    index("dy_medication_intakes_user_logged").on(t.user_id, t.logged_at),
    index("dy_medication_intakes_med_logged").on(t.medication_id, t.logged_at),
  ],
);

export const dyClinicalObservations = sqliteTable(
  "dy_clinical_observations",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    eye: text("eye").notNull().default("none"),
    notes: text("notes"),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("dy_observations_user").on(t.user_id, t.created_at)],
);

export const dyObservationOccurrences = sqliteTable(
  "dy_observation_occurrences",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    observation_id: text("observation_id")
      .notNull()
      .references(() => dyClinicalObservations.id, { onDelete: "cascade" }),
    logged_at: text("logged_at").notNull(),
    intensity: integer("intensity").notNull(),
    duration_minutes: integer("duration_minutes"),
    notes: text("notes"),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [
    index("dy_occurrences_user_logged").on(t.user_id, t.logged_at),
    index("dy_occurrences_obs_logged").on(t.observation_id, t.logged_at),
  ],
);

export const dySleep = sqliteTable(
  "dy_sleep",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    day_key: text("day_key").notNull(),
    logged_at: text("logged_at").notNull().default(now),
    sleep_hours: real("sleep_hours").notNull(),
    sleep_quality: text("sleep_quality").notNull(),
  },
  (t) => [
    index("dy_sleep_user_day").on(t.user_id, t.day_key),
    index("dy_sleep_user_logged").on(t.user_id, t.logged_at),
  ],
);

export const dyLidHygiene = sqliteTable(
  "dy_lid_hygiene",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    day_key: text("day_key").notNull(),
    logged_at: text("logged_at").notNull().default(now),
    status: text("status").notNull(),
    deviation_value: integer("deviation_value"),
    friction_type: text("friction_type"),
    user_note: text("user_note"),
  },
  (t) => [
    index("dy_lid_hygiene_user_day").on(t.user_id, t.day_key),
    index("dy_lid_hygiene_user_logged").on(t.user_id, t.logged_at),
  ],
);

export const dyHygieneDaily = sqliteTable(
  "dy_hygiene_daily",
  {
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    day_key: text("day_key").notNull(),
    status: text("status").notNull(),
    deviation_value: integer("deviation_value"),
    friction_type: text("friction_type"),
    user_note: text("user_note"),
    last_logged_at: text("last_logged_at").notNull(),
    completed_count: integer("completed_count").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.user_id, t.day_key] }),
    index("dy_hygiene_daily_user_day").on(t.user_id, t.day_key),
  ],
);

export const dyCalendarEvents = sqliteTable(
  "dy_calendar_events",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    drop_type_id: text("drop_type_id")
      .notNull()
      .references(() => dyDropTypes.id, { onDelete: "cascade" }),
    day_key: text("day_key").notNull(),
    google_event_id: text("google_event_id").notNull(),
    scheduled_at: text("scheduled_at").notNull(),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("dy_cal_events_user_day").on(t.user_id, t.day_key, t.drop_type_id)],
);

export const dyHygieneStats = sqliteTable("dy_hygiene_stats", {
  user_id: text("user_id")
    .primaryKey()
    .references(() => dyUsers.id, { onDelete: "cascade" }),
  first_day_key: text("first_day_key").notNull(),
  total_completed_days: integer("total_completed_days").notNull().default(0),
  last_updated_at: text("last_updated_at").notNull().default(now),
});

export const dyTherapySessions = sqliteTable(
  "dy_therapy_sessions",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => dyUsers.id, { onDelete: "cascade" }),
    logged_at: text("logged_at").notNull().default(now),
    therapy_type: text("therapy_type").notNull().default("miofascial"),
    notes: text("notes"),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("dy_therapy_user_logged").on(t.user_id, t.logged_at)],
);
