/**
 * Rate-limit policy table (Phase 8B).
 *
 * Every limit in the product is declared here and nowhere else. Scattering
 * numbers across route handlers is how a limit silently diverges from the one
 * its tests assert, and how a tightening lands on one entry point but not the
 * other that reaches the same work.
 *
 * Pure data plus pure functions — no Redis, no `server-only` — so policy
 * selection is testable without a running service.
 */

/** Where a limit is counted. */
export type SubjectKind =
  /** The authenticated user id. Survives IP changes; the primary control. */
  | "user"
  /** A keyed digest of a normalized login identifier. Never the address itself. */
  | "identifier"
  /** The client IP, only when a trusted proxy boundary can supply one. */
  | "ip";

/**
 * What to do when Redis cannot answer.
 *
 * `closed` — refuse the request. Correct where an unlimited endpoint is itself
 * the risk: credential attempts, paid AI generation, admin mutations.
 * `open` — serve the request. Correct for ordinary reads, where a Redis outage
 * must degrade performance rather than availability (ADR 0004).
 */
export type FailureMode = "closed" | "open";

/**
 * `always` — every attempt consumes budget and keeps it.
 *
 * `reserved` — capacity is reserved atomically *before* the work, and given back
 * if the outcome turns out not to be a failure worth counting. Used for
 * credential authentication: stuffing produces failures, while a person signing
 * in several times a day is not an attack and must not be able to lock
 * themselves out.
 *
 * Reserving is what makes the limit hold under concurrency. Reading a count and
 * then deciding is not atomic — many simultaneous callers all read the same
 * pre-attempt value and are all admitted, so one burst can exceed the limit.
 */
export type CountingMode = "always" | "reserved";

export type RateLimitPolicy = {
  id: string;
  subject: SubjectKind;
  /** Attempts permitted within one window. */
  limit: number;
  windowSeconds: number;
  failureMode: FailureMode;
  counting: CountingMode;
  /** Why this number. Read by the docs and by whoever tunes it later. */
  rationale: string;
};

const MINUTE = 60;

