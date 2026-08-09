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
- `pnpm test` — unit only, no services needed, so `verify` runs on a bare checkout.
- `pnpm test:integration` — needs PostgreSQL **and Redis**. Run it when retrieval, caching, or the
  source lifecycle changes.
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

## Guidance engine (Phase 4)

- The pipeline lives in `src/features/guidance/orchestrator.ts` and follows spec section 9.
  Deterministic code owns rules, retrieval, validation, and persistence; the model is one step
  in the middle and its output is untrusted until it passes both gates.
- **Two validation gates, in order:** the strict Zod schema, then the citation allow-list. An
  unknown `sourceId` fails the whole report. Never repair malformed output — reject it.
- Providers sit behind `GuidanceProvider`. `src/features/guidance/ai/openai-provider.ts` is the
  only file that knows OpenAI exists. Without `OPENAI_API_KEY` the deterministic provider is
  selected, so everything runs offline at no cost — that is the default for tests and CI.
- Confidence is derived from rules and evidence count, never asserted by the model, and never
  rendered without its reasons.
- Retrieval is restricted to `PUBLISHED`, non-deleted sources filtered by topic and region
  before ranking. Exact cosine scan, no ANN index — see ADR 0003.
- Usage is charged only on success, and the ledger's unique constraint makes it idempotent.

## Admin and source ingestion (Phase 7)

- **Authorization is server-side and layered.** `src/app/admin/layout.tsx` calls `requireAdmin`,
  and every admin page, server action, and Route Handler calls a guard itself. Hidden navigation
  is never the control. `src/proxy.ts` matches `/admin` too, but only redirects unauthenticated
  requests — the edge config cannot read roles.
- Non-admin users get a redirect on pages and the **403 `FORBIDDEN` envelope** on APIs.
- **Admins are only created out-of-band.** There is no self-elevation path. Use `SEED_ADMIN=true`
  with `pnpm db:seed`, or promote a row directly. Never commit admin credentials.
- **All chunk writes go through `src/features/sources/ingest.ts`.** Nothing else writes
  `source_chunks`, so chunking and embedding rules cannot drift between the admin UI and the seed.
- Source content is untrusted evidence: chunked, hashed, and embedded, never parsed for directives.
- **Lifecycle is Draft → Reviewed → Published → Retired** (`sources/lifecycle.ts`, pure functions).
  Publishing additionally requires complete metadata _and_ fully embedded chunks — a published
  source with no embeddings would look live while being invisible to retrieval.
- **Publishing and retiring invalidate the retrieval cache** by bumping a generation counter
  (`features/retrieval/cache.ts`). Redis is fail-open: an outage degrades to uncached correct
  results, never an error (ADR 0004).
- Retiring excludes a source from new retrieval but never rewrites historical report snapshots.
  The `Citation → Source` FK is `onDelete: Restrict` for exactly that reason.
- `AuditLog` is append-only. There is no update or delete helper, and secrets, prompts, and
  personal fields are stripped from metadata before writing.

## Security posture (Phase 8A)

- **Environment validation runs at startup** in `src/instrumentation.ts` — the only boundary Next
  guarantees completes before requests are served. Never move it into a layout or the proxy.
- Variables are tiered: always-required, production-runtime-only, all-or-nothing provider groups,
  and optional. Production checks are skipped during `next build` (`NEXT_PHASE`), so CI never needs
  runtime secrets.
- **Validation errors name the variable and the rule, never the value.** Keep it that way.
- Security headers come from `next.config.ts` `headers()`, not the proxy — it covers static routes
  and would otherwise force dynamic rendering. HSTS is production-only.
- **CSP is `Content-Security-Policy-Report-Only` and enforces nothing.** Do not describe it as
  enforced. Blockers are listed in `CSP_ENFORCEMENT_BLOCKERS` (`src/lib/security/headers.ts`).
- Cookie posture is stated in `features/auth/cookies.ts` and unit-tested for both modes.
  `SameSite=Lax` is deliberate: Strict breaks the OAuth callback.

## Rate limiting (Phase 8B)

- **Every limit is declared in `src/lib/rate-limit/policies.ts`.** Callers select an _operation_,
  never a number, so a path reachable as both a Route Handler and a Server Action cannot diverge.
  Adding a number anywhere else is the mistake this structure exists to prevent.
- Enforcement always sits **after** the auth guard and **before** any expensive work, so a rejected
  request never spends a legitimate user's budget.
- **The limit comparison, the increment, and the expiry are one Lua script** (ADR 0008). Never split
  them: comparing in application code is not atomic, and a crash between `INCR` and `EXPIRE` leaves a
  key with no TTL — a permanent lockout. The TTL is set only when the first reservation creates the
  key, never refreshed, so a subject cannot extend their own window.
- **The counter is held capacity, not attempt volume.** It saturates at the limit: a refused attempt
  changes neither the count nor the TTL. Incrementing past the limit would make the number
  meaningless once a refund is possible — a success returning its own unit could leave the count
  above the limit with nothing actually held, and freed slots would stay burned.
- **Failure mode is per policy.** Credential, generation, and admin policies fail **closed**; a
  Redis outage there returns **503 `SERVICE_UNAVAILABLE`**, never 429 — a 429 blames the caller for
  our outage. Ordinary reads fail **open** (ADR 0004).
- **Credential policies reserve capacity, then refund it** (`counting: "reserved"`). Reserve
  atomically _before_ password verification, then settle: `invalid-credentials` commits by doing
  nothing, `authenticated` and `indeterminate` release. Never gate on a read-then-decide — that is
  not atomic, and a concurrent burst all passes the same stale count. Multi-policy acquisition is
  all-or-nothing; a later denial rolls back the earlier reservation.
