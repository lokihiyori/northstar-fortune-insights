# ADR 0005: Accepting Auth.js v5 while it is still beta

- **Status:** Accepted
- **Date:** 2026-08-04
- **Phase:** 2

## Context

The build spec names Auth.js, and the Phase 0 constraints say to prefer current
stable releases and to stop and explain before installing a beta. Those two
instructions conflict here.

At the time of writing:

- `next-auth@latest` is **4.24.15** — genuinely stable, but its API predates the App
  Router. Server-side session access is `getServerSession(authOptions)`, threaded through
  every guard, and the documentation is written for the Pages Router.
- `next-auth@beta` is **5.0.0-beta.32** — the version `authjs.dev` documents for App
  Router, with the `auth()` helper that works directly in Server Components, layouts, and
  Route Handlers. It has been in beta for roughly two years.
- `@auth/prisma-adapter` is **stable at 2.11.3** and is shared by both.

A third option, `better-auth@1.6.26`, is genuinely stable and App-Router-native, but is not
what the spec names.

## Decision

Use **`next-auth@5.0.0-beta.32`, pinned to that exact version** — no caret range.

The reasoning is that "beta" here describes release process, not maturity. v5 is what the
official documentation targets for this exact stack, it is very widely deployed, and the v4
alternative would mean writing guards against an API that is documented for a different
router. Choosing v4 satisfies the letter of the no-beta rule while producing worse code.

The pin is the mitigation that matters: breaking changes between beta releases are real, so
the version must never move as a side effect of an unrelated install.

## Consequences

**Positive**

- `auth()` reads the session directly in layouts and Route Handlers, so guards stay small.
- Follows the documentation the rest of the ecosystem is written against.
- The Prisma adapter is stable, so the persistence half of authentication carries no beta risk.

**Negative**

- Upgrading is a deliberate, tested exercise. Release notes must be read; a beta bump is not
  a routine dependency update.
- If v5 stabilizes with breaking changes, some migration work is expected. The blast radius
  is bounded: `src/auth.ts`, `src/features/auth/`, and `src/proxy.ts`.
- One dependency in the project is not a stable release, which must be stated honestly rather
  than glossed over.

**Revisit when** `next-auth@5` reaches a stable tag — at which point the pin should move to a
caret range and this ADR should be superseded.
