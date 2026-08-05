# ADR 0004: Redis is cache and coordination only, never a source of truth

- **Status:** Accepted
- **Date:** 2026-08-04
- **Phase:** 0

## Context

Redis is easy to over-adopt. Once it is running, it is tempting to keep session state, generation
progress, or usage counters there because it is faster than the database and the write is a one-liner.

That failure mode is expensive for NorthStar specifically. Usage counts gate a paid feature and must
reconcile with the subscription. Report state is what the user paid for. If Redis is flushed,
restarted, or evicts a key under memory pressure, anything that lived only in Redis is gone — with no
migration history, no backup, and no audit trail.

## Decision

**PostgreSQL is the source of truth. Redis holds only data that may be lost without correctness
consequences.**

Permitted uses:

- **Response and retrieval caching** — resource-search results keyed by normalized query, topic,
  region, source version, and embedding model. Invalidated when an admin publishes or retires a
  source.
- **Rate limiting** — per-user and per-IP counters with TTLs.
- **Idempotency keys** — short-lived deduplication of generation requests and webhook deliveries.
  The durable record of what was processed still goes in Postgres; Redis only makes the common case
  cheap.
- **Short-lived generation state** — progress stage for the status endpoint, TTL-bounded. The
  authoritative request status is a column on `GuidanceRequest`.

Explicitly excluded:

- Sessions (Auth.js uses database sessions — ADR to follow in Phase 2).
- The usage ledger, subscription state, or entitlements.
- Anything that would be wrong to recompute, or impossible to recompute, after a flush.

Corollaries:

- **Every key gets a TTL.** No unbounded keyspace.
- **Every read path must work when Redis is down.** A cache miss is a slower correct answer; a rate
  limiter that cannot reach Redis fails open on reads and closed on expensive writes.
- Private personalized reports are never cached under a shared key (spec section 9).

## Consequences

**Positive**

- Redis can be restarted, flushed, or replaced with no data-loss incident.
- Local development works with an empty Redis, which keeps the Docker Compose setup honest.
- The blast radius of a caching bug is latency, not incorrect billing.

**Negative**

- Some things are slower than they could be — usage checks hit Postgres on the write path rather than
  being served from a Redis counter. That is the intended trade: a correct count is worth a query.
- Cache invalidation on source publish/retire is real work that has to be maintained in Phase 7.
