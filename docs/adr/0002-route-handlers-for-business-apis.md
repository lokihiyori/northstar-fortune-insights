# ADR 0002: Versioned Route Handlers for business APIs

- **Status:** Accepted
- **Date:** 2026-08-04
- **Phase:** 0

## Context

Next.js offers two ways to run server code for a mutation: Server Actions (a function invoked
directly from a component) and Route Handlers (an explicit HTTP endpoint).

Server Actions are less ceremony and are a good fit for a form that updates one record. They are a
poor fit for NorthStar's central operation. Guidance generation is long-running, must be idempotent
under retry, returns `202 Accepted` with a request ID, and is then polled for status (spec section
11). That is an HTTP resource with a lifecycle, not a form submission.

The Stripe webhook settles it independently: an external system posts to a URL and expects a
verifiable signature check. That can only be a Route Handler.

## Decision

Business and public APIs are **explicit Route Handlers under `src/app/api/v1/`**.

- The `v1` segment is in the path from the start. Adding a version prefix later means breaking every
  existing client; carrying one from day one costs nothing.
- Every handler validates input with Zod before doing work.
- Every handler returns the standard envelope from spec section 11 — `{ data, meta? }` on success,
  `{ error: { code, message, fieldErrors?, requestId } }` on failure.
- Handlers stay thin: authenticate, authorize, validate, delegate to a feature service, serialize.
- Server Actions remain permitted for simple, non-versioned, first-party UI mutations (a profile
  field, a task checkbox) where no external client and no retry semantics are involved.
- Route Handlers run in the Node.js runtime. Prisma and the provider SDKs need Node APIs, and the
  Edge runtime would rule them out.

## Consequences

**Positive**

- The API surface is inspectable — `curl`, Playwright's `request` fixture, and Stripe's CLI all work
  against it without a browser.
- Idempotency keys, rate limits, and the error envelope live in one place rather than being
  reimplemented per action.
- Contract changes are visible as route changes in review.

**Negative**

- More boilerplate per endpoint than a Server Action, and request/response types must be kept in sync
  with the client by hand. Zod schemas shared between the handler and its caller are the mitigation.
- Two mutation mechanisms coexist, so "which one applies here" is a judgment call. The rule above is
  the tiebreaker: anything external, versioned, retryable, or long-running is a Route Handler.
