# Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, on every pull request, and on manual
dispatch. Two jobs, one gate.

> **Proven remotely.** Real GitHub Actions runs have executed this workflow with both jobs green and
> neither skipped, on a pull request and again on the resulting `main` merge commit. The same
> commands were also verified locally against the same service images, including a database built
> from scratch.

## Jobs

| Job            | Needs     | Services                          | Steps                                                                      |
| -------------- | --------- | --------------------------------- | -------------------------------------------------------------------------- |
| `quality`      | —         | none                              | format:check · lint · typecheck · unit tests · build · dependency audit    |
| `database-e2e` | `quality` | PostgreSQL 17 + pgvector, Redis 7 | migrate deploy → migrate status → verify schema → seed → integration → e2e |

`database-e2e` is gated on `quality` so a formatting slip does not spend the expensive job. The
cost is serialized wall-clock time; the benefit is a clear signal and fewer wasted minutes on a
commit that was never going to pass. It is a judgement call — running them in parallel would give
faster feedback on a genuine database regression.

The build is **not** repeated in `database-e2e`. Playwright starts `next dev` there (see below), so
`pnpm build` runs exactly once, in `quality`.

## Toolchain setup

Both jobs set the toolchain up the same way, in this order:

```yaml
- uses: actions/checkout@v5
- uses: pnpm/setup@v2
  with:
    install: false
- uses: actions/setup-node@v5
  with:
    node-version-file: .nvmrc
    cache: pnpm
- name: Install dependencies
  run: pnpm install --frozen-lockfile
```

- **`pnpm/setup@v2`** is the official successor to `pnpm/action-setup` for pnpm 11+. With no
  `version` input it reads `packageManager` from `package.json` — `pnpm@11.20.0` — so the pnpm
  version is declared once, in the repository, and never duplicated in the workflow. It fetches a
  self-contained pnpm binary, so it does not need Node to run.
- **`install: false` is deliberate.** The action installs dependencies by default. Letting it do so
  would hide the install inside a setup step; the named `pnpm install --frozen-lockfile` below stays
  the authoritative one, visible in the log and able to fail on its own when the lockfile is stale.
  That failure is the point — it is what stops a lockfile that no longer matches `package.json`.
- **`actions/setup-node@v5` is kept**, and `.nvmrc` remains the single Node-version source (Node
  22). `pnpm/setup` can install a runtime itself, but no `runtime` input and no `devEngines.runtime`
  are declared here; setup-node runs last, so the Node on `PATH` is the one `.nvmrc` asks for.
- **Order matters.** `cache: pnpm` needs the pnpm binary to resolve the store path, so the pnpm
  setup step must come before setup-node.

## Service containers

```yaml
postgres:
  image: pgvector/pgvector:pg17          # same image and major as docker/docker-compose.yml
  env:  POSTGRES_USER: northstar_ci
        POSTGRES_PASSWORD: northstar_ci_ephemeral
        POSTGRES_DB: northstar_ci
  ports: ["5432:5432"]
  options: --health-cmd "pg_isready -U northstar_ci -d northstar_ci" ...
redis:
  image: redis:7-alpine
  ports: ["6379:6379"]
  options: --health-cmd "redis-cli ping" ...
```

GitHub holds the first step until both containers report healthy, so no step polls for readiness.

**Credentials are CI-only and ephemeral.** They are deliberately different from the local
development credentials so the two can never be confused in a log, and they are destroyed with the
runner. Nothing in this workflow can reach a database outside its own job.

**Ports.** CI publishes on the standard 5432 and 6379. The local stack uses 55432 and 56379 to dodge
a native Windows PostgreSQL — a Windows-only problem that a Linux runner does not have.

**`127.0.0.1` vs `localhost`.** `DATABASE_URL` and `REDIS_URL` use `127.0.0.1`, because the runner
reaches a published port and `localhost` can resolve to `::1` first, where nothing listens.
`NEXT_PUBLIC_APP_URL` uses `localhost`, because Next's dev server treats the two as different
origins and blocks its own dev resources across the mismatch. Both are deliberate.

## Migration and seed order

Exactly this sequence, and nothing may be reordered:

1. services healthy (GitHub waits)
2. `pnpm install --frozen-lockfile` — `postinstall` runs `prisma generate`
3. **`pnpm db:deploy`** (`prisma migrate deploy`)
4. `pnpm exec prisma migrate status` → written to `ci-artifacts/migration-status.txt`
5. **`pnpm db:verify`** — asserts extensions, tables, and the vector column
6. `pnpm db:seed`
7. `pnpm test:integration`
8. `pnpm exec playwright install --with-deps chromium`
9. `pnpm test:e2e`

