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
