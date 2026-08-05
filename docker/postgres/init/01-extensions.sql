-- Runs once, on first initialization of an empty data volume.
-- `vector` is required by the Phase 4 retrieval layer; creating it here keeps
-- the extension out of Prisma migrations, which cannot install extensions in
-- every managed-Postgres environment.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
