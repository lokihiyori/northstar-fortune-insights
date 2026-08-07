# ADR 0008 — Redis fixed-window rate limiting, fail-closed on cost

Status: Accepted (Phase 8B)

## Context

Phases 0–8A left every mutation open to unlimited repetition. Three of them are genuinely
expensive or dangerous when repeated:

- **Credential sign-in.** Nothing stopped an automated password spray. The scrypt work factor makes
  each attempt costly for us as well as for the attacker.
- **Guidance generation.** Each request runs retrieval and a model call. The monthly entitlement
  looks like it bounds this, but it cannot: usage is recorded only on success and only in an
  `after()` callback, so several rapid submissions all read a ledger that has not caught up and all
  pass the quota check.
- **Admin mutations.** Ingestion chunks and embeds; publishing invalidates the retrieval cache for
  the entire corpus.

The application already runs Redis for the retrieval cache, and ADR 0004 restricts Redis to data
that may be lost without correctness consequences.

## Decision

### A single policy table

Every limit is declared in `src/lib/rate-limit/policies.ts` with its subject, window, failure mode,
counting mode, and a written rationale. Route Handlers and Server Actions select an _operation_,
never a number. An operation reachable through both an API route and a server action therefore
cannot end up limited on one path and open on the other.

### Fixed window, enforced by one Lua script

```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { current, redis.call('PTTL', KEYS[1]) }
```

`INCR` followed by a separate `EXPIRE` has a real failure mode: if the process dies between the two
commands, the key survives with no TTL and that subject is locked out permanently. Redis runs a
script to completion without interleaving another client, so the pair is atomic.

The TTL is set **only on the first increment**. Refreshing it every call would let a subject under
sustained load extend their own window indefinitely, so it would never reset while they kept
knocking.

Fixed window is chosen knowingly. Up to `2 × limit` requests can land across a window boundary. For
an abuse ceiling that is acceptable, and it costs one integer per subject; a sliding window needs a
sorted set per subject for a bound that is no more meaningful here.

### Fail-closed on cost, fail-open on reads

ADR 0004 says a Redis outage must never become a correctness or availability problem. That holds
for reads. It cannot hold for credential attempts, generation, or admin mutations: "we cannot count,
so help yourself" is precisely the state an attacker wants, and it is reachable by attacking Redis.

So the failure mode is per policy, and an outage on a fail-closed operation returns **503
`SERVICE_UNAVAILABLE`**, never 429. A 429 would blame the user for our outage and send them away to
wait out a window that does not exist.

### Credential limits count failures, not attempts

Successful sign-ins never consume budget. Counting them would let a person lock themselves out by
signing in legitimately several times in an afternoon, and credential stuffing produces failures by
definition. This requires a non-consuming `peek` before the attempt and a `consume` after a failure.

The consequence is a deliberate off-by-one difference between the two: `consume` has already
incremented, so it refuses at `count > limit`; `peek` reads the count _before_ the attempt, so it
refuses at `count >= limit`.

### Nothing readable reaches the keyspace

Login identifiers are normalized and then **HMAC**-hashed with `AUTH_SECRET`. An unkeyed digest of
an email address is reversible with a wordlist, which would turn a keyspace dump back into a list of
who tried to sign in. Client addresses are hashed for the same reason. User ids are opaque cuids and
are used directly.

Keys are `northstar:rl:v1:<policy>:<digest>`; values are counters.

### `X-Forwarded-For` is not believed by default

`RATE_LIMIT_TRUSTED_PROXY_HOPS` defaults to `0`, meaning the header is ignored entirely and no
client address is derived. Per-IP policies are then **skipped**, not applied to a shared "unknown"
bucket — a shared bucket would let one attacker exhaust every user's allowance at once.

## Consequences

**Accepted cost.** Until a deployment proxy is chosen and the hop count is set, the four per-IP
policies do nothing. Per-user and per-identifier policies carry the protection. This is the largest
remaining gap in 8B and belongs to the 8D deployment work; `SIGN_UP_IDENTIFIER` exists specifically
so account creation is not left entirely unprotected in the meantime.

**Accepted cost.** A fail-closed endpoint depends on Redis for availability. `instrumentation.ts`
now opens the connection at startup, because the client sets `enableOfflineQueue: false` and would
otherwise answer 503 for the whole connect window on a cold start.

**Accepted cost.** Fixed windows allow a boundary burst, as described above.

**Rejected: a token bucket in application memory.** It would be per-instance, so it would silently
weaken as soon as the app scales past one process, and it would reset on every deploy.

**Rejected: rate limiting in `src/proxy.ts`.** The proxy runs on Edge without database or role
access (ADR 0006), so it cannot key a limit to a user, and it does not see Server Action invocations
at all.

**Rejected: disabling limits under test.** The e2e suite runs the production policies. Test subjects
are unique per test instead, and the rate-limit keyspace is cleared in global teardown.

## Values, and what would change them

The numbers are in `policies.ts` with rationales. They are first estimates chosen against how the
product behaves, not against measured traffic. `GUIDANCE_USER` (3 per 15 minutes) is the most likely
to need raising once paid plans have real users, and `SIGN_UP` per address is the most likely to
need tightening once real signup abuse appears.
