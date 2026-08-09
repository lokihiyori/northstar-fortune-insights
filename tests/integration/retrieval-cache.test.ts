// @vitest-environment node
import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { deterministicEmbedder } from "@/features/retrieval/embedder";
import { retrieveEvidence, type EvidenceChunk } from "@/features/retrieval/repository";
import { createSource, transitionSource } from "@/features/sources/service";
import type { AuditActor } from "@/features/audit/log";

/**
 * Warm-cache invalidation, through the real stack.
 *
 * This exercises the actual retrieval service, the real PostgreSQL corpus, and a
 * real Redis instance. Nothing is mocked and no direct database query stands in
 * for the assertion — retrieval results come from `retrieveEvidence`, which
 * reads the cache *before* it reaches PostgreSQL. That ordering is what makes
 * the test meaningful: if invalidation did not happen, a warm entry would keep
 * serving a retired source and these assertions would fail.
 */

const NAMESPACE = "northstar:retrieval";
const GENERATION_KEY = `${NAMESPACE}:generation`;

// A distinctive invented term, so the deterministic embedder scores our test
// passages far above the seeded corpus for this query.
const MARKER = "zylobrantine";
const QUERY = `${MARKER} credentialling pathway for ${MARKER} practitioners`;

const CONTENT_ONE = `The ${MARKER} credentialling pathway describes how a ${MARKER} practitioner registers to practise. Applicants complete a ${MARKER} assessment before registration.

A ${MARKER} practitioner who trained elsewhere may apply for recognition of an existing ${MARKER} credential under the same pathway.`;

const CONTENT_TWO = `An updated ${MARKER} credentialling pathway replaces the earlier guidance for ${MARKER} practitioners. The revised ${MARKER} assessment applies to new applicants.

Existing holders of a ${MARKER} credential are not required to repeat the ${MARKER} assessment under the revised pathway.`;

let redis: Redis;
let actor: AuditActor;
const createdSourceIds: string[] = [];
const createdKeys = new Set<string>();

/** Options are identical on every call — the same query must map to one key. */
const RETRIEVAL_OPTIONS = {
  topic: "EDUCATION" as const,
  region: null,
  cacheKeyQuery: QUERY,
  embeddingModel: deterministicEmbedder.model,
};

async function runQuery(): Promise<EvidenceChunk[]> {
  const [embedding] = await deterministicEmbedder.embed([QUERY]);
  if (!embedding) throw new Error("embedder returned no vector");
  return retrieveEvidence(embedding, RETRIEVAL_OPTIONS);
}

async function generation(): Promise<number> {
  return Number((await redis.get(GENERATION_KEY)) ?? "0");
}

/**
 * The digest half of the cache key for this suite's query. Independent of the
 * generation, so it identifies every entry this suite has ever written.
 *
 * Mirrors `buildKey` in cache.ts deliberately rather than exporting it — the
 * production module keeps its surface minimal, and a divergence here shows up
 * as a failing "cache is warm" assertion rather than passing silently.
 */
const QUERY_DIGEST = createHash("sha256")
  .update(
    [
      QUERY.trim().toLowerCase().replace(/\s+/g, " "),
      RETRIEVAL_OPTIONS.topic,
      "-",
      RETRIEVAL_OPTIONS.embeddingModel,
      "8",
      (0.12).toFixed(3),
    ].join("|"),
  )
  .digest("hex")
  .slice(0, 32);

function cacheKeyFor(gen: number): string {
  return `${NAMESPACE}:v${String(gen)}:${QUERY_DIGEST}`;
}

async function publishSource(title: string, content: string): Promise<string> {
  const created = await createSource(actor, {
    title,
    publisher: "Integration Test Registry",
    region: "Canada",
    topic: "EDUCATION",
    canonicalUrl: `https://cache-test.northstar.test/${randomUUID()}`,
    summary: `Fixture source used to verify retrieval cache invalidation for ${MARKER}.`,
    content,
  });
  if (!created.ok) throw new Error(`createSource failed: ${created.reason}`);
  createdSourceIds.push(created.value.id);

  const reviewed = await transitionSource(actor, created.value.id, "REVIEWED");
  if (!reviewed.ok) throw new Error(`review failed: ${reviewed.reason}`);

  const published = await transitionSource(actor, created.value.id, "PUBLISHED");
  if (!published.ok) throw new Error(`publish failed: ${published.reason}`);

  return created.value.id;
}