- **A release returns exactly one unit**, never clears the bucket, so a success cannot erase another
  request's recorded failure. The release script refuses to resurrect an expired key, never stores a
  zero or negative count, and never leaves a key without a TTL.
- If a release cannot be delivered, the reservation stays counted and the TTL bounds it. That
  direction is deliberate: the alternative lets attempts escape counting during a Redis blip.
- Refusal messages are identical everywhere and name no account, limit, window, policy, or bucket.
  On the sign-in form that is the entire enumeration defence.
- **Nothing readable reaches Redis.** Identifiers and IPs are HMAC-hashed with `AUTH_SECRET`; keys
  are `northstar:rl:v1:<policy>:<digest>` and values are counters.
- **`X-Forwarded-For` is ignored unless `RATE_LIMIT_TRUSTED_PROXY_HOPS` is set**, so per-IP policies
  are currently inert. Never make the header trusted by default, and never fall back to a shared
  "unknown" bucket — one attacker would exhaust everyone's allowance.
- Tests run the real policies. Do not add a switch that disables limiting; isolate by subject.

## Observability (Phase 8C)

- **`console` is not the logging interface.** Server code calls
  `src/lib/observability/logger`; `no-console` is an ESLint **error** outside the logger itself,
  `instrumentation.ts`, the client error boundary, and test/seed tooling.
- **Fields are allow-listed, never denied** (`observability/redact.ts`). Credential-shaped names are
  refused unconditionally, content-shaped names only survive with a measurement suffix (`reportId`,
  `chunkCount`), values must be primitives, and **objects are never walked**. Exceptions contribute
  their name, never their message.
- **One request context**, carried by `AsyncLocalStorage` in `observability/context.ts`. Never use a
  module-level variable — it is shared across concurrent requests and would stamp one request's id
  onto another's log line. Route Handlers get it from `withApiLogging`; Server Actions must open
  their own with `runWithActionContext`.
- `apiError()` reads `currentRequestId()`, so the envelope, the `X-Request-ID` header, and the log
  line always agree. Do not generate an id anywhere else.
- **An incoming `X-Request-ID` is validated, not sanitized** — strict pattern or replaced. It lands
  in a header, a body, and a log line, so a newline in it would forge a log entry.
- **Liveness never touches a dependency.** `/api/v1/health` stays 200 during any outage;
  `/api/v1/ready` is the endpoint that probes PostgreSQL and Redis, with bounded timeouts, and
  returns 503. Redis counts because sign-in is fail-closed on it (ADR 0008).
- Readiness responses name dependencies abstractly and never expose a host, port, credential, or
  driver message. It is unauthenticated and must not be rate limited.
- **Monitoring is vendor-neutral and no vendor is configured.** Call `captureException` /
  `captureMessage`; never import an SDK into business code. A capture failure is swallowed — it must
  never fail a request.
- Success logging is off for `/api/v1/health`, `/api/v1/ready`, and the polled generation status
  route. Failures still log everywhere.

## Continuous integration (Phase 8D)

- Two jobs in `.github/workflows/ci.yml`: `quality` (no services) gates `database-e2e` (PostgreSQL 17
  - pgvector, Redis 7). Full detail in `docs/CI.md`.
- **CI uses `migrate deploy`, never `migrate dev` or `db push`.** `migrate dev` is interactive and
  rewrites history; `db push` skips migrations, so CI would stop testing what a deployment runs.
- `pnpm db:verify` runs after every deploy. `migrate deploy` exiting zero does not prove the
  `vector` extension exists — and a missing one surfaces later as a confusing retrieval failure.
- **e2e runs `next dev` in CI too.** `next start` cannot serve it: production validation rejects an
  http localhost URL, and production `Secure` cookies are not stored over http, so authentication
  dies. Do not "fix" this by loosening the cookie posture or the env rules.
- `AUTH_SECRET` is generated per run and `::add-mask::`ed. No repository secret is used anywhere.
- Stripe, OpenAI, Google, and PostHog stay **unset** so CI exercises the deterministic providers and
  the degraded billing path. `RATE_LIMIT_TRUSTED_PROXY_HOPS=0`, so CI never demonstrates per-IP
  limiting — do not claim it does.
- **Artifacts upload only on failure**: the Playwright HTML report and migration status. Traces are
  `off` in CI because they capture `Set-Cookie` and storage state. Never add `test-results/`, raw
  server logs, `.env`, or dumps.
- `pnpm audit --audit-level high` gates the build. Never lower the level to go green; never auto-fix
  in CI. Exceptions need a CVE, path, exploitability note, owner, and review date.

## Current phase

**Phases 0–7 complete and verified against a live database**, with one explicit exception below.
Repository and tooling; design system and marketing site; authentication and onboarding; the app
workspace; the guidance engine; action plans, feedback and report versioning; local billing,
entitlements and analytics; and admin source ingestion with audit history.

`tests/e2e/guidance.spec.ts` and `tests/e2e/admin.spec.ts` drive the real pipelines against real
PostgreSQL — no mocks.

**Still unverified: Stripe.** Checkout, Customer Portal, and webhook execution have never run
against Stripe because no test-mode credentials are configured. The code exists and degrades
cleanly without keys; do not describe it as verified until `stripe listen` has exercised it.

Next: Phase 8 (hardening and deployment). Do not begin it without approval.