`migrate deploy` is the production-safe command. **Never `migrate dev`** — it is interactive and
rewrites migration history — and **never `db push`**, which skips migrations entirely, so CI would
stop testing what a deployment actually runs.

`pnpm db:verify` exists because `migrate deploy` exiting zero is weaker evidence than it looks: it
reports that migration _files_ applied, not that the database has the `vector` extension retrieval
needs. A missing extension otherwise surfaces much later as a confusing retrieval error that reads
like a flaky test. The script checks the two extensions, all 25 tables, and that
`source_chunks.embedding` really is `vector(1536)`.

`SEED_ADMIN` is **not** set. `admin.spec.ts` creates an account and promotes it through the database
helper, exactly as a real operator would, so CI never needs a pre-seeded elevated account.

## Local equivalents

Every CI step has a local equivalent. With `pnpm db:up` running:

| CI step                          | Local command                     |
| -------------------------------- | --------------------------------- |
| quality job, in full             | `pnpm verify && pnpm audit:ci`    |
| format, lint, types, unit, build | `pnpm verify`                     |
| Dependency audit                 | `pnpm audit:ci`                   |
| Apply migrations                 | `pnpm db:deploy`                  |
| Verify migration status          | `pnpm exec prisma migrate status` |
| Verify schema and extensions     | `pnpm db:verify`                  |
| Seed                             | `pnpm db:seed`                    |
| Integration tests                | `pnpm test:integration`           |
| End-to-end tests                 | `pnpm test:e2e`                   |

To reproduce CI's _starting_ state rather than your working database, point `DATABASE_URL` at a
throwaway database and run steps 3–9 against it.

## Why e2e runs `next dev`, in CI as well as locally

This is the one place CI deliberately does not serve the production build, and the reason is the
security posture rather than convenience. Two things were proven before the configuration changed:

- `next start` sets `NODE_ENV=production`, so Phase 8A startup validation demands an https,
  non-localhost `NEXT_PUBLIC_APP_URL`. Given the real CI URL the process **exits before serving a
  request**.
- Given a fake https URL to satisfy that check, the server boots but authentication is dead over
  http: production forces `Secure` and the `__Secure-` cookie prefix (ADR 0007), which a browser
  refuses to store on a plain-http origin, and Auth.js rejects the mismatched host. Sign-in yields
  no cookie and `/api/v1/me` answers 401.

Serving the production build under test therefore needs real https — a certificate and a
terminating proxy, which is deployment work. Until then `pnpm build` in `quality` proves the
production build compiles; the e2e suite exercises behaviour, not the bundle. **This is a real gap:
the production server configuration is not exercised end to end.**

## Deterministic providers

`STRIPE_*`, `OPENAI_API_KEY`, `AUTH_GOOGLE_*` and `NEXT_PUBLIC_POSTHOG_*` are all left unset. That is
not an omission — it is what makes CI exercise:

- the **deterministic guidance provider** and **deterministic embedder**, so the full retrieval →
  generation → validation pipeline runs offline at zero cost;
- the **degraded billing path**, where the upgrade route is disabled and explained rather than
  failing;
- the **structured-log monitoring adapter**, since no vendor is configured (ADR 0009).

`RATE_LIMIT_TRUSTED_PROXY_HOPS=0`, so per-IP rate-limit policies stay inert exactly as they are in
production today. CI does not demonstrate per-IP limiting and must not be described as doing so.

`AUTH_SECRET` is generated per run with `openssl rand -hex 24`, masked with `::add-mask::` before it
can reach a log, and destroyed with the runner. It is never a repository secret.

## Failure artifacts

Uploaded **only when the job fails**, retained for 7 days:

- `playwright-report/` — the HTML report, including failure screenshots
- `ci-artifacts/migration-status.txt`

Deliberately **not** uploaded:

| Excluded                              | Why                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright traces                     | A trace records every request and response, including `Set-Cookie` and the resulting storage state. `trace` is set to `off` in CI for this reason; a developer reproducing locally still gets full traces. |
| `test-results/`                       | Where traces and storage-state files land.                                                                                                                                                                 |
| Raw server logs                       | Our own log lines are allow-listed, but Prisma and Auth.js write unstructured diagnostics containing hosts and ports.                                                                                      |
| `.env` files, database or Redis dumps | Never useful for debugging a test failure, and the worst thing to leak.                                                                                                                                    |

Failure screenshots are kept: the e2e suite drives synthetic fixtures, so a screenshot shows invented
questions and `@northstar.test` addresses, never anyone's real data. The report produced by a local
CI-mode run was scanned and contains no secret value, no `Set-Cookie`, no session cookie name, no
connection URL, and zero email-shaped strings.

