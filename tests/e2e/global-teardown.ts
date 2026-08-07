import { deleteTestSources, deleteTestUsers } from "./helpers/db";
import { clearRateLimitKeys } from "./helpers/redis";

/**
 * Removes everything the suite created. Runs even after failures, so a crashed
 * run cannot leave rows that break the next one.
 *
 * Sources are deleted before users: a source cited by a report cannot be
 * deleted while the report exists (ON DELETE RESTRICT), and removing the users
 * first cascades those reports away.
 *
 * Rate-limit buckets go too — see helpers/redis for why the seeded account
 * would otherwise accumulate failures across runs.
 */
export default async function globalTeardown(): Promise<void> {
  const users = await deleteTestUsers();
  const sources = await deleteTestSources();
  const rateLimitKeys = await clearRateLimitKeys();
  console.log(
    `e2e teardown: removed ${String(users)} test user(s), ${String(sources)} test source(s), ` +
      `${String(rateLimitKeys)} rate-limit key(s)`,
  );
}
