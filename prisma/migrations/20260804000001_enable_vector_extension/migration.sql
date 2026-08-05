-- Enable the extensions the retrieval layer depends on.
--
-- docker/postgres/init/01-extensions.sql already does this for the local
-- container, but that script only runs against the main database. Prisma's
-- `migrate dev` validates against a throwaway shadow database, which gets no
-- init scripts — so without this the first migration declaring a `vector`
-- column fails with `type "vector" does not exist`.
--
-- Deliberately timestamped ahead of the guidance-engine migration so it replays
-- first. `IF NOT EXISTS` keeps it a no-op where the container already ran.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
