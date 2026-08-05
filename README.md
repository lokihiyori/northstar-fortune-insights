# NorthStar Fortune Insights

**AI guidance for clearer life and career decisions.**

NorthStar turns an uncertain question into a structured decision. Every generated insight answers
five things: what the recommendation is, why it fits this person, what evidence supports it, what
assumptions and trade-offs it carries, and what to do next.

It is decision support, not fortune-telling. It does not predict outcomes and does not replace
licensed professional advice.

> **Status: Phases 0–4 complete and verified against a live database.** Repository and tooling;
> the Quiet Aurora design system and full marketing site; authentication and the
> Build-your-compass onboarding; the app workspace (guided composer, insight report, scenario
> comparison, action plans, history); and the guidance engine — deterministic rules, pgvector
> retrieval over a reviewed corpus, structured generation behind a provider interface, and
> citation validation. Every flow is covered by Playwright tests that run against real
> PostgreSQL with no mocks. See
> [`docs/NORTHSTAR_BUILD_SPEC.md`](docs/NORTHSTAR_BUILD_SPEC.md) section 18 for the phase plan.
>
> **No AI provider is required to run it.** Without `OPENAI_API_KEY` a deterministic provider is
> used, so the full pipeline works offline at zero cost. See [The guidance engine](#the-guidance-engine).
>
> **Stripe is implemented but unverified.** Checkout, Customer Portal, and webhook handling have
> never run against Stripe, because no test-mode credentials are configured. Billing degrades
> cleanly without keys — the upgrade path is disabled and explained rather than failing. Do not
> treat it as working until `stripe listen` has exercised it.

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
| `pnpm test`             | Unit and integration tests (Vitest)                 |
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