### Inspecting a failed run safely

1. Download `ci-failure-report` from the run's Summary page.
2. Open `playwright-report/index.html` — it is self-contained and offline.
3. For deeper detail, reproduce locally: `pnpm db:up && pnpm test:e2e`. Local runs collect traces on
   first retry, which CI intentionally does not.

## Dependency audit policy

`pnpm audit --audit-level high` fails the build on **high and critical** advisories.

**Current state: 0 advisories at every severity**, so no exception exists. An empty ignore list is
just pre-authorised permission to skip a future finding, so none is committed.

Rules, in order of preference:

1. **Fix it.** Upgrade the package, or the direct dependency that pulls it in.
2. **Never lower `--audit-level` to go green.** That silences every future advisory at that level,
   not just the inconvenient one.
3. **Never auto-fix inside CI.** A workflow that rewrites the lockfile makes the build
   non-reproducible and can land an untested upgrade.
4. If an advisory genuinely cannot be fixed now, add a narrow entry to `pnpm.auditConfig.ignoreCves`
   in `package.json` recording, in a comment beside it:
   - the CVE and the package
   - whether it is a **direct** or **transitive** dependency, and the path
   - why it is not exploitable in this application, if that is true — and if it is not true, say so
   - an owner and a **review date**, after which the entry is removed rather than renewed

ADR 0005 pins Auth.js to an exact beta version. That pin currently produces no advisory. If it ever
does, it is reported honestly under the rules above; the pin is not a reason to suppress it.

## Workflow security

- `permissions: contents: read` — nothing writes to the repository, publishes, comments, or deploys.
- `pull_request`, never `pull_request_target`. A fork's code must not run with access to this
  repository's secrets, which is exactly what `pull_request_target` grants.
- **No repository secrets are used at all.** Every credential is generated inside the job.
- No untrusted input is interpolated into a shell command — no `${{ github.event.* }}` reaches a
  `run:` block.
- Actions are pinned to a **major** version. Full SHA pinning is stricter, but without Dependabot
  configured to bump those SHAs it degrades into permanently stale actions, which is its own risk.
  All four actions are first-party (`actions/*`, `pnpm/*`). A third-party action would warrant full
  SHA pinning.
- Superseded runs on a branch are cancelled; a run on `main` is allowed to finish, because main's
  history is what a later bisect reads.
- Nothing here deploys.

## Known limitations

- **The production server configuration is not exercised end to end** — see the `next dev` section.
- **Per-IP rate limiting is not demonstrated.** `RATE_LIMIT_TRUSTED_PROXY_HOPS=0` in CI, matching
  production, so those four policies are inert. The production hop count remains undecided because
  no deployment proxy has been chosen (ADR 0008).
- **CI never exercises Stripe.** It holds no Stripe credentials by design, so it runs the degraded
  billing path only. Stripe itself has been verified once, manually, in test mode — a separate step
  that is deliberately not part of CI and is not repeated by it.
- e2e runs with `workers: 1`. That value was chosen from local evidence: two workers contending for
  one on-demand-compiling dev server starved whichever journey was unlucky. A GitHub runner has
  different CPU characteristics, so the value may be revisited once real CI timings exist — with
  evidence, not by guessing.

## Billing tests: faked boundary versus real Stripe

CI never holds Stripe credentials, and the billing suites do not need them.

- **Unit** (`tests/unit/billing-*.test.ts`) — pure: the status table, the canonical rule and its
  permutation invariance, and mode derivation from a key prefix. No I/O.
- **Integration** (`tests/integration/billing-*.test.ts`) — **real PostgreSQL and real Redis**,
  because the correctness mechanisms _are_ a PostgreSQL unique index, a PostgreSQL advisory lock,
  and a Redis counter. Stripe is injected at the external API boundary by
  `tests/integration/helpers/fake-stripe.ts`, which counts calls and implements idempotency-key
  replay and Session expiry.
- **E2E** (`tests/e2e/billing.spec.ts`) — the seven billing states and the continue route's
  redirect safety, driven through the browser.

**What the faked boundary proves and does not prove.** It proves how many times the application
calls Stripe, which object it reuses, and what it writes — the D1/D2/D3 properties. It proves
nothing about Stripe's own behaviour. Statements about Stripe require a real test-mode run, which is
a manual step and is never part of CI.

Local commands:

```
pnpm db:up
pnpm test:integration
pnpm exec playwright test tests/e2e/billing.spec.ts
```
