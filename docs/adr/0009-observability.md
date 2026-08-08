# ADR 0009 — Structured logging, request correlation, and a vendor-neutral monitoring boundary

Status: Accepted (Phase 8C)

## Context

Through Phase 8B the application diagnosed itself with eighteen scattered `console.*` calls. Three
problems followed from that:

- **Nothing correlated.** `apiError()` generated a fresh UUID per error. It was never returned to
  the caller, never logged, and two errors inside one request produced two different ids — so a user
  quoting "reference abc123" gave an operator nothing to search.
- **Nothing was redacted.** `console.error("Guidance validation failed", details)` printed fragments
  of model output, which can echo the user's own question. `console.error("Stripe webhook failed:",
error)` printed an exception whose message can carry request payloads.
- **Health was one endpoint answering two questions.** `/api/v1/health` reported the process was
  alive, which is the right answer for liveness and useless for deciding whether an instance can
  serve traffic — especially after Phase 8B made Redis a hard dependency for signing in.

## Decision

### One request context, carried by `AsyncLocalStorage`

`src/lib/observability/context.ts` holds a `RequestContext` per async call tree. A module-level
variable would be shared by every in-flight request in the same process, so under any concurrency at
all one request would stamp its id onto another's log line — which is worse than no correlation,
because it is confidently wrong.

`withApiLogging(route, handler)` opens the context for Route Handlers. Server Actions do not pass
through it and are given their own with `runWithActionContext(name, fn)`; their records carry
`method: "ACTION"` so a consumer can tell the two apart.

`apiError()` reads `currentRequestId()`. That single change is what makes the envelope, the
`X-Request-ID` header, and the log line agree.

### Request ids are validated, not sanitized

An incoming `X-Request-ID` is echoed into a header, an error body, and a log line — three places
where injection matters. It is accepted only against `^[A-Za-z0-9_-]{8,64}$`, and replaced outright
otherwise. Excluding whitespace and control characters is what stops a crafted header from injecting
a newline and forging a second log entry.

A malformed id is replaced rather than rejected: the caller gets correlation either way, and
refusing a request over a bad diagnostic header would be a poor trade.

### Logging is an allow-list

`redact.ts` decides what may be emitted, and the rule is **allow-list, not deny-list**. A deny-list
is a list of the leaks someone already thought of.

- A field name matching a **credential** pattern is refused unconditionally — including derived
  forms like `tokenCount`, because there is no safe projection of a secret.
- A field name matching a **content** pattern is refused unless it ends in a measurement suffix.
  `reportId` is an opaque cuid and `chunkCount` an integer; refusing them would cost real diagnostic
  signal for no privacy gain.
- Values must be primitives. **Objects are never walked** — `logger.info(event, { user })` is the
  classic accident, and here it emits nothing rather than a whole record.
- Strings are control-stripped and truncated.
- Exceptions contribute their **name**, never their message. A message routinely carries a
  connection string, a SQL fragment, or the user's own input.

There is deliberately no `logger.log(anything)`. `no-console` is now an ESLint **error** outside four
named files, so the boundary is enforced rather than remembered.

### Liveness and readiness are separate endpoints

- `/api/v1/health` — liveness. 200 while the process can serve HTTP, **no dependency calls**. A
  liveness check that touches a database restarts every instance when that database blips, turning a
  dependency incident into a total outage.
- `/api/v1/ready` — readiness. Bounded `SELECT 1` (1.5 s) and Redis `PING` (1.0 s), raced against
  timeouts so the endpoint cannot hang. 200 only when both answer; 503 otherwise.

**Redis is required for readiness.** It was optional through Phase 8A when it held only cache.
Phase 8B made rate limiting fail-closed for credential authentication, so an instance without Redis
cannot sign anybody in, and reporting it ready would be false.

Readiness is unauthenticated and deliberately **not** rate limited: a platform probe has no session,
and gating it behind the limiter would make it depend on the dependency it exists to report on. Its
body names dependencies abstractly (`database`, `cache`) with states limited to `ok` / `unavailable`
— no host, port, username, database name, driver message, or stack trace, because anyone can reach
it.

### Monitoring is an interface, not a vendor

`captureException` / `captureMessage` with a swappable adapter. A monitoring SDK is the kind of
dependency that ends up imported in forty files and then cannot be replaced, and it runs third-party
code on the request path.

**No vendor is configured.** The default adapter writes a structured log line rather than being a
silent no-op — a capture that vanishes is indistinguishable from one that was never wired up.

Capture failures are swallowed and logged once: a vendor SDK throwing on a bad payload is not a
reason to turn a working response into a 500.

## Attaching a vendor later

1. Add the SDK and write an adapter satisfying `MonitoringAdapter` (three members).
2. Call `setMonitoringAdapter(adapter)` **once**, from `instrumentation.ts`, so exactly one file in
   the codebase knows which vendor is in use.
3. Nothing else changes. Business code already calls the boundary and cannot tell the difference.

The adapter receives only `requestId`, `route`, `method`, `actorId`, `errorCategory`, and
already-sanitized extras. It cannot receive a header, a cookie, a body, or a question — not because
the vendor promises not to look, but because they are not passed.

## Consequences

**Accepted cost.** Logs stay inside the process. There is no external backend, no alerting, no
retention, and no dashboard. Everything is visible to whatever captures stdout and nothing more.
This is the largest remaining observability gap and belongs to Phase 8D deployment.

**Accepted cost.** `AsyncLocalStorage` is Node-only. Every module that touches it carries
`server-only`, and `src/proxy.ts` — the one Edge entry point — imports none of them. `request-id.ts`
uses the Web Crypto global rather than `node:crypto` for the same reason: it is reachable from the
Edge instrumentation bundle.

**Accepted cost.** Success logging is off for `/api/v1/health`, `/api/v1/ready`, and the generation
status endpoint. Probe and poll traffic would otherwise bury real signal — the status endpoint alone
is polled every 1.2 seconds. Failures on those routes are still logged.

**Rejected: logging request bodies or query strings.** They are the single richest source of private
content in the application, and no operational question needs them.

**Rejected: a `requestId` derived from the user.** Correlation is per request. A stable per-user
identifier in logs is a tracking record; `actorId` is an opaque cuid attached only where an
operational question genuinely needs to distinguish accounts.
