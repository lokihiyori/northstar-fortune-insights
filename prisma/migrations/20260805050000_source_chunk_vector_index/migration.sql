-- Vector index for retrieval similarity search.
--
-- Written by hand because Prisma cannot emit indexes for `Unsupported` columns.
-- HNSW rather than IVFFlat: it needs no training pass over existing rows, so it
-- behaves correctly on an empty table and as the corpus grows.
--
-- Cosine distance to match the `<=>` operator used by the retrieval repository.
CREATE INDEX IF NOT EXISTS "source_chunks_embedding_hnsw"
    ON "source_chunks" USING hnsw ("embedding" vector_cosine_ops);
