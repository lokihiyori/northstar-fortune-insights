# Architecture decision records

Short records of decisions that would otherwise be re-litigated. Each states the context, the
decision, and what it costs.

| ADR                                                    | Decision                                          | Status   |
| ------------------------------------------------------ | ------------------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)                       | Modular monolith over microservices               | Accepted |
| [0002](0002-route-handlers-for-business-apis.md)       | Versioned Route Handlers for business APIs        | Accepted |
| [0003](0003-postgresql-with-prisma.md)                 | PostgreSQL with Prisma, including vector search   | Accepted |
| [0004](0004-redis-scope.md)                            | Redis is cache and coordination only              | Accepted |
| [0005](0005-authjs-v5-beta.md)                         | Accepting Auth.js v5 while it is still beta       | Accepted |
| [0006](0006-jwt-sessions-and-layered-authorization.md) | JWT sessions, authorization enforced in layouts   | Accepted |
| [0007](0007-security-headers-and-env-validation.md)    | Security headers, CSP Report-Only, env validation | Accepted |
| [0008](0008-rate-limiting.md)                          | Redis fixed-window rate limiting, fail-closed     | Accepted |
| [0009](0009-observability.md)                          | Structured logs, request correlation, readiness   | Accepted |

Add a new record as `NNNN-short-title.md` and link it here. Supersede rather than edit an accepted
record: mark the old one `Superseded by ADR NNNN` and keep it.
