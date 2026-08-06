# ADR 0007: Security headers, CSP in Report-Only, and startup environment validation

- **Status:** Accepted
- **Date:** 2026-08-06
- **Phase:** 8A

## Context

Three related gaps came out of the Phase 8 audit.

**Environment validation existed but was never wired in.** `src/lib/env/*` was written in Phase 0
and nothing imported it. A deployment missing `AUTH_SECRET` would start normally and fail later,
somewhere inside a request, with an error that pointed at Auth.js rather than at the configuration.

**No security headers at all.** `next.config.ts` was an empty object: no CSP, no HSTS, no
clickjacking protection, and the framework advertised itself via `X-Powered-By`.

**Cookie posture was inherited, not stated.** Auth.js's defaults are sound, but nothing pinned or
tested them, so an upstream default change — or a production deployment somehow served over http —
could weaken session cookies with nothing failing.

## Decision

### 1. Validate the environment in `instrumentation.ts`

`register()` is the only true startup boundary in this architecture: Next calls it once per server
instance and it must complete before the server accepts requests. `proxy.ts` runs per request on
Edge; layouts run per render. Neither can fail a deployment early.

Variables are graded into four tiers rather than a single "required" list, because what is required
depends on where the process runs:

| Tier                            | Rule                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| Always required                 | `DATABASE_URL`                                                                           |
| Production runtime only         | `AUTH_SECRET` (≥32 chars, non-placeholder), `NEXT_PUBLIC_APP_URL` (https, not localhost) |
| Provider groups, all-or-nothing | Stripe (3 vars), Google (2 vars)                                                         |
| Optional everywhere             | `REDIS_URL`, `DIRECT_DATABASE_URL`, `OPENAI_*`, `SEED_ADMIN`                             |

Two properties matter more than the list itself:

- **Production checks are skipped during `next build`.** `next build` runs with
  `NODE_ENV=production`, so a naive implementation would demand runtime secrets to compile — forcing
  CI to hold an `AUTH_SECRET` it has no reason to hold. The build phase is detected via
  `NEXT_PHASE` and only the always-required tier applies.
- **Errors name the variable and the rule, never the value.** A message that echoed a malformed
  secret would put it in exactly the places secrets must not appear: terminals, CI logs, and
  crash reports.

A half-configured provider is treated as an error rather than silently ignored, because it fails at
the moment a user tries to use it rather than at deploy time.

**On failure in production the process exits.** This was not the original behaviour. Observed:
Next caught the thrown error, refused every request, and left the process running — traffic was
safely rejected, but a supervisor saw a live process and never restarted or alerted. Exiting makes
the failure legible to systemd, Docker, and orchestrators. In development the error is rethrown
instead, so a watch process is not killed mid-iteration.

### 2. Security headers in `next.config.ts`, not the proxy

`headers()` covers every route including statically rendered ones and costs nothing per request.
Setting them in `proxy.ts` would only cover matched paths, and — if nonces were added later —
would force dynamic rendering across the whole marketing site.

Applied everywhere: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and
`Content-Security-Policy-Report-Only`. `poweredByHeader` is disabled.

**HSTS is production-only.** Sending `Strict-Transport-Security` from a local http dev server would
pin the developer's browser to https for `localhost`, breaking that origin for every other project
on the machine.

### 3. CSP is Report-Only, and that is not a claim of enforcement

The policy is real and narrow — no wildcards, `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri` and `form-action` limited to `'self'`, fonts self-hosted by `next/font` so no third-party
origin is allowed. `'unsafe-eval'` and the dev websocket appear only in development.

But it is served as `Content-Security-Policy-Report-Only` and **blocks nothing**. What must be
resolved before enforcing it is listed in `CSP_ENFORCEMENT_BLOCKERS` in
`src/lib/security/headers.ts`, kept in code so it is reviewed alongside the policy:

1. `script-src` still needs `'unsafe-inline'` for Next's bootstrap and the next-themes no-flash
   script. Removing it needs per-request nonces from `proxy.ts`, which forces dynamic rendering on
   all ten currently-static marketing routes.
2. `style-src` still needs `'unsafe-inline'` for Tailwind v4 and `next/font`.
3. No `report-uri`/`report-to` endpoint exists, so violations are only visible in a browser console.
   Collecting them needs the Phase 8C observability boundary.
4. The policy has never been exercised against a Stripe Checkout redirect, because Stripe remains
   unverified.

Enforcement is a rename of one header key. It should not happen until at least 1–3 are closed.

### 4. State the cookie posture explicitly

`buildCookieOptions(isProduction)` is a pure function, so both modes are asserted in unit tests
without standing up an HTTPS server: `httpOnly` always, `sameSite: "lax"`, `path: "/"`, `secure`
and the `__Secure-`/`__Host-` prefixes in production only.

**SameSite is Lax, not Strict, deliberately.** The OAuth callback and sign-in redirect are top-level
cross-site GET navigations that Strict would strip the cookie from, breaking Google sign-in. Lax
still withholds cookies from cross-site POSTs, which is what protects the mutation routes.

The `__Secure-` prefix is production-only because browsers reject a cookie carrying it that lacks
`Secure` — applying it over local http would silently break every development session.

## Consequences

**Positive**

- A misconfigured production deployment fails at startup, naming the variable, and exits non-zero.
- CI and local development are unaffected by secrets they do not need.
- Every route carries baseline headers, verified against real HTTP responses.
- The cookie contract is tested rather than inherited.

**Negative**

- CSP is not enforcing, so it currently provides reporting value only. Calling it "CSP protection"
  would be false until the blockers above are closed.
- Header values are computed when the config loads, so changing `NODE_ENV` requires a restart. That
  is the normal deployment model and is what keeps HSTS off development.
- The placeholder heuristic for secrets is a guess. It catches `changeme`-style values, not a weak
  secret that merely looks random.
