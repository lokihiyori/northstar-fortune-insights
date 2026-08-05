import "server-only";

import { prisma } from "@/lib/db/prisma";
import { resolveEmbedder } from "@/features/guidance/ai";
import { toVectorLiteral, type Embedder } from "@/features/retrieval/embedder";
import { chunkContent, chunksUnchanged, type Chunk } from "./chunker";

/**
 * The single service boundary through which source content becomes retrievable
 * passages.
 *
 * Nothing else in the application writes `source_chunks`. Admin actions, the
 * seed script, and any future automated ingestion all come through here, so the
 * chunking and embedding rules cannot drift between callers.
 *
 * Content is treated strictly as untrusted data. It is chunked, hashed, and
 * embedded — never parsed for directives, and never executed. Instructions that
 * appear inside a source document reach the model only inside the fenced
 * EVIDENCE block, which the prompt marks untrusted (see ai/prompt.ts).
 */
export type IngestResult = {
  sourceId: string;
  chunkCount: number;
  embeddedCount: number;
  /** True when stored chunks already matched, so nothing was re-embedded. */
  skipped: boolean;
};

export type IngestOptions = {
  /** Injectable so tests and the seed can use the deterministic embedder. */
  embedder?: Embedder;
  /** Re-embed even when checksums match. */
  force?: boolean;
};

export async function ingestSourceContent(
  sourceId: string,
  content: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const embedder = options.embedder ?? resolveEmbedder();
  const chunks = chunkContent(content);

  if (chunks.length === 0) {
    // Replacing content with nothing would silently empty a live source, so the
    // caller is told rather than the corpus quietly shrinking.
    throw new Error("The supplied content produced no usable passages.");
  }

  const existing = await prisma.sourceChunk.findMany({
    where: { sourceId },
    orderBy: { position: "asc" },
    // `embedding` is an Unsupported column and cannot appear in a select at all.
    select: { checksum: true, embeddingModel: true },
  });

  const sameModel = existing.every((chunk) => chunk.embeddingModel === embedder.model);
  if (!options.force && sameModel && chunksUnchanged(existing, chunks)) {
    return { sourceId, chunkCount: existing.length, embeddedCount: existing.length, skipped: true };
  }

  const embeddings = await embedder.embed(chunks.map((chunk) => chunk.text));
  if (embeddings.length !== chunks.length) {
    throw new Error("The embedder returned a different number of vectors than passages.");
  }

  const embeddedCount = await writeChunks(sourceId, chunks, embeddings, embedder.model);

  return { sourceId, chunkCount: chunks.length, embeddedCount, skipped: false };
}

async function writeChunks(
  sourceId: string,
  chunks: readonly Chunk[],
  embeddings: readonly number[][],
  embeddingModel: string,
): Promise<number> {
  // Replaced wholesale rather than merged: positions shift when content is
  // edited, and a stale chunk left behind would keep being retrieved.
  const created = await prisma.$transaction(async (tx) => {
    await tx.sourceChunk.deleteMany({ where: { sourceId } });

    const ids: string[] = [];
    for (const chunk of chunks) {
      const row = await tx.sourceChunk.create({
        data: {
          sourceId,
          position: chunk.position,
          text: chunk.text,
          checksum: chunk.checksum,
          embeddingModel,
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    return ids;
  });

  // Prisma cannot write an `Unsupported` column, so vectors go in as raw SQL.
  // Outside the transaction above only because each statement is idempotent and
  // a partial failure leaves chunks without embeddings — which `checkPublishable`
  // then refuses to publish, rather than exposing a half-embedded source.
  let embeddedCount = 0;
  for (const [index, id] of created.entries()) {
    const vector = embeddings[index];
    if (!vector) continue;

    await prisma.$executeRawUnsafe(
      `UPDATE "source_chunks" SET "embedding" = $1::vector WHERE "id" = $2`,
      toVectorLiteral(vector),
      id,
    );
    embeddedCount += 1;
  }

  return embeddedCount;
}

/** Counts used by the publish check and the admin UI. */
export async function chunkStats(sourceId: string): Promise<{ total: number; embedded: number }> {
  const [total, embedded] = await Promise.all([
    prisma.sourceChunk.count({ where: { sourceId } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
        FROM "source_chunks"
       WHERE "sourceId" = ${sourceId} AND "embedding" IS NOT NULL
    `,
  ]);

  return { total, embedded: Number(embedded[0]?.count ?? 0) };
}
