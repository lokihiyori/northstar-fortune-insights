import { describe, expect, it } from "vitest";
import {
  POLICY_SETS,
  RATE_LIMIT_POLICIES,
  policiesFor,
  policy,
  retryAfterSeconds,
  type OperationName,
} from "@/lib/rate-limit/policies";

/**
 * The policy table is the whole contract. These tests assert the properties a
 * reviewer would otherwise have to re-derive from the numbers by hand: that the
 * operations the brief names are all covered, that failure modes match the
 * risk, and that Retry-After can never tell a client to retry immediately.
 */

describe("policy selection", () => {
  it("maps every protected operation to at least one policy", () => {
    for (const operation of Object.keys(POLICY_SETS) as OperationName[]) {
      expect(policiesFor(operation).length, operation).toBeGreaterThan(0);
    }
  });

  it("covers each operation the phase requires", () => {
    expect(Object.keys(POLICY_SETS).sort()).toEqual([
      "accountRead",
      "adminMutation",
      "billingAttempt",
      "guidanceGeneration",
      "regeneration",
      "signIn",
      "signUp",
    ]);
  });

  it("limits new billing attempts per user, fails closed, and reserves", () => {
    const policies = policiesFor("billingAttempt");
    expect(policies).toHaveLength(1);

    const [attempt] = policies;
    expect(attempt?.subject).toBe("user");
    expect(attempt?.limit).toBe(5);
    expect(attempt?.windowSeconds).toBe(3600);
    // Creating an attempt is a money path, so an unanswerable Redis refuses.
    expect(attempt?.failureMode).toBe("closed");
    // Reserved, so an outage or a lost claim race gives the unit back rather
    // than burning an hour of a legitimate user's budget.
    expect(attempt?.counting).toBe("reserved");
  });

  it("limits credential sign-in by both address and account", () => {
    const subjects = policiesFor("signIn").map((p) => p.subject);
    expect(subjects).toContain("ip");
    expect(subjects).toContain("identifier");
  });

  it("limits guidance generation by both user and address", () => {
    const subjects = policiesFor("guidanceGeneration").map((p) => p.subject);
    expect(subjects).toContain("user");
    expect(subjects).toContain("ip");
  });

  it("limits admin mutations by both user and address", () => {
    const subjects = policiesFor("adminMutation").map((p) => p.subject);
    expect(subjects).toContain("user");
    expect(subjects).toContain("ip");
  });

  it("gives sign-up a limit that survives an unknown client address", () => {
    // Without a trusted proxy the IP policy is skipped, so account creation
    // would otherwise have no server-side limit at all.
    const withoutIp = policiesFor("signUp").filter((p) => p.subject !== "ip");
    expect(withoutIp.length).toBeGreaterThan(0);
  });
});

describe("failure modes", () => {
  it("fails closed for every credential, generation, and admin policy", () => {
    const failClosed: OperationName[] = [
      "signIn",
      "signUp",
      "guidanceGeneration",
      "regeneration",
      "adminMutation",
    ];

    for (const operation of failClosed) {
      for (const p of policiesFor(operation)) {
        expect(p.failureMode, `${operation}/${p.id}`).toBe("closed");
      }
    }
  });

  it("fails open for ordinary reads", () => {
    for (const p of policiesFor("accountRead")) {
      expect(p.failureMode).toBe("open");
    }
  });

  it("reserves capacity for credential authentication rather than reading a count", () => {
    // Two properties in one: a success must not consume budget (or a person
    // locks themselves out by signing in), and the gate must be a reservation
    // rather than a read (or a concurrent burst all passes the same stale
    // count and exceeds the limit).
    for (const p of policiesFor("signIn")) {
      expect(p.counting).toBe("reserved");
    }
  });

  it("counts every attempt for operations where the attempt itself is the cost", () => {
    for (const operation of ["guidanceGeneration", "adminMutation", "signUp"] as const) {
      for (const p of policiesFor(operation)) {
        expect(p.counting, `${operation}/${p.id}`).toBe("always");
      }
    }
  });
});

describe("policy table integrity", () => {
  it("gives every policy a positive limit, window, and rationale", () => {
    for (const [name, p] of Object.entries(RATE_LIMIT_POLICIES)) {
      expect(p.limit, name).toBeGreaterThan(0);
      expect(p.windowSeconds, name).toBeGreaterThan(0);
      expect(p.rationale.length, name).toBeGreaterThan(20);
    }
  });

  it("uses a unique id per policy, since ids become Redis key segments", () => {
    const ids = Object.values(RATE_LIMIT_POLICIES).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the per-address ceiling above the per-account one for auth", () => {
    // Otherwise the coarse shared-NAT limit would bite before the precise
    // per-account limit, locking out bystanders.
    expect(policy("AUTH_IP").limit).toBeGreaterThan(policy("AUTH_IDENTIFIER").limit);
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up so a client never returns before the window ends", () => {
    expect(retryAfterSeconds(1500)).toBe(2);
    expect(retryAfterSeconds(60_000)).toBe(60);
    expect(retryAfterSeconds(59_001)).toBe(60);
  });

  it("never returns zero, which would invite an immediate certain refusal", () => {
    expect(retryAfterSeconds(0)).toBe(1);
    expect(retryAfterSeconds(-5)).toBe(1);
    expect(retryAfterSeconds(1)).toBe(1);
  });
});
