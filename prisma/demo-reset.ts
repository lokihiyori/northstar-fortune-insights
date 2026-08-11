import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import Redis from "ioredis";
import { PrismaClient } from "../src/generated/prisma/client";
import { resetDemoAccount } from "../src/features/demo/reset";
import { demoRateLimitKeys } from "../src/features/demo/redis-cleanup";
import { normalizeDemoEmail } from "../src/features/demo/config";

/**
 * `pnpm demo:reset` — operator-only reset of the recruiter demo account.
 *
 * Deliberately a CLI, not an HTTP route: a reset endpoint on a shared account
 * is a denial-of-service handle, and nothing about this needs to be reachable
 * from a browser.
 *
 * Prints masked identities and aggregate counts only. No password, no full
 * address, no row contents.
 */

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function clearDemoRedisKeys(userId: string | null, email: string): Promise<number> {
  const url = process.env["REDIS_URL"];
  if (!url) {
    console.log("  Redis: not configured, skipping (rate-limit buckets expire on their own TTL)");
    return 0;
  }

  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  try {
    await redis.connect();
    const keys = demoRateLimitKeys({ userId, email, secret: process.env["AUTH_SECRET"] });
    // Exact keys only. No pattern, no scan, no flush.
    const removed = keys.length > 0 ? await redis.del(...keys) : 0;
    console.log(
      `  Redis: removed ${String(removed)} demo rate-limit key(s) of ${String(keys.length)} computed`,
    );
    console.log("  Redis: retrieval cache, generation counter, and per-IP buckets left untouched");
    return removed;
  } catch {
    // A cache outage must not fail an operator command (ADR 0004).
    console.log("  Redis: unreachable, skipping (buckets expire on their own TTL)");
    return 0;
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  const email = normalizeDemoEmail(process.env["DEMO_ACCOUNT_EMAIL"]);

  // Captured before the reset, because the user row is replaced and the id
  // changes — the old id is what the old Redis buckets were keyed on.
  const before =
    email === null
      ? null
      : await prisma.user.findUnique({ where: { email }, select: { id: true } });

  const outcome = await resetDemoAccount(prisma);

  if (!outcome.ok) {
    console.error(`demo:reset refused — ${outcome.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log(`demo:reset complete for ${outcome.identity}`);
  const deleted = Object.entries(outcome.deleted);
  console.log(
    deleted.length > 0
      ? `  removed: ${deleted.map(([k, v]) => `${k}=${String(v)}`).join(", ")}`
      : "  removed: nothing (no previous demo account)",
  );
  console.log("  recreated: 1 user (role USER), 1 profile, 3 priorities, 3 constraints");
  console.log("  onboarding: complete — the demo starts ready to ask a question");

  if (email !== null) await clearDemoRedisKeys(before?.id ?? null, email);
}

main()
  .catch((error: unknown) => {
    // Message only: a stack trace here can carry a connection string.
    console.error("demo:reset failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
