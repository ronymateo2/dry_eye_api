#!/usr/bin/env node
/**
 * migrate-supabase-to-d1.mjs
 *
 * 1. Deletes all data from Cloudflare D1 (prod by default)
 * 2. Fetches all data from Supabase via PostgREST
 * 3. Inserts it into D1 via wrangler
 *
 * Usage:
 *   node scripts/migrate-supabase-to-d1.mjs            # targets weqe-db (prod)
 *   node scripts/migrate-supabase-to-d1.mjs --staging  # targets weqe-db-prod (staging env)
 *   node scripts/migrate-supabase-to-d1.mjs --dry-run  # only generates SQL, no wrangler exec
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { join } from "path";

function loadDevVars() {
  const path = join(process.cwd(), ".dev.vars");
  const text = readFileSync(path, "utf8");
  const vars = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return vars;
}

const env = loadDevVars();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .dev.vars",
  );
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const IS_STAGING = args.has("--staging");
const DRY_RUN = args.has("--dry-run");

const DB_NAME = IS_STAGING ? "weqe-db-prod" : "weqe-db";
const ENV_FLAG = IS_STAGING ? "--env staging" : "";

// Insertion order respects FK deps (parents before children).
// Column allowlists match D1 schema exactly — Supabase may have extra columns (e.g. NextAuth).
const TABLES = [
  {
    name: "dy_users",
    cols: ["id", "name", "email", "image", "timezone", "theme", "created_at"],
  },
  // dy_accounts and dy_sessions skipped — OAuth tokens are expired and users will re-auth

  { name: "dy_drop_types", cols: ["id", "user_id", "name", "sort_order"] },
  {
    name: "dy_drops",
    cols: [
      "id",
      "user_id",
      "drop_type_id",
      "logged_at",
      "quantity",
      "eye",
      "notes",
    ],
  },
  {
    name: "dy_check_ins",
    cols: [
      "id",
      "user_id",
      "logged_at",
      "time_of_day",
      "eyelid_pain",
      "temple_pain",
      "masseter_pain",
      "cervical_pain",
      "orbital_pain",
      "stress_level",
      "trigger_type",
      "notes",
    ],
  },
  {
    name: "dy_triggers",
    cols: ["id", "user_id", "logged_at", "trigger_type", "intensity", "notes"],
  },
  {
    name: "dy_symptoms",
    cols: ["id", "user_id", "logged_at", "symptom_type", "notes", "created_at"],
  },
  {
    name: "dy_medications",
    cols: [
      "id",
      "user_id",
      "name",
      "dosage",
      "frequency",
      "notes",
      "sort_order",
      "created_at",
    ],
  },
  {
    name: "dy_clinical_observations",
    cols: ["id", "user_id", "title", "eye", "notes", "created_at"],
  },
  {
    name: "dy_observation_occurrences",
    cols: [
      "id",
      "user_id",
      "observation_id",
      "logged_at",
      "intensity",
      "duration_minutes",
      "notes",
      "created_at",
    ],
  },
  {
    name: "dy_sleep",
    cols: [
      "id",
      "user_id",
      "day_key",
      "logged_at",
      "sleep_hours",
      "sleep_quality",
    ],
  },
  {
    name: "dy_lid_hygiene",
    cols: [
      "id",
      "user_id",
      "day_key",
      "logged_at",
      "status",
      "deviation_value",
      "friction_type",
      "user_note",
    ],
  },
  {
    name: "dy_hygiene_daily",
    cols: [
      "user_id",
      "day_key",
      "status",
      "deviation_value",
      "friction_type",
      "user_note",
      "last_logged_at",
      "completed_count",
    ],
  },
  {
    name: "dy_hygiene_stats",
    cols: [
      "user_id",
      "first_day_key",
      "total_completed_days",
      "last_updated_at",
    ],
  },
];

// Rows per INSERT batch — keeps SQL files under D1 limits
const BATCH_SIZE = 500;

async function fetchAll(table) {
  const rows = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=*&offset=${offset}&limit=${limit}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "count=exact",
        },
      },
    );

    if (res.status === 404 || res.status === 400) {
      const text = await res.text();
      console.warn(`  [SKIP] ${table}: ${res.status} ${text.slice(0, 120)}`);
      return [];
    }

    if (!res.ok) {
      throw new Error(
        `Fetch ${table} failed: ${res.status} ${await res.text()}`,
      );
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.warn(`  [SKIP] ${table}: unexpected response shape`);
      return [];
    }

    rows.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }

  return rows;
}

function sqlVal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function generateInserts(tableName, cols, rows) {
  if (rows.length === 0) return "";

  const colList = cols.map((c) => `"${c}"`).join(", ");
  const parts = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const valRows = chunk
      .map((row) => `(${cols.map((c) => sqlVal(row[c])).join(", ")})`)
      .join(",\n  ");
    parts.push(
      `INSERT OR REPLACE INTO ${tableName} (${colList}) VALUES\n  ${valRows};`,
    );
  }

  return parts.join("\n\n");
}

async function main() {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Supabase → D1 migration`);
  console.log(`  Target DB : ${DB_NAME}`);
  console.log(`  Dry run   : ${DRY_RUN}`);
  console.log(`${"─".repeat(60)}\n`);

  // ── 1. Fetch from Supabase ─────────────────────────────────────
  console.log("Step 1/3  Fetching from Supabase…\n");
  const allData = {};
  let totalRows = 0;

  for (const { name } of TABLES) {
    process.stdout.write(`  ${name.padEnd(36)}`);
    const rows = await fetchAll(name);
    allData[name] = rows;
    totalRows += rows.length;
    console.log(`${rows.length} rows`);
  }

  console.log(`\n  Total: ${totalRows} rows\n`);

  // ── 2. Build SQL ───────────────────────────────────────────────
  console.log("Step 2/3  Building SQL…");

  const deleteOrder = [...TABLES].reverse();

  let sql = "PRAGMA foreign_keys = OFF;\n\n";

  sql += "-- ── DELETE (reverse FK order) ────────────────────────\n";
  for (const { name } of deleteOrder) {
    sql += `DELETE FROM ${name};\n`;
  }
  sql += "\n";

  sql += "-- ── INSERT (FK order) ────────────────────────────────\n";
  for (const { name, cols } of TABLES) {
    const rows = allData[name];
    if (rows.length === 0) continue;
    sql += `\n-- ${name} (${rows.length} rows)\n`;
    sql += generateInserts(name, cols, rows);
    sql += "\n";
  }

  sql += "\nPRAGMA foreign_keys = ON;\n";

  const sqlPath = join(process.cwd(), "_migration_temp.sql");
  writeFileSync(sqlPath, sql, "utf8");
  console.log(
    `  Written: _migration_temp.sql (${(sql.length / 1024).toFixed(1)} KB)\n`,
  );

  if (DRY_RUN) {
    console.log("Dry-run mode — skipping wrangler execution.");
    console.log(`SQL file kept at: ${sqlPath}`);
    return;
  }

  // ── 3. Execute against D1 ─────────────────────────────────────
  console.log("Step 3/3  Executing against D1…");
  console.log(
    "  ⚠  This will DELETE all existing D1 data and reimport from Supabase.",
  );
  console.log(`  DB: ${DB_NAME}\n`);

  try {
    const cmd =
      `npx wrangler d1 execute ${DB_NAME} ${ENV_FLAG} --file=_migration_temp.sql --remote`.trim();
    console.log(`  $ ${cmd}\n`);
    execSync(cmd, { stdio: "inherit" });
    console.log("\n  Done.\n");
  } finally {
    if (existsSync(sqlPath)) unlinkSync(sqlPath);
  }
}

main().catch((err) => {
  console.error("\nError:", err.message ?? err);
  process.exit(1);
});
