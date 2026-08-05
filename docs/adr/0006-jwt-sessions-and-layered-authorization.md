# ADR 0006: JWT sessions, and authorization enforced in layouts rather than the proxy

- **Status:** Accepted
- **Date:** 2026-08-04
- **Phase:** 2

## Context

The spec allows "Auth.js with database sessions or a carefully documented JWT strategy". Two
constraints force the choice.

**Credentials and database sessions are mutually exclusive in Auth.js.** The credentials
provider has no adapter callback that can create a `Session` row, so enabling it requires
`strategy: "jwt"`. Email and password sign-in is an MVP requirement, so the JWT strategy
follows from it.

**The Edge runtime cannot run Prisma.** Next's proxy (formerly middleware) runs on Edge. It
can verify a signed session cookie, but it cannot query the database — so it cannot confirm
the user still exists, has not been deleted, or still holds the role their token claims.

## Decision

**JWT sessions**, with a deliberately layered authorization model:

| Layer                                                   | Runs on | Can it query the DB? | Role                                                 |
| ------------------------------------------------------- | ------- | -------------------- | ---------------------------------------------------- |
| `src/proxy.ts`                                          | Edge    | No                   | Fast redirect for unauthenticated requests to `/app` |
| `requireUser` / `requireAdmin` in a layout or page      | Node    | Yes                  | **The actual boundary**                              |
| `requireApiUser` / `requireApiAdmin` in a Route Handler | Node    | Yes                  | **The actual boundary**                              |

Rules that follow:

- The proxy is an optimization. Deleting it must not make the application less secure — only
  slower to redirect. It is never the sole check on anything.
- Every protected layout, page, and Route Handler calls a guard itself. `/app/layout.tsx`
  calls `requireUser`, so nothing rendered beneath it is reachable unauthenticated.
- Server Components redirect; Route Handlers return the standard error envelope with a status
  code. An API must not answer an unauthenticated request with an HTML redirect.
- **Roles in the token are a hint, not an authority.** Any operation that depends on being an
  admin re-reads the role from the database in the same request.
- The `Session` table is kept in the schema even though it is unused, so adopting database
  sessions later is a configuration change rather than a migration.

## Consequences

**Positive**

- Email/password sign-in works, which is the point.
- No session lookup per request, so the common path is one signature verification.
- The security model survives a proxy misconfiguration, which is a routine mistake with
  matcher patterns.

**Negative**

- **A JWT cannot be revoked before it expires.** Signing out clears the cookie, but a stolen
  token stays valid until `maxAge` (30 days). This is the real cost of the strategy. If
  server-side revocation becomes a requirement, the mitigation is to switch to database
  sessions — which means dropping the credentials provider or handling its session creation
  manually.
- A role change does not take effect in the token until the session is refreshed, which is
  precisely why privileged operations re-read the role.
- Guard calls are repeated in every protected entry point. That repetition is deliberate: it
  is what makes each one independently safe.
