# Backup and restore

How to back up the NorthStar database, how to restore it, and — as important — what has actually
been proven versus what has not.

> **What Phase 8E proves.** A complete `pg_dump` → `pg_restore` cycle was executed against real
> PostgreSQL 17.10 with pgvector 0.8.6, using two disposable databases, and the restored database
> was verified to reproduce the source across 24 invariants including a corpus fingerprint and an
> embedding fingerprint.
>
> **What it does not prove.** No production backup provider is configured. No backup is scheduled.
> No production restore has ever been performed. RPO and RTO are undecided. No deployment exists.
> Everything below the "Production expectations" heading is a recommendation, not a running system.

## Supported versions

| Component                | Version                   | Where it comes from                                     |
| ------------------------ | ------------------------- | ------------------------------------------------------- |
| PostgreSQL               | **17** (drilled on 17.10) | `pgvector/pgvector:pg17` in `docker/docker-compose.yml` |
| pgvector                 | **0.8.6**                 | same image                                              |
| `pg_dump` / `pg_restore` | **17.10**                 | the same container                                      |

**Client and server major versions must match.** A PostgreSQL 14 client cannot read a 17 custom
archive, and this machine has a native PostgreSQL 14 on port 5432 — see the port note in the README.
Run the tools from inside the container (`docker exec northstar-postgres pg_dump …`) and the
question does not arise.

`pg_trgm` and `vector` must exist in the target before or as part of the restore. Both are created
by migration `20260804000001_enable_vector_extension`, so a restore into an empty database brings
them with it; the drill confirmed this on a database that started with zero extensions.

## Prerequisites

- The database is reachable and healthy (`pg_isready`).
- Enough disk for the archive **outside the repository**. A dump of the seeded corpus is ~75 KB;
  a real corpus with embeddings will be dominated by the `vector(1536)` columns.
- A destination that is not the live database. Restores go into a **new** database, always.
- Credentials supplied through the environment, never on the command line.

## Backup

```bash
docker exec northstar-postgres pg_dump \
  -U "$POSTGRES_USER" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=/tmp/northstar.dump \
  "$POSTGRES_DB"
```

**Custom format (`-Fc`), not plain SQL.** It is compressed, and `pg_restore` can list its contents,
restore selectively, and stop on the first error. A plain `.sql` file is a script: `psql` will
happily run past a failure and leave a half-restored database that looks like it worked.

**`--no-owner` and `--no-acl`** deliberately drop ownership and grant metadata. The restoring role
becomes the owner. This is what makes an archive portable between environments whose role names
differ, and it means the archive carries no information about who has access where. Grants are
re-applied by whatever provisions the destination, not by the backup.

Never write the archive inside the working tree. `.gitignore` does not cover every name a dump might
take, and a committed dump is a database leak.

## Integrity verification

Record a checksum at creation and re-check it before restoring:

```bash
sha256sum northstar.dump          # Linux/macOS
Get-FileHash northstar.dump -Algorithm SHA256   # PowerShell
```

Prove the archive is readable _before_ trusting it:

```bash
docker exec northstar-postgres pg_restore --list /tmp/northstar.dump
```

This reads the table of contents without touching a database. An archive that cannot be listed is
corrupt, and finding that out during an incident is the worst possible time.

## Restore

**Into a new database. Never over the live one.**

```bash
docker exec northstar-postgres psql -U "$POSTGRES_USER" -d postgres \
  -c 'CREATE DATABASE northstar_restore_<timestamp>;'

docker exec northstar-postgres pg_restore \
  -U "$POSTGRES_USER" \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --dbname=northstar_restore_<timestamp> \
  /tmp/northstar.dump
```

**`--exit-on-error` is not optional.** Without it `pg_restore` continues past failures and exits 0,
which produces a database that is silently missing objects. With it, a non-zero exit is the signal
to stop and investigate rather than cut over.

