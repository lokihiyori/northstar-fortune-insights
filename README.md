# NorthStar Fortune Insights

**AI guidance for clearer life and career decisions.**

NorthStar turns an uncertain question into a structured decision. Every generated insight answers
five things: what the recommendation is, why it fits this person, what evidence supports it, what
assumptions and trade-offs it carries, and what to do next.

It is decision support, not fortune-telling. It does not predict outcomes and does not replace
licensed professional advice.

## For reviewers

A portfolio codebase, not a product: **it is not deployed and is not production-ready.**

Deterministic adapters stand in for the paid services, so the complete core journey — sign up,
onboard, ask a question, generate a cited insight, compare paths, build a plan — runs locally with
no OpenAI key and no Stripe account.

If you are here to read code rather than run it, the load-bearing parts are the guidance
orchestration (`src/features/guidance/orchestrator.ts`), pgvector retrieval over a reviewed corpus,
Redis cache invalidation and rate limiting, the observability boundary, the database-backed test
suites, and a CI pipeline that runs against real PostgreSQL and Redis.

> **Status: Phases 0–8G complete.** Phases 0–7 are verified against a live database; Phase 8 adds
> security posture, rate limiting, observability, CI hardening verified by a real GitHub Actions
> run, operations runbooks with a verified backup/restore drill, a measured accessibility and
> performance audit, and an isolated, resettable recruiter demo mode. Repository and tooling; the Quiet Aurora design system and full marketing site;
> authentication and the Build-your-compass onboarding; the app workspace (guided composer, insight
> report, scenario comparison, action plans, history); the guidance engine — deterministic rules, pgvector
> retrieval over a reviewed corpus, structured generation behind a provider interface, and
> citation validation; action plans, feedback and report versioning; local billing, entitlements
> and analytics; and the admin area with source ingestion, lifecycle, and audit history. See
> [`docs/NORTHSTAR_BUILD_SPEC.md`](docs/NORTHSTAR_BUILD_SPEC.md) section 18 for the phase plan.
>
> Every flow is covered by Playwright tests that run against real PostgreSQL with no mocks.
> Warm-cache invalidation is additionally covered by an integration test that drives the real
> retrieval service against real PostgreSQL **and real Redis** (closed at commit `314ab45`): it
> proves a retired source stops being returned while its previous cache entry is still physically
> present in Redis — ruling out expiry or key deletion as the explanation.
>
> **No AI provider is required to run it.** Without `OPENAI_API_KEY` a deterministic provider is
> used, so the full pipeline works offline at zero cost. See [The guidance engine](#the-guidance-engine).
>
> **Accessibility and performance are measured, not claimed** (Phase 8F). Lighthouse scores
> **100/100 accessibility** on `/`, `/pricing`, `/app`, and `/admin`; an automated axe suite of 19
> tests reports **zero critical or serious violations** in both light and dark themes with no rule
> suppressed. The client bundle and vector retrieval up to 10,008 passages are both baselined. See
> [`docs/audits/accessibility.md`](docs/audits/accessibility.md) and
> [`docs/audits/performance.md`](docs/audits/performance.md). Automated tooling cannot certify WCAG
> conformance, and every measurement is local — neither is a production claim.
>
> **Known limitations**
>
> - **Stripe is verified in test mode, once — not in live mode, and not operationally.** A manually
>   completed Stripe-hosted Checkout Session created exactly one Customer, Subscription, and paid
>   Invoice on the server-owned CAD $18 monthly Price, with no duplicate subscription; two
>   concurrent tabs converged on one attempt; `userId` and `attemptId` propagated from the Session
>   to the Subscription; genuine signed webhooks moved the projection FREE → PLUS and back to FREE
>   on cancellation; and a duplicate upgrade was refused. Delivery was through `stripe listen`, not
>   a deployed public endpoint, and the Customer Portal has not been re-exercised since the
>   concurrency fixes. Declined cards, 3DS/SCA, `past_due`, `unpaid`, `paused`, proration, webhook
>   retries, delayed or out-of-order delivery, and endpoint-secret rotation remain unverified.
>   Billing still degrades cleanly without keys — the upgrade path is disabled and explained rather
>   than failing.
> - **Tax and multi-currency are not implemented.** Pricing is CAD-only. There is no `automatic_tax`
>   configuration and no tax registration, so nothing here is ready for live payments.
> - **The real OpenAI embedder is not wired up.** `resolveEmbedder()` always returns the
>   deterministic embedder. Switching would require re-embedding the whole corpus, which needs a
>   migration strategy rather than a flag flip.
> - **Source ingestion is paste-only, by design.** An admin supplies text; there is no remote URL
>   fetching, HTML extraction, or scheduled re-ingestion. Fetching remote content raises SSRF and
>   content-trust questions that deserve their own design.
> - **CI is verified remotely** as of Phase 8D — a real GitHub Actions run executes both jobs
>   against PostgreSQL 17 with pgvector and Redis service containers, applying migrations, seeding,
>   and running the integration and full e2e suites. See [`docs/CI.md`](docs/CI.md).
> - **No production backup exists.** A full `pg_dump` → `pg_restore` cycle has been drilled against
>   real PostgreSQL 17 + pgvector and independently verified (Phase 8E), but no backup provider is
>   configured, nothing is scheduled, no production restore has been performed, and RPO/RTO remain
>   TBD. See [`docs/operations/backup-restore.md`](docs/operations/backup-restore.md).
> - **No deployment exists**, so nothing here has run in production. The trusted-proxy hop count is
>   still undecided, which leaves the per-IP rate-limit policies inert (ADR 0008).
> - **CI does not serve the production build during e2e.** `next start` refuses to boot without an
>   https, non-localhost app URL, and production `Secure` cookies cannot be stored over http, so
>   authenticated tests cannot pass against it. `pnpm build` proves the production build compiles;
>   serving it under test needs real https, which is deployment work.

---

## Requirements

| Tool           | Version | Notes                                       |
| -------------- | ------- | ------------------------------------------- |
| Node.js        | ≥ 20.11 | Developed against 22.x                      |
| pnpm           | ≥ 10    | `npm install -g pnpm`, or `corepack enable` |
| Docker Desktop | current | Provides local PostgreSQL and Redis         |

## Local setup

```bash
# 1. Install dependencies (also generates the Prisma client)
pnpm install

# 2. Create your local environment file
cp .env.example .env        # Windows: copy .env.example .env

# 3. Start PostgreSQL and Redis
pnpm db:up

# 4. Apply migrations and seed development data
pnpm db:migrate
pnpm db:seed

# 5. Run the app
pnpm dev
```

The app is served at <http://localhost:3000>. Liveness: <http://localhost:3000/api/v1/health>.

`pnpm db:up` waits on container health checks — `pg_isready` for PostgreSQL and `redis-cli ping` for
Redis. Confirm with `docker compose -f docker/docker-compose.yml ps`; both should report `healthy`.

To create a local admin account, set `SEED_ADMIN=true` in `.env` before running `pnpm db:seed`.
It is off by default so a real database can never be seeded with an elevated account by accident.

## Commands

| Command                 | What it does                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `pnpm dev`              | Development server                                           |
| `pnpm build`            | Production build                                             |
| `pnpm start`            | Serve the production build                                   |
| `pnpm format`           | Apply Prettier                                               |
| `pnpm format:check`     | Verify formatting (CI)                                       |
| `pnpm lint`             | ESLint                                                       |
| `pnpm typecheck`        | `tsc --noEmit`                                               |
| `pnpm test`             | Unit tests (Vitest) — no database required                   |
| `pnpm test:integration` | Integration tests — **requires PostgreSQL + Redis**          |
| `pnpm test:watch`       | Vitest in watch mode                                         |
| `pnpm test:coverage`    | Vitest with a V8 coverage report                             |
| `pnpm test:e2e`         | Playwright end-to-end tests (starts its own server)          |
| `pnpm test:e2e:install` | Install the Playwright browser (once, and in CI)             |
| `pnpm verify`           | format:check → lint → typecheck → test → build               |
| `pnpm db:up`            | Start PostgreSQL and Redis                                   |
| `pnpm db:down`          | Stop them, keeping data                                      |
| `pnpm db:reset`         | Stop them and **delete the volumes**                         |
| `pnpm db:migrate`       | Create and apply a migration                                 |
| `pnpm db:deploy`        | Apply existing migrations (deployment)                       |
| `pnpm demo:reset`       | Create or restore the recruiter demo account (operator only) |
| `pnpm db:seed`          | Seed development data                                        |
| `pnpm db:verify`        | Assert extensions, tables, and the pgvector column           |
| `pnpm audit:ci`         | Dependency audit, gating on high and critical                |
| `pnpm db:generate`      | Regenerate the Prisma client                                 |
| `pnpm db:studio`        | Prisma Studio                                                |

Run `pnpm verify` before opening a pull request. It runs format check, lint, typecheck, unit tests
and build — **not** the dependency audit, the integration tests, or the end-to-end tests. CI runs
those as well: `pnpm audit:ci` in the quality job, then the integration and Playwright suites
against real PostgreSQL and Redis. Add `pnpm audit:ci` locally to match the quality job, and run
`pnpm test:integration` and `pnpm test:e2e` when the change touches what they cover.

## Project structure

```text
src/
  app/                 Routing, layouts, and Route Handlers only — no business logic
    api/v1/            Versioned business APIs (ADR 0002)
  components/          Presentation; domain-agnostic primitives in ui/
  features/<domain>/   Business logic: auth, onboarding, guidance, retrieval, plans, billing
  lib/                 Shared infrastructure: db, redis, ai, security, env
  generated/prisma/    Prisma client — generated, gitignored
prisma/                schema.prisma, migrations, seed.ts
docker/                Local PostgreSQL and Redis
docs/
  adr/                 Architecture decision records
  NORTHSTAR_BUILD_SPEC.md
tests/
  unit/  integration/  e2e/
```

`@/*` resolves to `src/*`.

## Architecture

A modular monolith: one Next.js deployment, with boundaries enforced by directory structure and
typed interfaces rather than by separate services. PostgreSQL is the single source of truth; Redis
holds only cache, rate limits, idempotency keys, and short-lived state.

The decisions and their trade-offs are recorded in [`docs/adr/`](docs/adr/README.md):

1. [Modular monolith over microservices](docs/adr/0001-modular-monolith.md)
2. [Versioned Route Handlers for business APIs](docs/adr/0002-route-handlers-for-business-apis.md)
3. [PostgreSQL with Prisma, including vector search](docs/adr/0003-postgresql-with-prisma.md)
   — read the Phase 4 revision before touching migrations or the vector column
4. [Redis is cache and coordination only](docs/adr/0004-redis-scope.md)
5. [Accepting Auth.js v5 while it is still beta](docs/adr/0005-authjs-v5-beta.md)
6. [JWT sessions, authorization enforced in layouts](docs/adr/0006-jwt-sessions-and-layered-authorization.md)

## Environment variables

`.env.example` lists every variable, grouped by the phase that introduces it. It contains **names
only** — never commit a populated `.env`.

Phase 0 needs just `DATABASE_URL` (and optionally `REDIS_URL`). Validation lives in
`src/lib/env/schema.ts`; later-phase provider keys are declared but optional until the phase that
depends on them tightens them.

## Testing

- **Vitest + React Testing Library** — `tests/unit`, `tests/integration`. Vitest is scoped to those
  directories so it never picks up Playwright specs.

  `pnpm test` runs **only** `tests/unit`, which need no services, so `pnpm verify` stays runnable
  on a bare checkout. `pnpm test:integration` runs `tests/integration`, which talk to real
  PostgreSQL **and real Redis**.

  `tests/integration/retrieval-cache.test.ts` proves warm-cache invalidation end to end: it
  publishes a source, populates the cache through the real `retrieveEvidence` service, retires the
  source through the real lifecycle service, and shows the retired source is no longer returned —
  while the previous cache entry is _still physically present in Redis and still contains it_. That
  rules out expiry or key deletion as the explanation, leaving only the generation bump. Deleting
  the `invalidateRetrievalCache()` call makes this test fail.

- **Playwright** — `tests/e2e`. Starts its own server with `pnpm dev`, locally **and** in CI; see
  [`docs/CI.md`](docs/CI.md) for why `pnpm start` cannot serve it. It never reuses an already
  running server, so **port 3000 must be free before a local run** — otherwise the run stops
  immediately rather than testing against a server configured differently from the suite.
  Run `pnpm test:e2e:install` once before the first run.

`tests/e2e/auth-flows.spec.ts`, `tests/e2e/guidance.spec.ts`, and `tests/e2e/admin.spec.ts`
**require a running, migrated, seeded database** — start it with `pnpm db:up && pnpm db:migrate && pnpm db:seed` first. They
deliberately use no mocks and no injected session: they drive the real sign-in, sign-up,
onboarding, generation, and planning flows, then assert the resulting rows in PostgreSQL, so a
flow that renders correctly but persists nothing fails. Accounts are created on `@northstar.test`
and removed by a global teardown, which also cleans up after a crashed run.

The AI layer is **not** mocked. Tests run the real pipeline against the deterministic provider,
which is selected automatically when `OPENAI_API_KEY` is unset — so no test can spend money, and
the code path under test is the same one production uses. Evaluation against a real provider is a
separate, explicit command with a cost limit (spec section 16) and arrives with the evaluation
work in Phase 8.

## Authentication

Email/password plus optional Google, via Auth.js v5. Two decisions are worth reading before
touching this area:

- **Auth.js is pinned to an exact beta version** ([ADR 0005](docs/adr/0005-authjs-v5-beta.md)).
  Do not widen it to a caret range.
- **Sessions are JWT, and the proxy is not the security boundary**
  ([ADR 0006](docs/adr/0006-jwt-sessions-and-layered-authorization.md)). Every protected
  layout, page, and Route Handler calls a guard from `src/features/auth/guards.ts` itself.

Passwords use scrypt from `node:crypto` — no native dependency, and the work factor is stored
in each hash so it can be raised later without invalidating existing passwords.

`AUTH_SECRET` is required. Generate one with `npx auth secret`. Google is optional locally; the
button is hidden when its credentials are unset.

After seeding, sign in as `dev@northstar.local` with password `northstar-dev-password`.

## The guidance engine

The interesting part is not the model call — it is what surrounds it. The pipeline
(`src/features/guidance/orchestrator.ts`, spec section 9) runs:

1. **Deterministic rules** (`features/guidance/rules`) — pure functions with stable IDs. They
   check constraints and refuse high-stakes medical, legal, and investment questions _before_
   anything is generated.
2. **Retrieval** (`features/retrieval`) — pgvector cosine search restricted to `PUBLISHED`,
   non-deleted sources, filtered by topic and region before ranking.
3. **Generation** — behind the `GuidanceProvider` interface, under a timeout.
4. **Two validation gates** — the strict Zod schema, then the citation allow-list. A report
   citing a `sourceId` that was not retrieved is **rejected outright**, never repaired. A path
   with no evidence can never claim a `STRONG` fit; that is enforced by the schema itself.
5. **Persistence** — report, paths, reasons, actions, and citations in one transaction, with a
   snapshot of the evidence the model actually saw.

Confidence is derived from the rules and the evidence count — never asserted by the model — and
is never shown without the reasons that produced it.

### Running without an AI provider

With no `OPENAI_API_KEY`, `resolveProvider()` returns a deterministic provider that composes a
schema-valid report from the real question, criteria, and retrieved evidence, citing only source
IDs that were genuinely retrieved. It is not a stub — the whole pipeline is exercised end to end.
This is how tests and CI run, so no test can quietly spend money.

With a key set, `openai-provider.ts` uses the Responses API with a strict JSON schema. Its output
still goes through the same validation, because provider-side schema enforcement cannot check the
citation allow-list.

## Admin and source ingestion

Only **published** sources are retrievable. Everything the guidance engine can cite passes through
the admin area first.

### Creating an admin

There is deliberately **no way to become an admin through the application** — sign-up always
creates a regular user. Create one out-of-band:

```bash
# In .env, then re-seed. Off by default so a real database is never seeded with
# an elevated account by accident.
SEED_ADMIN=true
pnpm db:seed
```

That creates `admin@northstar.local` with the same development password as the seeded user
(printed by the seed command). **These are local development credentials only.** No production,
third-party, or externally usable credential is committed. The deterministic seed credentials above
_are_ committed on purpose — they are part of the documented setup, and they authenticate only
against a database the developer created locally.

To promote an existing account instead:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'you@example.com';
```

The role is carried in the session token, so **sign out and back in** after promoting an account.

### The source lifecycle

`Draft → Reviewed → Published → Retired`, at `/admin/sources`.

- **Draft** — being prepared. Not retrievable.
- **Reviewed** — checked by a person. Still not retrievable.
- **Published** — retrievable by the guidance engine.
- **Retired** — excluded from new reports, but still resolvable for reports that already cited it.

Publishing requires complete metadata **and** fully embedded passages. A source cannot skip
review, and a published source cannot go back to draft — the only way out is retirement, because
reports may already cite it.

Canonical URLs are normalised on save: `https` is forced, `www.`, fragments, and tracking
parameters are stripped, and query parameters are sorted. Adding the same page twice under
cosmetic variations is refused with a 409.

Ingested content is treated strictly as **evidence, never instructions** — it is chunked, hashed,
and embedded, and reaches the model only inside the fenced EVIDENCE block.

Publishing or retiring invalidates the Redis retrieval cache. Redis is optional and fail-open: with
no `REDIS_URL`, or with Redis down, retrieval simply runs uncached.

Every source mutation writes an append-only `AuditLog` record — visible on the source page and on
`/admin`.

## Security posture

Recorded in [ADR 0007](docs/adr/0007-security-headers-and-env-validation.md).

### Environment validation

`src/instrumentation.ts` validates the environment once, at server startup, before any request is
served — its `register()` delegates to `src/instrumentation-node.ts`, which holds the Node-only
startup path so the shared entry stays safe to compile for the Edge runtime. Variables are graded
rather than treated as one list:

| Tier                          | Variables                                                               |
| ----------------------------- | ----------------------------------------------------------------------- |
| Always required               | `DATABASE_URL`                                                          |
| Production runtime only       | `AUTH_SECRET` (≥32 chars), `NEXT_PUBLIC_APP_URL` (https, not localhost) |
| Provider groups (all or none) | Stripe (3), Google (2)                                                  |
| Optional everywhere           | `REDIS_URL`, `DIRECT_DATABASE_URL`, `OPENAI_*`, `SEED_ADMIN`            |

Two consequences worth knowing:

- **A build does not require runtime secrets.** `next build` runs with `NODE_ENV=production`, so
  production checks are skipped during the build phase. CI never needs an `AUTH_SECRET`.
- **Missing Stripe/OpenAI keys never block local startup.** The deterministic provider is selected
  and the upgrade path is disabled; startup logs say so by name.

Validation errors name the variable and the rule and **never print the value**. In production a
failure exits the process non-zero so a supervisor sees it; in development it is rethrown.

### Security headers

Applied to every route from `next.config.ts`:

| Header                                | Value                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `Content-Security-Policy-Report-Only` | Narrow policy, no wildcards, `frame-ancestors 'none'`                           |
| `X-Content-Type-Options`              | `nosniff`                                                                       |
| `X-Frame-Options`                     | `DENY`                                                                          |
| `Referrer-Policy`                     | `strict-origin-when-cross-origin`                                               |
| `Permissions-Policy`                  | Camera, microphone, geolocation, payment, USB and more denied                   |
| `Strict-Transport-Security`           | **Production only** — sending it over local http would pin `localhost` to https |

> **CSP is Report-Only and blocks nothing.** It reports violations; it does not yet protect against
> them. The blockers to enforcement are listed in `CSP_ENFORCEMENT_BLOCKERS` in
> `src/lib/security/headers.ts` — chiefly that `script-src` still needs `'unsafe-inline'`, and
> removing it requires per-request nonces that would force dynamic rendering on all ten currently
> static marketing routes.

### Authentication cookies

`buildCookieOptions()` states the posture explicitly instead of inheriting it: `HttpOnly` always,
`SameSite=Lax`, `Path=/`, and `Secure` plus the `__Secure-`/`__Host-` prefixes in production only.

`SameSite=Lax` rather than `Strict` is deliberate — Strict would strip the cookie from the OAuth
callback navigation and break Google sign-in, while Lax still withholds it from cross-site POSTs.

### Rate limiting and abuse protection

Recorded in [ADR 0008](docs/adr/0008-rate-limiting.md). Every limit lives in
`src/lib/rate-limit/policies.ts`; route handlers and server actions choose an operation, never a
number.

| Policy                | Counted against  | Limit | Window | On Redis failure |
| --------------------- | ---------------- | ----- | ------ | ---------------- |
| `AUTH_IP`             | client address   | 20    | 10 min | closed           |
| `AUTH_IDENTIFIER`     | account (hashed) | 5     | 15 min | closed           |
| `SIGN_UP`             | client address   | 5     | 60 min | closed           |
| `SIGN_UP_IDENTIFIER`  | account (hashed) | 3     | 60 min | closed           |
| `GUIDANCE_USER`       | user             | 3     | 15 min | closed           |
| `GUIDANCE_IP`         | client address   | 10    | 15 min | closed           |
| `REGENERATION_USER`   | user             | 5     | 60 min | closed           |
| `ADMIN_MUTATION_USER` | user             | 30    | 10 min | closed           |
| `ADMIN_MUTATION_IP`   | client address   | 60    | 10 min | closed           |
| `READ_API_USER`       | user             | 300   | 5 min  | **open**         |

Behaviour worth knowing:

- **Sign-in reserves capacity before verifying the password, then refunds it on success.** Signing in
  successfully never consumes budget, so you cannot lock yourself out by using the product — and
  because the reservation is atomic, a burst of simultaneous attempts cannot slip past the limit
  together. A provider or database fault refunds too: it is not evidence about the caller.
- **Exceeding a limit returns 429** with the standard error envelope, `code: "RATE_LIMITED"`, a
  `requestId`, and a `Retry-After` header. The message is identical everywhere, so a locked account
  cannot be told apart from an address that was never registered.
- **A Redis outage on a fail-closed operation returns 503 `SERVICE_UNAVAILABLE`**, not 429 — the
  cause is ours, not the caller's. Ordinary reads keep serving.
- Nothing readable reaches Redis: identifiers and addresses are HMAC-hashed with `AUTH_SECRET`, and
  values are counters. Keys are `northstar:rl:v1:<policy>:<digest>`.

> **`X-Forwarded-For` is ignored unless you say otherwise.** `RATE_LIMIT_TRUSTED_PROXY_HOPS`
> defaults to `0`, so **the four per-address policies above currently do nothing**. The header is
> client input; believing it would let an attacker invent a new address per request, which is worse
> than no limit because it looks like protection. Set the variable to the real number of proxies in
> front of the app once a deployment is chosen. Until then, protection rests on the per-user and
> per-account policies.

Testing locally: the e2e suite runs the **real** policies — nothing is disabled and no test-only
values are substituted. Test subjects are unique per test, and global teardown clears the
`northstar:rl:v1:*` keyspace so repeated runs stay independent. `pnpm test:integration` exercises
the Lua script, expiry, and concurrency against a real Redis.

### Observability

Recorded in [ADR 0009](docs/adr/0009-observability.md).

**Request correlation.** Every `/api/v1/*` response carries `X-Request-ID`, and the same id appears
in the error envelope's `requestId` and in every log line for that request — so a user quoting a
reference lands an operator on the right line. A client may supply its own `X-Request-ID`; it is
honoured only if it matches `^[A-Za-z0-9_-]{8,64}$` and is replaced otherwise.

**Log schema.** One JSON object per line in production. Fields are allow-listed, never denied:

| Field                          | Present          | Meaning                                           |
| ------------------------------ | ---------------- | ------------------------------------------------- |
| `timestamp`, `level`, `event`  | always           | ISO-8601, `debug`–`error`, closed event name      |
| `requestId`, `method`, `route` | inside a request | route _template_, never a raw URL                 |
| `actorId`                      | where justified  | opaque user cuid, never an email                  |
| `status`, `durationMs`         | HTTP events      |                                                   |
| `errorCategory`, `errorType`   | failures         | coarse bucket, exception name (never its message) |

Event names: `startup.*`, `http.request_completed|failed`, `auth.sign_in_refused|sign_up_refused`,
`ratelimit.refused|backend_unavailable|degraded_open`, `guidance.accepted|completed|failed`,
`source.created|updated|ingested|reviewed|published|retired`, `readiness.checked`, `error.captured`,
`monitoring.capture_failed`, `analytics.write_failed`, `billing.request_failed`,
`webhook.processing_failed`.

**What never reaches a log**: passwords, `AUTH_SECRET`, `DATABASE_URL`, `REDIS_URL`, Stripe/OpenAI
keys, authorization or cookie headers, session tokens, complete email addresses, question text,
report content, source text, request bodies, query strings, Redis keys, and exception messages.
Objects are never serialized — a field must be a primitive with an allowed name. `LOG_LEVEL`
(`debug`|`info`|`warn`|`error`) tunes verbosity.

**Liveness vs readiness** — two endpoints, two questions:

|              | `/api/v1/health`      | `/api/v1/ready`          |
| ------------ | --------------------- | ------------------------ |
| Question     | is the process alive? | can it serve traffic?    |
| Dependencies | **none**              | PostgreSQL + Redis       |
| Codes        | always 200            | 200 ready, 503 not ready |

A 503 from readiness means PostgreSQL or Redis is unreachable: the body says which
(`{status, checks: {database, cache}}`, values `ok`/`unavailable`) and nothing else — no host, port,
credential, or driver message. Redis counts because rate limiting is fail-closed for sign-in
(ADR 0008), so an instance without it cannot authenticate anyone. Liveness deliberately keeps
answering 200 during either outage, so a dependency incident does not restart every instance.

> **No external monitoring backend is configured.** `captureException` / `captureMessage` exist
> behind a vendor-neutral interface, and the default adapter writes a structured log line — capture
> works and is visible, but nothing leaves the process. There is no alerting, retention, or
> dashboard. Attaching a vendor means writing one adapter and calling `setMonitoringAdapter` once
> from `instrumentation.ts`; no business code changes. That is Phase 8D work.

## Operations

| Document                                                              | Covers                                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Backup and restore](docs/operations/backup-restore.md)               | `pg_dump`/`pg_restore` patterns, integrity verification, restore validation, cutover and rollback, Redis as disposable state, the restore-drill checklist |
| [Migrations and rollback](docs/operations/migrations-and-rollback.md) | Pre-deployment checks, `migrate deploy`, forward-only and expand/contract, application vs database rollback, partial-failure recovery, closeout           |

**What Phase 8E proves.** A complete `pg_dump` → `pg_restore` cycle was executed against real
PostgreSQL 17.10 with pgvector 0.8.6, using two disposable databases and a custom-format archive.
The restored database was verified to reproduce the source across 24 invariants — extensions,
all 25 tables, `source_chunks.embedding` as `vector(1536)`, the `_prisma_migrations` ledger hash,
`migrate status`, corpus counts and lifecycle states, index inventory, and both a corpus fingerprint
and an embedding fingerprint. `pg_restore` exiting 0 was explicitly _not_ accepted as sufficient.

Running the drill locally (full checklist in the backup document):

```bash
# 1. Confirm you are on the PostgreSQL 17 pgvector container, not a native 14 on 5432
docker exec northstar-postgres psql -U northstar -d postgres -tAc "SHOW server_version_num;"

# 2. Create a disposable source, point ONLY the drill at it, and build it the production way
docker exec northstar-postgres psql -U northstar -d postgres -c "CREATE DATABASE northstar_restore_drill_source_$(date +%s);"
DATABASE_URL="postgresql://…/northstar_restore_drill_source_…" pnpm db:deploy
DATABASE_URL="…"  pnpm exec prisma migrate status
DATABASE_URL="…"  pnpm db:seed

# 3. Back up, checksum, and prove the archive is readable
docker exec northstar-postgres pg_dump -U northstar --format=custom --no-owner --no-acl --file=/tmp/d.dump <source>
docker exec northstar-postgres pg_restore --list /tmp/d.dump

# 4. Restore into a NEW database and validate it — never over your development database
docker exec northstar-postgres psql -U northstar -d postgres -c "CREATE DATABASE northstar_restore_drill_target_…;"
docker exec northstar-postgres pg_restore -U northstar --exit-on-error --no-owner --no-privileges --dbname=<target> /tmp/d.dump
DATABASE_URL="…/<target>" pnpm exec prisma migrate status
DATABASE_URL="…/<target>" pnpm db:verify

# 5. Compare invariants, then drop both databases and delete the dump
```

> **Limitations.** No production backup provider is configured and no backups are scheduled. No
> production restore has ever been performed. **RPO and RTO are TBD** — they cannot be estimated
> from a seeded corpus and need measuring against real data on real hardware. No deployment exists,
> and the production trusted-proxy hop count remains undecided, so per-IP rate limiting stays inert.
> Retention, encryption, and off-site storage in the backup document are labelled recommendations,
> not configuration.

## Audits

| Document                                      | Covers                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Accessibility](docs/audits/accessibility.md) | Lighthouse and axe results, the baseline findings and their fixes, contrast evidence, the keyboard/focus matrix, and what remains unproven |
| [Performance](docs/audits/performance.md)     | Lighthouse metrics, the client bundle baseline, the vector retrieval benchmark to 10,008 passages, and when to revisit indexing            |

**What Phase 8F proves.** `/`, `/pricing`, `/app`, and `/admin` score **100 accessibility** in
Lighthouse — the two authenticated routes measured while genuinely signed in, with the final URL
asserted so a redirect to `/sign-in` or onboarding cannot be mistaken for a pass. An automated axe
suite (`tests/e2e/accessibility.spec.ts`, 19 tests) reports **zero critical or serious violations**
across both themes, with **no rule and no selector excluded**. The audit began by finding real
failures, not by confirming an assumption: seven, including five colour tokens below 4.5:1 in the
light theme and white-on-teal at 1.84:1 in the dark theme. All were fixed by changing tokens and
attributes, never by suppressing a rule.

Measurement, not certification:

- **Automated tooling cannot certify WCAG conformance.** axe covers roughly a third to a half of the
  success criteria. No general WCAG 2.2 AA claim is made for the product.
- **Everything is local.** One workstation, co-located database and cache, no network latency, no
  concurrent load. **No production performance or scalability claim is made.**
- `/app` and `/admin` performance figures come from the **development** server, because production
  `Secure` cookies cannot be stored over http; they are not comparable to the public routes.
- No screen-reader, magnification, voice-control, or assistive-technology testing was performed.

```bash
pnpm exec playwright test tests/e2e/accessibility.spec.ts
```

## Recruiter demo

A visibly labelled, isolated, resettable demo workspace (Phase 8G). Off by default.

```bash
# .env — placeholders in .env.example
DEMO_MODE_ENABLED="true"
DEMO_ACCOUNT_EMAIL="demo@northstar.local"
DEMO_ACCOUNT_PASSWORD="a-long-random-passphrase"

pnpm demo:reset   # create or restore the demo account
pnpm dev          # sign-in page now offers "Explore the demo"
```

Demo status is **derived on the server** from the authenticated address against a reserved,
server-owned value. There is deliberately no `NEXT_PUBLIC_` flag and no demo claim in the token, so
a browser cannot assert it — and no schema column was needed, because the email is unique,
normalized at both auth entry points, and immutable.

Every authenticated demo page carries a persistent banner: _Demo workspace — fictional data. Changes
are temporary. Do not enter personal information._ Normal accounts never see it.

The demo account is `USER` and stays that way. Admin pages and APIs refuse it, Stripe Checkout and
the Customer Portal refuse it **server-side** (so no upgrade button is shown that would fail after
the click), and it can read the shared published corpus but never mutate it.

`pnpm demo:reset` is an operator CLI — there is no HTTP reset endpoint. It refuses an unsafe
configuration, targets one exact user id, and never performs a broad delete. Full script, guard
table, and limitations in [`docs/demo.md`](docs/demo.md).

**Known limitations:** the demo is a single shared account, resets are manual, concurrent visitors
collide, and rate limits still apply. No deployment, no real Stripe, no real OpenAI.

## Troubleshooting: port 5432 already in use

The Docker services publish on **55432** (PostgreSQL) and **56379** (Redis), not the defaults.

If a native PostgreSQL is already running on the host, it binds IPv4 `0.0.0.0:5432` and Docker's
proxy is left with only the IPv6 wildcard. `localhost` resolves to IPv4 first, so a client aimed
at the container reaches the _native_ server instead. It fails as an authentication error rather
than a connection error, which is thoroughly misleading:

```
Error: P1000: Authentication failed against database server,
the provided database credentials for `northstar` are not valid.
```

Two ways to tell which server answered:

```bash
# The container reports PostgreSQL 17.x (Debian); a local install usually differs.
docker exec northstar-postgres psql -U northstar -d northstar -c "select version();"

# Windows: see who owns the port. A `postgres` process here is a native install.
Get-NetTCPConnection -LocalPort 5432 -State Listen |
  ForEach-Object { (Get-Process -Id $_.OwningProcess).ProcessName }
```

If you have no local PostgreSQL, set `POSTGRES_PORT=5432` and `REDIS_PORT=6379` in `.env` and
update the two URLs to match. `pnpm db:up` passes `--env-file .env` to compose, so those values
drive both the published ports and the connection strings from one place.

## License

Copyright © 2026 Kaisheng Liu. All rights reserved.

This repository is published for portfolio review. No open-source license is granted for copying,
modifying, distributing, sublicensing, or using the code outside the rights provided by GitHub's
Terms of Service.
