# NorthStar Fortune Insights

**AI guidance for clearer life and career decisions.**

NorthStar turns an uncertain question into a structured decision. Every generated insight answers
five things: what the recommendation is, why it fits this person, what evidence supports it, what
assumptions and trade-offs it carries, and what to do next.

It is decision support, not fortune-telling. It does not predict outcomes and does not replace
licensed professional advice.

> **Status: Phase 0 — foundation.** The repository, tooling, local infrastructure, and CI are in
> place. The marketing site, product workspace, and guidance engine arrive in Phases 1–8. See
> [`docs/NORTHSTAR_BUILD_SPEC.md`](docs/NORTHSTAR_BUILD_SPEC.md) section 18 for the phase plan.

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

## License

Private and unlicensed. All rights reserved.