export const RATE_LIMIT_POLICIES = {
  /**
   * Coarse ceiling against one host spraying many accounts. Deliberately loose:
   * offices, campuses, and carrier-grade NAT put many legitimate people behind
   * one address, so this cannot be the primary credential control.
   */
  AUTH_IP: {
    id: "auth_ip",
    subject: "ip",
    limit: 20,
    windowSeconds: 10 * MINUTE,
    failureMode: "closed",
    counting: "reserved",
    rationale:
      "Coarse per-address ceiling on failed credential attempts, reserved before verification. Loose because shared NAT is common; AUTH_IDENTIFIER is the real control.",
  },

  /**
   * The primary credential-stuffing control. Five failures against one account
   * in fifteen minutes is already well past human mistyping.
   */
  AUTH_IDENTIFIER: {
    id: "auth_identifier",
    subject: "identifier",
    limit: 5,
    windowSeconds: 15 * MINUTE,
    failureMode: "closed",
    counting: "reserved",
    rationale:
      "Five failed attempts per account per 15 minutes. Capacity is reserved before verification so a concurrent burst cannot exceed it, and a success gives its reservation back — a legitimate user cannot lock themselves out.",
  },

  /** Bot account farms. Inert until a trusted proxy supplies a client IP. */
  SIGN_UP: {
    id: "sign_up_ip",
    subject: "ip",
    limit: 5,
    windowSeconds: 60 * MINUTE,
    failureMode: "closed",
    counting: "always",
    rationale:
      "Five accounts per address per hour. Generous for a household, restrictive for a farm.",
  },

  /**
   * Added beyond the Phase 8B brief: without a trusted proxy the IP policy above
   * is skipped entirely, which would leave account creation with no server-side
   * limit at all. This one works regardless of proxy configuration.
   */
  SIGN_UP_IDENTIFIER: {
    id: "sign_up_identifier",
    subject: "identifier",
    limit: 3,
    windowSeconds: 60 * MINUTE,
    failureMode: "closed",
    counting: "always",
    rationale:
      "Repeat creation attempts against one address. Exists because SIGN_UP is inert without a trusted proxy.",
  },

  /**
   * Burst ceiling on paid generation.
   *
   * The monthly entitlement cannot do this job: usage is charged only on
   * success and only after the response is sent, so several rapid submissions
   * all read an empty ledger and all pass the quota check.
   */
  GUIDANCE_USER: {
    id: "guidance_user",
    subject: "user",
    limit: 3,
    windowSeconds: 15 * MINUTE,
    failureMode: "closed",
    counting: "always",
    rationale:
      "Burst ceiling on expensive AI generation, set at the free monthly allowance. The entitlement ledger is written asynchronously on success, so it cannot stop a burst by itself. Most likely value to need raising for paid plans.",
  },

  GUIDANCE_IP: {
    id: "guidance_ip",
    subject: "ip",
    limit: 10,
    windowSeconds: 15 * MINUTE,
    failureMode: "closed",
    counting: "always",
    rationale: "Stops one host driving generation across many accounts it controls.",
  },

  REGENERATION_USER: {
    id: "regeneration_user",
    subject: "user",
    limit: 5,
    windowSeconds: 60 * MINUTE,
    failureMode: "closed",
    counting: "always",
    rationale:
      "Regeneration re-runs the whole pipeline at full cost. Five per hour covers revisiting a decision; it does not cover a loop.",
  },

  ADMIN_MUTATION_USER: {
    id: "admin_mutation_user",
    subject: "user",
    limit: 30,
    windowSeconds: 10 * MINUTE,
    failureMode: "closed",
    counting: "always",
    rationale:
      "Curating a source takes roughly five mutations, so this allows about six sources per ten minutes while bounding a compromised admin session.",
  },

  ADMIN_MUTATION_IP: {
    id: "admin_mutation_ip",
    subject: "ip",
    limit: 60,
    windowSeconds: 10 * MINUTE,
    failureMode: "closed",
    counting: "always",
    rationale: "Ceiling across all admin sessions from one address.",
  },

  /**
   * The fail-open case. A Redis outage must not take account reads offline —
   * PostgreSQL is the source of truth and this endpoint is cheap (ADR 0004).
   */
  READ_API_USER: {
    id: "read_api_user",
    subject: "user",
    limit: 300,
    windowSeconds: 5 * MINUTE,
    failureMode: "open",
    counting: "always",
    rationale:
      "Generous ceiling on ordinary reads, purely to bound a runaway client. Fails open: an outage degrades protection, never availability.",
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof RATE_LIMIT_POLICIES;

export function policy(name: PolicyName): RateLimitPolicy {
  return RATE_LIMIT_POLICIES[name];
}

/** Policy sets per protected operation, so an entry point cannot pick its own. */
export const POLICY_SETS = {
  signIn: ["AUTH_IP", "AUTH_IDENTIFIER"],
  signUp: ["SIGN_UP", "SIGN_UP_IDENTIFIER"],
  guidanceGeneration: ["GUIDANCE_USER", "GUIDANCE_IP"],
  regeneration: ["REGENERATION_USER"],
  adminMutation: ["ADMIN_MUTATION_USER", "ADMIN_MUTATION_IP"],
  accountRead: ["READ_API_USER"],
} as const satisfies Record<string, readonly PolicyName[]>;

export type OperationName = keyof typeof POLICY_SETS;

export function policiesFor(operation: OperationName): RateLimitPolicy[] {
  return POLICY_SETS[operation].map((name) => policy(name));
}

/**
 * Seconds a client should wait, from milliseconds of remaining window.
 *
 * Always at least one: a `Retry-After: 0` invites an immediate retry that is
 * certain to be refused. Rounded up so the client never returns early.
 */
export function retryAfterSeconds(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / 1000));
}