beforeAll(async () => {
  const url = process.env["REDIS_URL"];
  if (!url) throw new Error("REDIS_URL is not set. Start the stack with `pnpm db:up`.");
  redis = new Redis(url, { maxRetriesPerRequest: 2 });

  /**
   * Wait for the *application's* shared client, not just this suite's own.
   *
   * The shared client sets `enableOfflineQueue: false`, so a command issued
   * while it is still connecting is rejected rather than queued. Caching is
   * fail-open by design, so that rejection is silent — the first query simply
   * writes nothing, and the "cache is warm" assertion below then fails for a
   * reason that has nothing to do with invalidation.
   *
   * A real server never hits this: `instrumentation.ts` opens the connection at
   * boot, before the first request. Vitest imports the modules directly, so the
   * suite has to do it explicitly. The other two integration suites already do.
   */
  const { getRedis } = await import("@/lib/redis/client");
  const client = getRedis();
  if (client && client.status !== "ready") {
    await new Promise<void>((resolve) => {
      client.once("ready", () => {
        resolve();
      });
    });
  }

  const user = await prisma.user.create({
    data: {
      email: `cache-test-${randomUUID()}@northstar.test`,
      name: "Cache Integration Admin",
      role: "ADMIN",
    },
    select: { id: true, email: true },
  });
  actor = { id: user.id, email: user.email };
});

afterAll(async () => {
  // J. Remove every database and Redis record this suite created.
  for (const id of createdSourceIds) {
    await prisma.auditLog.deleteMany({ where: { entityType: "Source", entityId: id } });
    await prisma.source.deleteMany({ where: { id } });
  }
  if (actor) await prisma.user.deleteMany({ where: { id: actor.id } });

  // Scan by this suite's query digest rather than relying on the keys we
  // happened to record. Tracking them by hand leaked one entry per run — the
  // fail-open test warms the cache at a generation it never captured — and a
  // scan is self-healing, clearing anything an earlier run left behind.
  const stale = await redis.keys(`${NAMESPACE}:v*:${QUERY_DIGEST}`);
  const toDelete = new Set([...createdKeys, ...stale]);
  if (toDelete.size > 0) await redis.del(...toDelete);

  const remaining = await redis.keys(`${NAMESPACE}:v*:${QUERY_DIGEST}`);
  if (remaining.length > 0) {
    throw new Error(`teardown left ${String(remaining.length)} cache key(s) behind`);
  }

  await redis.quit();
  await prisma.$disconnect();
});

