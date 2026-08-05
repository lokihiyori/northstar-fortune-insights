import "server-only";

import { prisma } from "@/lib/db/prisma";
import { toVectorLiteral } from "./embedder";
import { readCachedEvidence, writeCachedEvidence } from "./cache";
import type { Topic } from "@/features/guidance/types";

/**
 * A single retrieved passage, with the stable source ID the model must cite by.
 */
export type EvidenceChunk = {
  sourceId: string;
  chunkId: string;
  title: string;
  publisher: string;
  region: string;
  canonicalUrl: string;
  text: string;
  similarity: number;
};

export type RetrievalOptions = {
  topic: Topic;
  region: string | null;
  /** Cosine similarity floor. Below this a passage is noise, not evidence. */
  minSimilarity?: number;
  limit?: number;
  /**
   * The query text, used only to build a cache key. Retrieval itself works from
   * the embedding; without this the lookup simply runs uncached.
   */
  cacheKeyQuery?: string;
  embeddingModel?: string;
};

const DEFAULT_LIMIT = 8;
const DEFAULT_MIN_SIMILARITY = 0.12;

type Row = {
  sourceId: string;
  chunkId: string;
  title: string;
  publisher: string;
  region: string;
  canonicalUrl: string;
  text: string;
  distance: number;
};

/**
 * Retrieval is restricted to PUBLISHED, non-deleted sources filtered by topic
 * and region *before* ranking (spec section 9). A retired source stays attached
 * to reports that already cited it but can never enter a new one.
 *
 * Exact cosine distance via `<=>` with no ANN index — see ADR 0003 for why.
 */
export async function retrieveEvidence(
  queryEmbedding: readonly number[],
  options: RetrievalOptions,
): Promise<EvidenceChunk[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const literal = toVectorLiteral(queryEmbedding);

  // Corpus lookups only — a personalized report is never cached under a shared
  // key (spec section 9). Cached entries are scoped to a generation counter that
  // an admin publish or retirement bumps, so a retired source cannot survive in
  // a cached result.
  const cacheParts =
    options.cacheKeyQuery && options.embeddingModel
      ? {
          query: options.cacheKeyQuery,
          topic: options.topic,
          region: options.region,
          embeddingModel: options.embeddingModel,
          limit,
          minSimilarity,
        }
      : null;

  if (cacheParts) {
    const cached = await readCachedEvidence(cacheParts);
    if (cached) return cached;
  }

  // Region is matched loosely: a national source is relevant to every province,
  // so "Canada" must not be filtered out by a request from "Toronto, Ontario".
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT s."id"            AS "sourceId",
           c."id"            AS "chunkId",
           s."title",
           s."publisher",
           s."region",
           s."canonicalUrl",
           c."text",
           (c."embedding" <=> ${literal}::vector) AS "distance"
      FROM "source_chunks" c
      JOIN "sources" s ON s."id" = c."sourceId"
     WHERE s."status" = 'PUBLISHED'
       AND s."deletedAt" IS NULL
       AND s."topic" = ${options.topic}::"GuidanceTopic"
       AND c."embedding" IS NOT NULL
       AND (
             ${options.region}::text IS NULL
          OR s."region" = 'Canada'
          OR ${options.region}::text ILIKE '%' || s."region" || '%'
          OR s."region" ILIKE '%' || ${options.region}::text || '%'
       )
     ORDER BY c."embedding" <=> ${literal}::vector
     LIMIT ${limit}
  `;

  const evidence = rows
    .map((row) => ({
      sourceId: row.sourceId,
      chunkId: row.chunkId,
      title: row.title,
      publisher: row.publisher,
      region: row.region,
      canonicalUrl: row.canonicalUrl,
      text: row.text,
      // pgvector cosine distance is 1 - cosine similarity.
      similarity: 1 - Number(row.distance),
    }))
    .filter((chunk) => chunk.similarity >= minSimilarity);

  if (cacheParts) await writeCachedEvidence(cacheParts, evidence);

  return evidence;
}

/** The allow-list a generated citation is checked against. */
export function allowedSourceIds(evidence: readonly EvidenceChunk[]): Set<string> {
  return new Set(evidence.map((chunk) => chunk.sourceId));
}