`pg_restore` exiting 0 is **not** the acceptance criterion. Validate before cutover.

## Validation before cutover

Run against the restored database, never the live one:

```bash
DATABASE_URL="postgresql://…/northstar_restore_<timestamp>" pnpm exec prisma migrate status
DATABASE_URL="postgresql://…/northstar_restore_<timestamp>" pnpm db:verify
```

Then compare invariants against the source. The drill compared 24; the ones that matter most:

| Invariant                                                            | Why it matters                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `server_version_num`                                                 | A cross-major restore is not supported                                           |
| `vector`, `pg_trgm` present                                          | Retrieval fails without them                                                     |
| table count                                                          | A partial restore shows up here                                                  |
| `source_chunks.embedding` is `vector(1536)`                          | The column can survive as the wrong type                                         |
| `_prisma_migrations` count **and** a hash of `(name, checksum)`      | Proves the ledger, not just the row count                                        |
| `prisma migrate status` up to date                                   | Schema and ledger agree                                                          |
| published-source and passage counts                                  | The corpus is complete                                                           |
| source status histogram                                              | Lifecycle states survived                                                        |
| row counts for non-sensitive tables                                  | Nothing silently truncated                                                       |
| **corpus fingerprint** — `md5` over `(sourceId, position, checksum)` | Content identity without reading content                                         |
| **embedding fingerprint** — `md5` over hashed vectors                | A truncated or reordered embedding changes this even when the row count does not |
| index inventory                                                      | Constraints and lookups came back                                                |

Fingerprints use identifiers and existing checksums only. No email address, profile field, question,
report, prompt, token, or billing record is ever selected, so the output is safe to paste into an
incident ticket.

> **There is no ANN index to verify.** An HNSW index existed briefly and was dropped in migration
> `20260805064500`; Prisma cannot manage indexes on `Unsupported` columns, so it was permanent drift
> (ADR 0003). Retrieval uses an exact cosine scan. The three indexes on `source_chunks` are the
> primary key, the `sourceId` lookup, and the `(sourceId, position)` unique constraint. If an ANN
> index is ever added as an operational step, add it to the validation list.

## Cutover, conceptually

No deployment exists, so this is a description of intent rather than a runbook that has been
executed:

1. Restore into a new database and validate it, as above.
2. Stop writes to the damaged database — take the application down or put it in a read-only mode.
   A restore taken while writes continue is stale the moment it completes.
3. Repoint `DATABASE_URL` at the validated database and restart. Startup validation
   (`src/instrumentation.ts`) fails fast if the new value is malformed.
4. Confirm `/api/v1/ready` returns 200 — it probes PostgreSQL and Redis with bounded timeouts.
5. Keep the damaged database intact, renamed, until the incident is closed. It is evidence.

## Rollback from a failed restore or cutover

Because the restore went into a _new_ database, the original is still there. Rollback is repointing
`DATABASE_URL` back and restarting. That property is the entire reason for the "never restore over
the live database" rule — it makes the failure recoverable rather than terminal.

If the original is genuinely unusable, restore a second copy from an **earlier** archive into
another new database and validate it the same way. Do not re-run a failed restore over a
half-restored database; start from a clean one.

## Redis

**Redis is not backed up, and must not be treated as a system of record.** It holds the retrieval
cache, rate-limit counters, and short-lived state (ADR 0004). Everything in it is derivable or
expendable:

- retrieval cache — rebuilt on demand; a cold cache is slower, never wrong
- rate-limit counters — losing them resets allowances early, which is a fairness annoyance, not a
  correctness problem
- the generation counter — bumping it only invalidates more than necessary

Restoring PostgreSQL alongside an unrelated Redis is safe. The one consequence worth knowing: rate
limiting is **fail-closed** for sign-in and generation (ADR 0008), so an empty or unavailable Redis
blocks authentication until it recovers. Redis needs to be _available_, not _restored_.

## Production expectations — recommendations, not configuration