describe("retrieval cache invalidation", () => {
  it("invalidates a warm cache when a source is retired and when one is published", async () => {
    // --- A. Publish a source that matches the query ------------------------
    const firstId = await publishSource(`${MARKER} credentialling pathway`, CONTENT_ONE);

    const genAfterPublish = await generation();

    // --- B. Populate the cache through the real retrieval service ----------
    const first = await runQuery();
    expect(
      first.some((chunk) => chunk.sourceId === firstId),
      "published source must be retrievable",
    ).toBe(true);

    // Evidence the cache is genuinely warm: the entry exists in Redis and holds
    // our source. Without this, a later cache miss would pass the test for the
    // wrong reason.
    const warmKey = cacheKeyFor(genAfterPublish);
    createdKeys.add(warmKey);

    const warmRaw = await redis.get(warmKey);
    expect(warmRaw, "cache entry must exist after the first query").not.toBeNull();

    const warmEntry = JSON.parse(warmRaw!) as EvidenceChunk[];
    expect(warmEntry.some((chunk) => chunk.sourceId === firstId)).toBe(true);

    const ttl = await redis.ttl(warmKey);
    expect(ttl, "every cache key must carry a TTL").toBeGreaterThan(0);

    // Reported, not just asserted: this is the evidence that the cache was
    // genuinely warm before retirement, which is what makes the later
    // assertions meaningful rather than a cache miss passing by accident.
    console.log(
      `[warm cache] generation=${String(genAfterPublish)} key=${warmKey} ` +
        `entries=${String(warmEntry.length)} ttl=${String(ttl)}s ` +
        `containsTestSource=${String(warmEntry.some((c) => c.sourceId === firstId))}`,
    );

    // --- C. The cached result is usable on a second identical query --------
    const second = await runQuery();
    expect(second.map((chunk) => chunk.chunkId)).toEqual(first.map((chunk) => chunk.chunkId));

    // --- D. Retire through the real lifecycle service -----------------------
    const retired = await transitionSource(actor, firstId, "RETIRED");
    expect(retired.ok).toBe(true);

    // --- I. The generation counter moved ------------------------------------
    const genAfterRetire = await generation();
    expect(genAfterRetire).toBeGreaterThan(genAfterPublish);

    // The decisive evidence: the previous entry is *still physically present*
    // in Redis and still contains the retired source. So anything that follows
    // cannot be explained by the key expiring or being deleted — only by the
    // generation bump making it unreachable.
    const staleRaw = await redis.get(warmKey);
    expect(staleRaw, "the old entry must still exist, proving it was not deleted").not.toBeNull();
    expect((JSON.parse(staleRaw!) as EvidenceChunk[]).some((c) => c.sourceId === firstId)).toBe(
      true,
    );

    console.log(
      `[after retire] generation=${String(genAfterPublish)} -> ${String(genAfterRetire)}; ` +
        `old key still present=${String(staleRaw !== null)} ` +
        `and still contains the retired source=true (so exclusion is not expiry)`,
    );

    // --- E, F. The identical query no longer returns the retired source -----
    const afterRetire = await runQuery();
    createdKeys.add(cacheKeyFor(genAfterRetire));
    expect(
      afterRetire.some((chunk) => chunk.sourceId === firstId),
      "a retired source must not be served from a warm cache",
    ).toBe(false);

    // --- G. Publish a second matching source --------------------------------
    const secondId = await publishSource(`${MARKER} revised pathway`, CONTENT_TWO);
    const genAfterSecondPublish = await generation();
    expect(genAfterSecondPublish).toBeGreaterThan(genAfterRetire);

    // --- H. It appears immediately, without waiting for a TTL ---------------
    const afterSecondPublish = await runQuery();
    createdKeys.add(cacheKeyFor(genAfterSecondPublish));

    expect(
      afterSecondPublish.some((chunk) => chunk.sourceId === secondId),
      "a newly published source must appear without waiting for the old cache to expire",
    ).toBe(true);
    expect(afterSecondPublish.some((chunk) => chunk.sourceId === firstId)).toBe(false);

    // The earlier entries were never deleted — they are simply unreachable.
    expect(await redis.get(warmKey)).not.toBeNull();
  });
});

describe("Redis failure", () => {
  it("stays fail-open without making a retired source retrievable", async () => {
    const retiredId = await publishSource(`${MARKER} temporary pathway`, CONTENT_ONE);

    // Warm the cache while Redis is healthy, then retire.
    await runQuery();
    const retired = await transitionSource(actor, retiredId, "RETIRED");
    expect(retired.ok).toBe(true);
    createdKeys.add(cacheKeyFor(await generation()));

    // Re-import the retrieval module with Redis pointed at a closed port, so a
    // fresh client is created that cannot connect. Every cache call must fail
    // silently and fall through to PostgreSQL.
    vi.resetModules();
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6390");

    try {
      const offline = await import("@/features/retrieval/repository");
      const [embedding] = await deterministicEmbedder.embed([QUERY]);

      const results = await offline.retrieveEvidence(embedding!, RETRIEVAL_OPTIONS);

      // Fail-open: results still come back...
      expect(Array.isArray(results)).toBe(true);
      // ...and the retired source is still excluded, because the PostgreSQL
      // filter — not the cache — is what enforces that.
      expect(
        results.some((chunk) => chunk.sourceId === retiredId),
        "a retired source must stay excluded even with Redis unavailable",
      ).toBe(false);

      const offlineClient = await import("@/lib/redis/client");
      offlineClient.getRedis()?.disconnect();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
