import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/features/auth/password";
import { DEMO_EMAIL_PATTERN } from "@/lib/env/schema";
import { demoAccountPassword, demoAllowedInProduction, demoModeEnabled } from "./config";
import { DEMO_CONSTRAINTS, DEMO_ONBOARDING_STEP, DEMO_PRIORITIES, DEMO_PROFILE } from "./snapshot";

/**
 * Operator-only reset of the demo account.
 *
 * This module deletes rows, so it is written to refuse rather than to guess.
 * Every guard runs *before* the first write, the target is resolved to one
 * exact user id, and nothing is ever deleted by pattern, prefix, or role.
 *
 * Deliberately not reachable over HTTP. There is no route, no Server Action,
 * and no admin button — a public reset endpoint is a denial-of-service handle
 * on a shared account.
 */

/** Accounts the reset must never touch, whatever the configuration says. */
const PROTECTED_EMAILS = new Set(["dev@northstar.local", "admin@northstar.local"]);

export type ResetRefusal = { ok: false; reason: string };
export type ResetSuccess = {
  ok: true;
  /** Sanitized: local part is masked, so logs never carry a full address. */
  identity: string;
  created: boolean;
  deleted: Record<string, number>;
};
export type ResetOutcome = ResetRefusal | ResetSuccess;

/** `p***a@example.com` — enough to confirm the target, not enough to reuse. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const masked =
    local.length <= 2
      ? "*".repeat(Math.max(local.length, 1))
      : `${local[0] ?? ""}***${local.at(-1) ?? ""}`;
  return `${masked}@${domain}`;
}

/**
 * Configuration checks, in order, with no database access.
 *
 * Separated from the transaction so the whole refusal matrix is unit testable
 * without PostgreSQL.
 */
export function checkResetConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): ResetRefusal | { ok: true; email: string; password: string } {
  if (!demoModeEnabled(env)) {
    return { ok: false, reason: 'DEMO_MODE_ENABLED is not "true". Refusing to reset.' };
  }

  const raw = env["DEMO_ACCOUNT_EMAIL"] ?? "";
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "DEMO_ACCOUNT_EMAIL is empty. Refusing to reset." };
  }

  // Unexpanded `${VAR}` / `%VAR%` markers, wildcards, and whitespace all fail
  // this pattern. The value selects the row that gets deleted.
  if (!DEMO_EMAIL_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason:
        "DEMO_ACCOUNT_EMAIL is not a single ordinary email address (whitespace, wildcard, or unexpanded variable). Refusing to reset.",
    };
  }

  const email = trimmed.toLowerCase();

  if (PROTECTED_EMAILS.has(email)) {
    return {
      ok: false,
      reason: "DEMO_ACCOUNT_EMAIL points at a seeded development account. Refusing to reset.",
    };
  }

  const password = demoAccountPassword(env);
  if (password === null || password.length < 12) {
    return {
      ok: false,
      reason: "DEMO_ACCOUNT_PASSWORD is missing or shorter than 12 characters. Refusing to reset.",
    };
  }

  if (env["NODE_ENV"] === "production" && !demoAllowedInProduction(env)) {
    return {
      ok: false,
      reason:
        'NODE_ENV is production and DEMO_ALLOW_IN_PRODUCTION is not "true". Refusing to reset.',
    };
  }

  return { ok: true, email, password };
}

/**
 * Rebuilds the demo account to the exact snapshot.
 *
 * Deletion strategy: remove the one user row by **id** and let the schema's
 * cascades take its owned rows with it — sessions, accounts, profile,
 * priorities, constraints, requests, reports (and their paths, reasons,
 * actions, citations), plans (tasks, check-ins), feedback, usage ledger, and
 * subscription. Analytics events are deleted explicitly first, because that
 * relation is `SetNull` and would otherwise leave orphans accumulating across
 * resets.
 *
 * Audit logs are *not* deleted. `AuditLog.actorId` is `SetNull` by design so
 * history outlives the actor, and the demo account is never an admin, so it
 * should author none in the first place — the reset asserts that rather than
 * assuming it.
 *
 * Shared content is never touched: no source, no passage, no other user.
 */
export async function resetDemoAccount(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResetOutcome> {
  const config = checkResetConfiguration(env);
  if (!config.ok) return config;

  const { email, password } = config;

  // Exact match, and `findMany` rather than `findUnique` so "more than one"
  // is an observed refusal rather than an assumption about the constraint.
  const matches = await prisma.user.findMany({
    where: { email },
    select: { id: true, email: true, role: true },
  });

  if (matches.length > 1) {
    return {
      ok: false,
      reason: "More than one account matches the demo email. Refusing to reset.",
    };
  }

  const existing = matches[0] ?? null;

  if (existing !== null && existing.role !== "USER") {
    return {
      ok: false,
      reason: "The configured demo account does not have role USER. Refusing to reset.",
    };
  }

  const deleted: Record<string, number> = {};

  if (existing !== null) {
    const auditored = await prisma.auditLog.count({ where: { actorId: existing.id } });
    if (auditored > 0) {
      // A demo account with audit history means it acted as an admin at some
      // point. Stop rather than quietly deleting the row that records it.
      return {
        ok: false,
        reason: `The demo account has ${String(auditored)} audit log entr${auditored === 1 ? "y" : "ies"}, which means it once held elevated rights. Refusing to reset.`,
      };
    }
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    if (existing !== null) {
      const events = await tx.analyticsEvent.deleteMany({ where: { userId: existing.id } });
      deleted["analyticsEvents"] = events.count;

      // One row, by id. Never `deleteMany` on users, never by pattern.
      await tx.user.delete({ where: { id: existing.id } });
      deleted["users"] = 1;
    }

    await tx.user.create({
      data: {
        email,
        name: DEMO_PROFILE.name,
        role: "USER",
        passwordHash,
        profile: {
          create: {
            region: DEMO_PROFILE.region,
            careerStage: DEMO_PROFILE.careerStage,
            currentRole: DEMO_PROFILE.currentRole,
            primaryGoal: DEMO_PROFILE.primaryGoal,
            timeframe: DEMO_PROFILE.timeframe,
            notes: DEMO_PROFILE.notes,
            onboardingStep: DEMO_ONBOARDING_STEP,
            onboardingCompletedAt: new Date(),
          },
        },
        priorities: { create: DEMO_PRIORITIES.map((p) => ({ key: p.key, rank: p.rank })) },
        constraints: {
          create: DEMO_CONSTRAINTS.map((c) => ({
            type: c.type,
            value: c.value,
            isHardConstraint: c.isHardConstraint,
          })),
        },
      },
    });
  });

  return { ok: true, identity: maskEmail(email), created: true, deleted };
}
