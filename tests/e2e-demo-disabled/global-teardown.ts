import Redis from "ioredis";

import {
  DEMO_DISABLED_RUN_SECRET_ENV,
  demoDisabledAuthIdentifierKey,
} from "./helpers/run-identity";
import { RATE_LIMIT_POLICIES } from "@/lib/rate-limit/policies";

/**
 * Removes the one Redis bucket this suite creates, and nothing else.
 *
 * The disabled suite drives one deliberately failed sign-in through the real
 * limiter, which leaves a single `AUTH_IDENTIFIER` bucket with a 15-minute TTL.
 * Left alone it is harmless but untidy, and it makes a second run inside the
 * window depend on the first run's leftovers rather than on a clean slate.
 *
 * **Deliberately narrower than the main e2e teardown.** That one deletes test
 * database rows and sweeps the whole rate-limit prefix, which is right for a
 * suite that creates accounts across many policies and wrong here: this suite
 * creates no rows, and a prefix sweep would take buckets belonging to the
 * developer, the seeded accounts, and any other suite running beside it.
 *
 * So the key is *computed*, never searched for. No `KEYS`, no `SCAN`, no
 * pattern, no `FLUSHDB`. The retrieval cache and its generation counter are
 * never touched — clearing that counter would resurrect entries publishing had
 * invalidated (ADR 0004).
 *
 * Runs after passing and failing runs alike, because Playwright invokes
 * `globalTeardown` either way.
 */
export default async function globalTeardown(): Promise<void> {
  const policyId = RATE_LIMIT_POLICIES.AUTH_IDENTIFIER.id;
  const url = process.env["REDIS_URL"];

  if (!url) {
    // Redis is optional (ADR 0004). With none configured the limiter persisted
    // nothing, so there is nothing to clean and this is not a failure.
    console.log(`demo-disabled teardown: cache not configured, no ${policyId} key to remove`);
    return;
  }

  const runSecret = process.env[DEMO_DISABLED_RUN_SECRET_ENV];
  const key = demoDisabledAuthIdentifierKey(runSecret);

  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });

  try {
    await redis.connect();

    const observed = await redis.exists(key);
    const removed = observed === 1 ? await redis.del(key) : 0;
    const remaining = await redis.exists(key);

    if (remaining !== 0) {
      // The suite owns this key outright, so a survivor means the computation
      // or the deletion is wrong — worth failing the run over.
      throw new Error(`demo-disabled teardown: ${policyId} key still present after delete`);
    }

    // Counts and the policy name only. The secret, the address, the digest, the
    // Redis URL and the full key are all deliberately absent.
    console.log(
      `demo-disabled teardown: ${policyId} observed=${String(observed)} removed=${String(removed)} remaining=0`,
    );
  } catch (error) {
    // A genuinely unreachable Redis leaves nothing behind to clean, and must not
    // fail an otherwise green run. A key that survived deletion must.
    if (error instanceof Error && error.message.includes("still present")) throw error;
    console.log(`demo-disabled teardown: cache unreachable, no ${policyId} key removed`);
  } finally {
    redis.disconnect();
  }
}
