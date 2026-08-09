# Migrations and rollback

How schema changes reach a database safely, and what to do when one goes wrong.

> No deployment exists. This runbook describes the intended production procedure; the commands have
> been exercised locally and in CI (Phase 8D), not against a production system.

## Before a migration

1. **Check the current state.** `pnpm exec prisma migrate status` must report the database up to
   date _before_ you add to it. Applying a new migration on top of an unexplained drift turns one
   problem into two.
2. **Take a backup and record its checksum.** See [backup-restore.md](backup-restore.md). A
   migration without a restorable checkpoint is a one-way door.
3. **Confirm the extensions.** `pnpm db:verify` asserts `vector`, `pg_trgm`, every table, and the
   `vector(1536)` column. Retrieval breaks in confusing ways when an extension is absent.
4. **Read the SQL.** Prisma generates it; nobody is required to accept it. Specifically look for:
   - a `DROP COLUMN` or `DROP TABLE` — irreversible without a restore
   - a column becoming `NOT NULL` without a default — fails on existing rows
   - a new `UNIQUE` constraint — fails on existing duplicates
   - a rename — Prisma often emits drop-then-add, which **discards the data**
   - a table rewrite or index build that will hold a lock longer than a deploy window
5. **Check that the current application version tolerates the new schema**, because for a short
   period both will be live at once.

## Applying it

```bash
pnpm db:deploy          # prisma migrate deploy
pnpm exec prisma migrate status
pnpm db:verify
```

Then check the application: `/api/v1/health` must stay 200 (it touches no dependency), and
`/api/v1/ready` must return 200 once PostgreSQL and Redis are both reachable. A 503 from readiness
with `"database": "unavailable"` after a migration is the signal to stop and investigate.

## Forbidden in production

| Command                                             | Why                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate dev`                                | Interactive, and rewrites migration history. It exists for authoring.                                                                  |
| `prisma db push`                                    | Applies the schema **without** recording a migration, so the ledger stops describing the database and every later deploy is guesswork. |
| `prisma migrate reset`                              | **Drops the database.** There is no production circumstance where this is the right command.                                           |
| Restoring over the only production database         | Removes the thing you would roll back to. Always restore into a new database.                                                          |
| Deleting migration rows to make `status` look clean | Hides drift instead of resolving it, and the next deploy inherits a database nobody can reason about.                                  |

## Forward-only, and expand/contract

**Migrations are forward-only.** There are no down migrations in this repository, and none should be
added: a generated `down` is a guess about intent, and it cannot restore data that a `DROP` removed.
When a change turns out to be wrong, write a _new_ migration that corrects it — exactly as
`20260805064500_drop_unmanaged_vector_index` corrected `20260805050000`.

For anything that would break a running application, split it across releases — **expand, migrate,
contract**:

1. **Expand.** Add the new column/table as nullable or defaulted. Deploy. Old and new code both work.
2. **Migrate.** Backfill, and start writing to both shapes. Deploy.
3. **Contract.** Once nothing reads the old shape, drop it. Deploy.

Each step is independently reversible by rolling back the _application_, which is far cheaper than
restoring a database. Doing all three at once is what turns a routine change into an incident.

## Rollback: application first

**Application rollback and database rollback are different operations with very different costs.**

Redeploying the previous application version is fast, reversible, and loses nothing. Restoring a
database means losing every write since the backup. Always ask whether the application rollback is
sufficient before reaching for the database.

**Application rollback is sufficient when** the migration was additive (new nullable column, new
table, new index), the previous version ignores what was added, and no data was destroyed or
transformed. This covers most migrations, and it is the whole point of expand/contract.

**Database restoration may be required when** a migration dropped or transformed data the previous
version needs, a destructive migration partially applied, or the data is corrupt rather than the
schema. Then follow [backup-restore.md](backup-restore.md): restore into a **new** database,
validate against the invariant list, and cut over only after it passes.

The decision hinges on one question: **was information destroyed?** If not, roll back the
application. If it was, you need the backup, and you accept the write loss between the backup and
now.

## Partial migration failure

PostgreSQL runs each migration in a transaction where it can, so a failed statement usually rolls
back that migration cleanly — but a migration containing multiple statements, or one that cannot run
transactionally, can leave the database between states.

1. **Stop.** Do not re-run `migrate deploy` hoping it settles.
2. `prisma migrate status` — it will name the failed migration.
3. `pnpm db:verify` and inspect the actual schema. Decide what really applied; the ledger records
   intent, the database holds truth.
4. Choose one:
   - **The migration did not apply at all.** Fix the SQL, and use
     `prisma migrate resolve --rolled-back <name>` so the ledger stops claiming it is in progress.
   - **It fully applied but was recorded as failed** (for example the connection dropped after
     commit). `prisma migrate resolve --applied <name>`.
   - **It partially applied.** This is the hard case. Prefer restoring from the pre-migration backup
     into a new database over hand-patching production, unless the remaining work is a single
     obviously safe statement.

### `prisma migrate resolve` — narrow use only

It **edits the ledger; it does not touch the schema.** It is a way of telling Prisma what is already
true, never a way of making something true. Use it only when you have inspected the database and
know which state it is in. Using it to silence a failure produces a ledger that lies, and every
later deploy builds on that lie.

## Decision points and escalation

| Situation                                  | Action                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `migrate status` clean, app healthy        | Done. Record the migration in the release notes.                                                 |
| `migrate status` clean, app failing        | Application problem, not schema. Roll back the app.                                              |
| Migration failed, nothing applied          | Fix forward. Resolve as rolled-back, correct, redeploy.                                          |
| Migration partially applied, additive only | Complete it with a new migration if the remaining step is small and safe.                        |
| Migration partially applied, destructive   | **Escalate.** Restore from backup into a new database. Do not improvise on the live one.         |
| Data corrupt, schema fine                  | Restore. A migration cannot fix bad rows.                                                        |
| Unsure which state the database is in      | **Stop and escalate.** Guessing here is how a recoverable incident becomes a data-loss incident. |

Escalation means: stop making changes, capture the evidence listed in
[backup-restore.md](backup-restore.md), and get a second person to agree the plan before touching
the database again. There is no on-call rotation to name yet — that belongs with a deployment.

## Closeout checklist

- [ ] `prisma migrate status` reports up to date
- [ ] `pnpm db:verify` passes — extensions, tables, vector column
- [ ] `/api/v1/ready` returns 200
- [ ] `/api/v1/health` stayed 200 throughout
- [ ] A fresh backup has been taken **after** the change, with its checksum recorded
- [ ] If a restore happened: source-versus-restored invariants compared and matching
- [ ] The damaged or pre-migration database is retained, renamed, until closeout
- [ ] Evidence captured; no connection string, dump, token, or user data in the ticket
- [ ] What went wrong, and which check would have caught it earlier, written down
- [ ] If a check was missing, it is added to this runbook

## What is proven, and what is not

**Proven.** `migrate deploy`, `migrate status`, `db:verify`, and the seed workflow run correctly
against a database created from nothing — locally and on every CI run (Phase 8D). Restore into a new
database, with full invariant comparison, was executed in the Phase 8E drill.

**Not proven.** No migration has run against production, because none exists. No partial-failure
recovery has been rehearsed — the recovery paths above are reasoned from Prisma's documented
behaviour, not from an incident. Rehearsing a deliberately failing migration is worth doing once a
staging environment exists.
