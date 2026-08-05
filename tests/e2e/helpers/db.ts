import "dotenv/config";
import { Client } from "pg";

/**
 * Direct PostgreSQL access for end-to-end assertions.
 *
 * These tests talk to the same database the application uses — nothing is
 * mocked. Deliberately uses `pg` rather than the Prisma client for two reasons:
 * Prisma 7's generated client is ESM-only and Playwright transpiles to CommonJS,
 * and asserting through a different layer than the app writes with makes the
 * check genuinely independent of the ORM.
 */
const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Start the stack with `pnpm db:up`.");
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Accounts created by tests all live on this domain so teardown can find them. */
export const TEST_EMAIL_DOMAIN = "northstar.test";

export function uniqueEmail(prefix = "e2e"): string {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${nonce}@${TEST_EMAIL_DOMAIN}`;
}

/** Long enough to satisfy the 12-character minimum in the sign-up schema. */
export const TEST_PASSWORD = "e2e-test-passphrase";

export const SEEDED_USER = {
  email: "dev@northstar.local",
  password: "northstar-dev-password",
} as const;

export type TestProfile = {
  region: string | null;
  careerStage: string | null;
  currentRole: string | null;
  primaryGoal: string | null;
  timeframe: string | null;
  onboardingStep: number;
  onboardingCompletedAt: Date | null;
};

export type TestUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  passwordHash: string | null;
  profile: TestProfile | null;
  priorities: Array<{ key: string; rank: number }>;
  constraints: Array<{ type: string; value: string; isHardConstraint: boolean }>;
};

export async function getUserByEmail(email: string): Promise<TestUser | null> {
  return withClient(async (client) => {
    const users = await client.query<{
      id: string;
      email: string;
      name: string | null;
      role: string;
      passwordHash: string | null;
    }>(`SELECT id, email, name, role, "passwordHash" FROM users WHERE email = $1`, [email]);

    const user = users.rows[0];
    if (!user) return null;

    const profiles = await client.query<TestProfile>(
      `SELECT region, "careerStage" AS "careerStage", "currentRole" AS "currentRole",
              "primaryGoal" AS "primaryGoal", timeframe,
              "onboardingStep" AS "onboardingStep",
              "onboardingCompletedAt" AS "onboardingCompletedAt"
         FROM user_profiles WHERE "userId" = $1`,
      [user.id],
    );

    const priorities = await client.query<{ key: string; rank: number }>(
      `SELECT key, rank FROM user_priorities WHERE "userId" = $1 ORDER BY rank ASC`,
      [user.id],
    );

    const constraints = await client.query<{
      type: string;
      value: string;
      isHardConstraint: boolean;
    }>(
      `SELECT type, value, "isHardConstraint" AS "isHardConstraint"
         FROM user_constraints WHERE "userId" = $1`,
      [user.id],
    );

    return {
      ...user,
      profile: profiles.rows[0] ?? null,
      priorities: priorities.rows,
      constraints: constraints.rows,
    };
  });
}

/** Cascades to profile, priorities, and constraints via ON DELETE CASCADE. */
export async function deleteTestUsers(): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query(`DELETE FROM users WHERE email LIKE $1`, [
      `%@${TEST_EMAIL_DOMAIN}`,
    ]);
    return result.rowCount ?? 0;
  });
}

// ---------------------------------------------------------------------------
// Admin / source helpers
// ---------------------------------------------------------------------------

/** Sources created by tests live on this host so teardown can find them. */
export const TEST_SOURCE_HOST = "sources.northstar.test";

export function uniqueSourceUrl(prefix = "src"): string {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `https://${TEST_SOURCE_HOST}/${prefix}-${nonce}`;
}

/**
 * Promotes an existing account to ADMIN.
 *
 * Sign-up always creates a USER — there is deliberately no way to self-elevate
 * through the application — so a test admin is made here, directly in the
 * database, exactly as the documented `SEED_ADMIN` flag does.
 */
export async function promoteToAdmin(email: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`UPDATE users SET role = 'ADMIN' WHERE email = $1`, [email]);
  });
}

export type TestSource = {
  id: string;
  title: string;
  status: string;
  canonicalUrl: string;
  summary: string | null;
  chunkCount: number;
  embeddedCount: number;
};

export async function getSourceByUrl(canonicalUrl: string): Promise<TestSource | null> {
  return withClient(async (client) => {
    const rows = await client.query<{
      id: string;
      title: string;
      status: string;
      canonicalUrl: string;
      summary: string | null;
    }>(`SELECT id, title, status, "canonicalUrl", summary FROM sources WHERE "canonicalUrl" = $1`, [
      canonicalUrl,
    ]);

    const source = rows.rows[0];
    if (!source) return null;

    const counts = await client.query<{ total: string; embedded: string }>(
      `SELECT count(*)::text AS total,
              count(embedding)::text AS embedded
         FROM source_chunks WHERE "sourceId" = $1`,
      [source.id],
    );

    return {
      ...source,
      chunkCount: Number(counts.rows[0]?.total ?? 0),
      embeddedCount: Number(counts.rows[0]?.embedded ?? 0),
    };
  });
}

export async function getAuditActions(sourceId: string): Promise<string[]> {
  return withClient(async (client) => {
    const rows = await client.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE "entityType" = 'Source' AND "entityId" = $1
        ORDER BY "createdAt" ASC`,
      [sourceId],
    );
    return rows.rows.map((row) => row.action);
  });
}

/** True when the source would be returned by the retrieval query's filters. */
export async function isSourceRetrievable(sourceId: string): Promise<boolean> {
  return withClient(async (client) => {
    const rows = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM source_chunks c
         JOIN sources s ON s.id = c."sourceId"
        WHERE s.id = $1
          AND s.status = 'PUBLISHED'
          AND s."deletedAt" IS NULL
          AND c.embedding IS NOT NULL`,
      [sourceId],
    );
    return Number(rows.rows[0]?.count ?? 0) > 0;
  });
}

/** Removes sources the suite created, and their audit trail. */
export async function deleteTestSources(): Promise<number> {
  return withClient(async (client) => {
    const ids = await client.query<{ id: string }>(
      `SELECT id FROM sources WHERE "canonicalUrl" LIKE $1`,
      [`https://${TEST_SOURCE_HOST}/%`],
    );

    for (const row of ids.rows) {
      // Audit rows have no FK to Source, so they are cleaned explicitly.
      await client.query(
        `DELETE FROM audit_logs WHERE "entityType" = 'Source' AND "entityId" = $1`,
        [row.id],
      );
    }

    const result = await client.query(`DELETE FROM sources WHERE "canonicalUrl" LIKE $1`, [
      `https://${TEST_SOURCE_HOST}/%`,
    ]);
    return result.rowCount ?? 0;
  });
}