Nothing here is set up. These are the decisions that need making when a host is chosen, with
suggested starting points labelled as such.

**Encryption.** Archives must be encrypted at rest and in transit. `--no-acl` removes grant metadata
but a dump still contains every row, including password hashes and personal data. _Recommendation:_
encrypt with a key held separately from the backup store, so possession of the bucket is not
possession of the data.

**Access control.** Backup creation and backup _reading_ should be separate privileges. A compromised
application credential should not be able to download the entire database. _Recommendation:_ a
write-only path for the backup job, restore access limited to named operators.

**Off-site storage.** A backup on the same host as the database is not a backup. _Recommendation:_ a
different provider or at minimum a different region.

**Retention.** _Recommendation (TBD until a provider is chosen):_ daily for 7 days, weekly for 4
weeks, monthly for 6 months — with at least one restore drill per quarter against a real archive,
because an untested backup is a hypothesis.

**Schedule, RPO, RTO — all TBD.** Deliberately not invented here. RPO follows from backup frequency
plus whether write-ahead-log shipping is used; RTO follows from archive size and restore throughput,
which cannot be estimated from a 75 KB seeded corpus. Both need measuring against a real dataset on
real hardware.

## Incident evidence

**Retain:** the archive checksum and its size; `pg_restore --list` output; `prisma migrate status`
before and after; the invariant comparison table; timestamps; who did what; the damaged database,
renamed, until closeout.

**Do not retain, and do not paste into a ticket:** connection strings containing passwords, the dump
itself, `.env` files, session tokens or cookies, user emails, profile fields, question text, report
content, prompts, or billing records. The validation queries in this document are built from
aggregates and hashes precisely so an incident can be discussed without any of that.

## Restore-drill checklist

Run this before you need it. Every command has been executed exactly as written.

1. Confirm the server is PostgreSQL 17 and the pgvector image — not the native 14 on port 5432.
2. Choose two names with a distinctive, unmistakable prefix, e.g.
   `northstar_restore_drill_source_<suffix>` and `…_target_<suffix>`.
3. **Guard before every create or drop.** Resolve the literal name; reject empty; reject `postgres`,
   `template0`, `template1`, and the configured development database; require the drill prefix;
   assert source ≠ target; reject any name containing `*`, `$`, or `%` — an unexpanded variable must
   never reach a `DROP`.
4. Create the source database.
5. Point **only the drill process** at it. Never export the drill URL into a shell that later runs
   ordinary commands.
6. `pnpm db:deploy` — never `migrate dev`, `db push`, or `migrate reset`.
7. `pnpm exec prisma migrate status`.
8. `pnpm db:seed`.
9. Capture source invariants and fingerprints.
10. `pg_dump --format=custom --no-owner --no-acl`, writing outside the repository.
11. Record the SHA-256 and size. Do not print the contents.
12. `pg_restore --list` to prove readability.
13. Create the empty target database.
14. `pg_restore --exit-on-error --no-owner --no-privileges`.
15. `prisma migrate status` and `pnpm db:verify` against the **target**.
16. Capture target invariants and compare. Every one must match.
17. Drop both databases behind the same guard; delete the dump from host and container.
18. Confirm no `northstar_restore_drill_%` database and no dump file remain.
19. Confirm the development database is unchanged.

## Cleanup

The drill creates three things — two databases and a dump — and all three must go:

```sql
DROP DATABASE IF EXISTS northstar_restore_drill_source_<suffix>;
DROP DATABASE IF EXISTS northstar_restore_drill_target_<suffix>;
```

```bash
docker exec northstar-postgres rm -f /tmp/northstar.dump
rm -rf "<host temp dir>"
```

Then verify, rather than assume:

```sql
SELECT datname FROM pg_database WHERE datname LIKE 'northstar_restore_drill_%';  -- expect zero rows
```

A leftover drill database is not dangerous, but it is a copy of the data with a name nobody
recognises six months later.
