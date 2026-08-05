# ADR 0001: Modular monolith over microservices

- **Status:** Accepted
- **Date:** 2026-08-04
- **Phase:** 0

## Context

NorthStar has several distinguishable domains — authentication, onboarding, guidance generation,
retrieval, action plans, billing, and analytics. A service-per-domain layout is one obvious way to
express that separation, and it is the shape many reference architectures reach for.

For this product the deciding constraints are different from a large-team system:

- One engineer builds and operates the whole thing.
- The domains share a single transactional core (a report, its citations, the usage ledger, and the
  subscription state all need to stay consistent).
- The project doubles as a portfolio artifact and must be explainable end to end in a short
  conversation.

Distributed boundaries would add network failure modes, cross-service transactions, and deployment
coordination without buying isolation anyone currently needs.

## Decision

Build a **modular monolith**: one deployable Next.js application, with boundaries enforced by
directory structure and typed interfaces rather than by process boundaries.

- `src/app` — routing, layouts, and Route Handlers only. No business logic.
- `src/components` — presentation. Domain-agnostic primitives in `ui/`.
- `src/features/<domain>` — business logic, one folder per domain. A feature owns its services,
  validators, and repository access.
- `src/lib` — shared infrastructure: `db`, `redis`, `ai`, `security`, `env`.

Rules:

- Features may depend on `lib`. Features should not reach into another feature's internals; cross
  domain needs go through an explicitly exported service function.
- External providers (OpenAI, Stripe, Auth.js) sit behind typed adapters in `lib` or in the owning
  feature, never called directly from a component or route file.

## Consequences

**Positive**

- One `pnpm dev`, one deploy, one log stream, one database transaction scope.
- Refactoring across domains stays a compile-time exercise.
- The whole request path can be traced by reading code, which is exactly what a technical interview
  rewards.

**Negative**

- Boundaries are conventions, so they erode unless enforced in review. Import discipline is the main
  thing to watch.
- The entire app scales as a unit. Acceptable: the expensive work (AI generation) is already
  offloaded to a provider, and the app itself is mostly I/O-bound.

**If this needs to change:** the feature folders are the natural extraction seams. A domain becomes a
service by promoting its exported service functions to an HTTP contract — the internal call sites
already go through that interface.
