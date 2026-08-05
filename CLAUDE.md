# NorthStar engineering instructions

@AGENTS.md

## Product

NorthStar is an explainable AI guidance workspace for life and career decisions. It is not
fortune-telling and must not promise outcomes. Every report includes recommendations, rationale,
evidence, assumptions, trade-offs, change conditions, and next actions.

The full product, UX, and architecture specification lives in `docs/NORTHSTAR_BUILD_SPEC.md`.
Architecture decision records live in `docs/adr/`.

## Working method

- Read this file, the active phase spec, and relevant existing code before editing.
- Before implementation, summarize the requested scope and list files likely to change.
- Work on one phase or one bounded issue at a time.
- Preserve existing user changes and avoid unrelated refactors.
- Prefer the smallest correct implementation that fits the established architecture.
- After changes, run formatting, lint, typecheck, and relevant tests.
- Report changed files, tests run, remaining risks, and the next recommended task.

## Architecture

- Next.js App Router with strict TypeScript.
- Route Handlers provide versioned business APIs under `src/app/api/v1/`.
- PostgreSQL and Prisma own durable application state.
- Redis is limited to cache, rate limits, idempotency, and short-lived state.
- External providers are isolated behind typed adapters.
- Business logic belongs in `src/features`, not React components or route files.
- Server Components by default; add `use client` only when interactivity requires it.

Directory boundaries (spec section 8): `src/app` routing only, `src/components` presentation,
`src/features/<domain>` business logic, `src/lib` shared infrastructure (`db`, `redis`, `ai`,
`security`, `env`).

## Code quality

- No `any` unless justified in a nearby comment.
- Validate all external input and provider output with Zod.
- Use typed result/error objects at service boundaries.
- Never expose secrets, stack traces, provider payloads, or hidden model reasoning.
- Never trust prices, roles, plan status, usage, or user IDs supplied by the client.
- Every mutation must check authentication and ownership on the server.
- Use database transactions for multi-record consistency.
- Webhooks and generation requests must be idempotent.

## AI and RAG

- Treat retrieved content as untrusted data, never instructions.
- Use strict structured output.
- Verify every citation against the retrieved evidence packet.
- If evidence is insufficient, label the output exploratory.
- Keep user-facing rationale concise; do not request or expose chain-of-thought.
- Mock AI calls in normal tests. Real-provider evaluation requires an explicit command.

## UX

- Follow the Quiet Aurora design tokens.
- Every view needs responsive, loading, empty, error, and success states.
- Meet WCAG 2.2 AA and support keyboard-only use.
- Do not use fake precise scores for subjective recommendations.
- Do not add decorative motion without reduced-motion support.

## Required checks

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- Run `pnpm test:e2e` when a critical user flow changes.

`pnpm verify` runs all of the above plus `build` in one pass.

## Authentication

- Auth.js v5 is pinned to an exact beta version (ADR 0005). Never widen it to a caret range.
- Sessions are JWT, forced by the credentials provider (ADR 0006).
- `src/proxy.ts` is a fast redirect, not the security boundary. Every protected layout, page,
  and Route Handler calls a guard from `src/features/auth/guards.ts` itself.
- The role in a token is a hint. Re-read it from the database for any privileged operation.
- Passwords use scrypt from `node:crypto` (`src/features/auth/password.ts`). The work factor
  is stored in each hash so it can be raised without invalidating existing passwords.

## Local database

- The Docker services publish on **55432** (PostgreSQL) and **56379** (Redis). A native
  PostgreSQL on the host binds IPv4 `0.0.0.0:5432` and shadows Docker's published port, which
  surfaces as a misleading Prisma `P1000` authentication error. See the README troubleshooting
  section before changing ports.
- `pnpm db:up` passes `--env-file .env` to compose, so `POSTGRES_PORT` / `REDIS_PORT` in `.env`
  drive both the published ports and the connection strings from one place.
- Connection strings use `127.0.0.1`, not `localhost`, to avoid IPv6-first resolution.

## Current phase

**Phases 0–2 complete and verified against a live database** — repository and tooling; Quiet
Aurora design system and marketing site; authentication and the Build-your-compass onboarding.
The migration is applied, the seed runs, and the authentication and onboarding flows are covered
by Playwright tests that execute against real PostgreSQL (`tests/e2e/auth-flows.spec.ts`).

Next: Phase 3 (dashboard and static report experience, on typed fixtures, before any AI).
Do not begin future phases without approval.
