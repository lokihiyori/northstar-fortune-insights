import "server-only";

import { createHash } from "node:crypto";
import { cacheGet, cacheIncrement, cacheSet } from "@/lib/redis/client";
import type { EvidenceChunk } from "./repository";
import type { Topic } from "@/features/guidance/types";

/**
 * Retrieval result cache (spec section 9).
 *
 * Keyed by normalized query, topic, region, embedding model, and a corpus
 * generation counter — which is how invalidation works.
 *
 * **Why a generation counter rather than deleting keys:** publishing or retiring
 * a source can change the result of *any* query, so there is no such thing as a
 * selectively affected key. Bumping the generation makes every existing key
 * unreachable in one atomic operation; the orphans expire by TTL. Scanning and
 * deleting would be slower, and would risk missing keys — leaving a retired
 * source visible in results, which is exactly the failure this must prevent.
 */
const NAMESPACE = "northstar:retrieval";
const GENERATION_KEY = `${NAMESPACE}:generation`;
const TTL_SECONDS = 15 * 60;

/** Private personalized reports are never cached; only corpus lookups are. */
export type CacheKeyParts = {
  query: string;
  topic: Topic;
  region: string | null;
  embeddingModel: string;
  limit: number;
  minSimilarity: number;
};

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

async function currentGeneration(): Promise<string> {
  const value = await cacheGet(GENERATION_KEY);
  return value ?? "0";
}

function buildKey(generation: string, parts: CacheKeyParts): string {
  const canonical = [
    normalizeQuery(parts.query),
    parts.topic,
    parts.region ?? "-",
    parts.embeddingModel,
    String(parts.limit),
    parts.minSimilarity.toFixed(3),
  ].join("|");

  // Hashed so an arbitrarily long question cannot produce an oversized key, and
  // so the raw question text is not sitting in the Redis keyspace.
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `${NAMESPACE}:v${generation}:${digest}`;
}

export async function readCachedEvidence(parts: CacheKeyParts): Promise<EvidenceChunk[] | null> {
  const raw = await cacheGet(buildKey(await currentGeneration(), parts));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as EvidenceChunk[];
  } catch {
    // A corrupt entry is treated as a miss rather than propagated.
    return null;
  }
}

export async function writeCachedEvidence(
  parts: CacheKeyParts,
  evidence: readonly EvidenceChunk[],
): Promise<void> {
  await cacheSet(buildKey(await currentGeneration(), parts), JSON.stringify(evidence), TTL_SECONDS);
}

/**
 * Called whenever the published corpus changes — publish, retire, reinstate, or
 * re-ingest. Safe to call when Redis is absent: it becomes a no-op, and an
 * uncached deployment cannot serve a stale result anyway.
 */
export async function invalidateRetrievalCache(): Promise<void> {
  await cacheIncrement(GENERATION_KEY);
}
