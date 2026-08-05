# NorthStar Fortune Insights

**AI guidance for clearer life and career decisions.**

NorthStar turns an uncertain question into a structured decision. Every generated insight answers
five things: what the recommendation is, why it fits this person, what evidence supports it, what
assumptions and trade-offs it carries, and what to do next.

It is decision support, not fortune-telling. It does not predict outcomes and does not replace
licensed professional advice.

> **Status: Phases 0–2 complete.** Repository and tooling; the Quiet Aurora design system and
> full marketing site; authentication and the Build-your-compass onboarding. The guidance
> workspace and engine arrive in Phases 3–4. See
> [`docs/NORTHSTAR_BUILD_SPEC.md`](docs/NORTHSTAR_BUILD_SPEC.md) section 18 for the phase plan.
>
> **Not yet verified against a live database.** Docker was unavailable on the machine this was
> built on, so no migration has been applied and the seed has never run. See
> [Known gaps](#known-gaps).

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
4. [Redis is cache and coordination only](docs/adr/0004-redis-scope.md)

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

The AI layer is mocked in ordinary tests. Real-provider evaluation is a separate, explicit command
with a cost limit (spec section 16) and arrives with Phase 4.

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

## Known gaps

Honest status of what has and has not been exercised:

- **No migration has ever been applied.** `prisma/migrations/20260804000000_init_auth_and_profile`
  was generated offline with `prisma migrate diff` because Docker was not available. The schema
  validates and the client generates, but the SQL is unverified against a running PostgreSQL.
- **The seed has never run**, so no sign-in, sign-up, or onboarding flow has been executed
  end to end against real data.
- Tests that need a database are therefore absent. The e2e suite covers what can be checked
  without one: unauthenticated redirects, the API error envelope, callback-URL handling, and
  marketing navigation.

Closing these is the first task before Phase 3:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
```

## License

Private and unlicensed. All rights reserved.
