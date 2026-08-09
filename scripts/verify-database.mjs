import "dotenv/config";
import { Client } from "pg";

/**
 * Confirms the database is actually usable before any test runs.
 *
 * `prisma migrate deploy` exiting zero is weaker evidence than it looks: it
 * reports that migration *files* were applied, not that the resulting database
 * has the extensions the retrieval layer needs. A missing `vector` extension
 * surfaces much later as a confusing query error inside a retrieval test, and
 * on CI that reads as a flaky test rather than a broken environment.
 *
 * Runs identically locally (`pnpm db:verify`) and in CI, against whatever
 * `DATABASE_URL` points at. Read-only — it creates and changes nothing.
 */

/** Required by the Phase 4 retrieval layer; created by migration 20260804000001. */
const REQUIRED_EXTENSIONS = ["vector", "pg_trgm"];

/** Every `@@map` in prisma/schema.prisma. A missing one means a partial deploy. */
const REQUIRED_TABLES = [
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  "user_profiles",
  "user_priorities",
  "user_constraints",
  "sources",
  "source_chunks",
  "guidance_requests",
  "guidance_reports",
  "recommendation_paths",
  "path_reasons",
  "path_actions",
  "citations",
  "action_plans",
  "plan_tasks",
  "plan_check_ins",
  "feedback",
  "usage_ledger",
  "subscriptions",
  "processed_webhook_events",
  "analytics_events",
  "audit_logs",
  "prompt_versions",
];

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new Client({ connectionString });
const failures = [];

try {
  await client.connect();

  // --- extensions ----------------------------------------------------------
  const extensions = await client.query("SELECT extname FROM pg_extension");
  const installed = new Set(extensions.rows.map((row) => row.extname));

  for (const extension of REQUIRED_EXTENSIONS) {
    if (installed.has(extension)) {
      console.log(`  extension ${extension}: present`);
    } else {
      failures.push(`extension "${extension}" is missing`);
    }
  }

  // --- tables --------------------------------------------------------------
  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const present = new Set(tables.rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));

  if (missing.length === 0) {
    console.log(`  tables: all ${String(REQUIRED_TABLES.length)} present`);
  } else {
    failures.push(`missing table(s): ${missing.join(", ")}`);
  }

  // --- the vector column itself --------------------------------------------
  //
  // The extension existing is not the same as the column having been created
  // with it. This is the specific thing that breaks retrieval.
  const embedding = await client.query(
    `SELECT format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'source_chunks' AND a.attname = 'embedding'`,
  );

  const columnType = embedding.rows[0]?.type;
  if (columnType === "vector(1536)") {
    console.log(`  source_chunks.embedding: ${columnType}`);
  } else {
    failures.push(`source_chunks.embedding is "${columnType ?? "absent"}", expected vector(1536)`);
  }
} catch (error) {
  // The message can carry the connection string, so only the name is printed.
  failures.push(`connection or query failed: ${error instanceof Error ? error.name : "unknown"}`);
} finally {
  await client.end().catch(() => undefined);
}

if (failures.length > 0) {
  console.error("Database verification failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("Database verification passed.");
