# NorthStar Fortune Insights

**AI guidance for clearer life and career decisions.**

NorthStar turns an uncertain question into a structured decision. Every generated insight answers
five things: what the recommendation is, why it fits this person, what evidence supports it, what
assumptions and trade-offs it carries, and what to do next.

It is decision support, not fortune-telling. It does not predict outcomes and does not replace
licensed professional advice.

> **Status: Phases 0–7 complete and verified against a live database.** Repository and tooling;
> the Quiet Aurora design system and full marketing site; authentication and the
> Build-your-compass onboarding; the app workspace (guided composer, insight report, scenario
> comparison, action plans, history); the guidance engine — deterministic rules, pgvector
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
> **Known limitations**
>
> - **Stripe is implemented but unverified.** Checkout, Customer Portal, and webhook handling have
>   never run against Stripe, because no test-mode credentials are configured. Billing degrades
>   cleanly without keys — the upgrade path is disabled and explained rather than failing. Do not
>   treat it as working until `stripe listen` has exercised it.
> - **The real OpenAI embedder is not wired up.** `resolveEmbedder()` always returns the
>   deterministic embedder. Switching would require re-embedding the whole corpus, which needs a
>   migration strategy rather than a flag flip.
> - **Source ingestion is paste-only, by design.** An admin supplies text; there is no remote URL
>   fetching, HTML extraction, or scheduled re-ingestion. Fetching remote content raises SSRF and
>   content-trust questions that deserve their own design.
> - **The CI workflow has never run remotely.** It now declares PostgreSQL 17 with pgvector and
>   Redis service containers and runs migrations, seed, the integration suite, and all 53 e2e tests
>   — every step verified locally against the same images, including from a database built from
>   scratch. But no GitHub Actions run has executed it, so remote CI is **UNVERIFIED**. See
>   [`docs/CI.md`](docs/CI.md).
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

| Command                 | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `pnpm dev`              | Development server                                  |
| `pnpm build`            | Production build                                    |
| `pnpm start`            | Serve the production build                          |
| `pnpm format`           | Apply Prettier                                      |
| `pnpm format:check`     | Verify formatting (CI)                              |
| `pnpm lint`             | ESLint                                              |
| `pnpm typecheck`        | `tsc --noEmit`                                      |
| `pnpm test`             | Unit tests (Vitest) — no database required          |
| `pnpm test:integration` | Integration tests — **requires PostgreSQL + Redis** |
| `pnpm test:watch`       | Vitest in watch mode                                |
| `pnpm test:coverage`    | Vitest with a V8 coverage report                    |
| `pnpm test:e2e`         | Playwright end-to-end tests (starts its own server) |
| `pnpm test:e2e:install` | Install the Playwright browser (once, and in CI)    |
| `pnpm verify`           | format:check → lint → typecheck → test → build      |
| `pnpm db:up`            | Start PostgreSQL and Redis                          |
| `pnpm db:down`          | Stop them, keeping data                             |
| `pnpm db:reset`         | Stop them and **delete the volumes**                |
| `pnpm db:migrate`       | Create and apply a migration                        |
| `pnpm db:deploy`        | Apply existing migrations (deployment)              |
| `pnpm db:seed`          | Seed development data                               |
| `pnpm db:generate`      | Regenerate the Prisma client                        |
| `pnpm db:studio`        | Prisma Studio                                       |

Run `pnpm verify` before opening a pull request. CI runs the same checks.

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

- **Playwright** — `tests/e2e`. Starts its own server (`pnpm dev` locally, `pnpm start` in CI).
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
(printed by the seed command). **These are local development credentials only** — they exist
solely on a machine that has run the seed, and no credentials are committed to the repository.

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
served. Variables are graded rather than treated as one list:

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

Private and unlicensed. All rights reserved.
