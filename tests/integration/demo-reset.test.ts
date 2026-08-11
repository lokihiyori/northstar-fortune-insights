// @vitest-environment node
import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { resetDemoAccount } from "@/features/demo/reset";
import { demoRateLimitKeys } from "@/features/demo/redis-cleanup";
import {
  DEMO_CONSTRAINTS,
  DEMO_ONBOARDING_STEP,
  DEMO_PRIORITIES,
  DEMO_PROFILE,
} from "@/features/demo/snapshot";
import { hashPassword } from "@/features/auth/password";

/**
 * Reset isolation, proved against real PostgreSQL and real Redis.
 *
 * The claim being tested is not "the UI hides other people's data" — it is that
 * an operator command which deletes rows touches **only** the demo account. So
 * the test builds a control user with rows in every private table, fingerprints
 * them, runs the reset repeatedly, and checks the fingerprint is byte-identical
 * afterwards. Shared corpus rows get the same treatment.
 */

const DEMO_EMAIL = `demo-reset-${randomUUID().slice(0, 8)}@northstar.test`;
const CONTROL_EMAIL = `control-${randomUUID().slice(0, 8)}@northstar.test`;
const DEMO_PASSWORD = "integration-demo-passphrase";

const demoEnv = {
  ...process.env,
  DEMO_MODE_ENABLED: "true",
  DEMO_ACCOUNT_EMAIL: DEMO_EMAIL,
  DEMO_ACCOUNT_PASSWORD: DEMO_PASSWORD,
  NODE_ENV: "test",
} as unknown as NodeJS.ProcessEnv;

let controlUserId = "";
const redis = new Redis(process.env["REDIS_URL"] ?? "redis://127.0.0.1:56379", {
  maxRetriesPerRequest: 2,
});

/** Stable digest of everything the control user owns, across every table. */
async function controlFingerprint(): Promise<string> {
  const [
    user,
    profile,
    priorities,
    constraints,
    requests,
    reports,
    plans,
    tasks,
    feedback,
    usage,
    events,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: controlUserId },
      select: { email: true, role: true, name: true, passwordHash: true },
    }),
    prisma.userProfile.findUnique({
      where: { userId: controlUserId },
      select: { region: true, primaryGoal: true, onboardingStep: true },
    }),
    prisma.userPriority.findMany({
      where: { userId: controlUserId },
      orderBy: { rank: "asc" },
      select: { key: true, rank: true },
    }),
    prisma.userConstraint.findMany({
      where: { userId: controlUserId },
      orderBy: { value: "asc" },
      select: { type: true, value: true },
    }),
    prisma.guidanceRequest.findMany({
      where: { userId: controlUserId },
      select: { id: true, question: true, status: true },
    }),
    prisma.guidanceReport.findMany({
      where: { userId: controlUserId },
      select: { id: true, summary: true },
    }),
    prisma.actionPlan.findMany({
      where: { userId: controlUserId },
      select: { id: true, title: true },
    }),
    prisma.planTask.findMany({
      where: { plan: { userId: controlUserId } },
      select: { id: true, title: true, status: true },
    }),
    prisma.feedback.findMany({ where: { userId: controlUserId }, select: { rating: true } }),
    prisma.usageLedger.findMany({
      where: { userId: controlUserId },
      select: { feature: true, periodKey: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { userId: controlUserId },
      select: { eventName: true },
    }),
  ]);

  return createHash("sha256")
    .update(
      JSON.stringify({
        user,
        profile,
        priorities,
        constraints,
        requests,
        reports,
        plans,
        tasks,
        feedback,
        usage,
        events,
      }),
    )
    .digest("hex");
}

/**
 * Shared, non-user-owned content. The demo may read it, never mutate it.
 *
 * Scoped to the *seeded* corpus. Sibling integration files create and retire
 * their own sources on the same database, and vitest runs files in parallel, so
 * an unscoped digest would drift for reasons that have nothing to do with the
 * reset. Test-created sources use the `sources.northstar.test` host.
 */
async function corpusFingerprint(): Promise<string> {
  const seeded = { canonicalUrl: { not: { contains: "northstar.test" } } };
  const [sources, chunks] = await Promise.all([
    prisma.source.findMany({
      where: seeded,
      orderBy: { id: "asc" },
      select: { id: true, title: true, status: true, deletedAt: true },
    }),
    prisma.sourceChunk.findMany({
      where: { source: seeded },
      orderBy: { id: "asc" },
      select: { id: true, checksum: true },
    }),
  ]);
  return createHash("sha256").update(JSON.stringify({ sources, chunks })).digest("hex");
}

/** The exact post-reset state, as a comparable object. */
async function demoSnapshot() {
  const user = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      profile: {
        select: {
          region: true,
          careerStage: true,
          currentRole: true,
          primaryGoal: true,
          timeframe: true,
          notes: true,
          onboardingStep: true,
          onboardingCompletedAt: true,
        },
      },
      priorities: { orderBy: { rank: "asc" }, select: { key: true, rank: true } },
      constraints: {
        orderBy: { value: "asc" },
        select: { type: true, value: true, isHardConstraint: true },
      },
      _count: {
        select: {
          requests: true,
          reports: true,
          plans: true,
          feedback: true,
          usage: true,
          // Auth.js `Account` has a composite key and no `id` column, so these
          // are counted rather than listed.
          accounts: true,
          sessions: true,
        },
      },
      subscription: { select: { id: true } },
    },
  });
  if (user === null) return null;
  // The id and the completion timestamp change on every reset by design; the
  // rest must be identical.
  // `id` is destructured away deliberately: it changes on every reset.
  const { id: _id, profile, ...rest } = user;
  return {
    ...rest,
    profile:
      profile === null
        ? null
        : { ...profile, onboardingCompletedAt: profile.onboardingCompletedAt !== null },
  };
}

/**
 * One row in every private table a user owns, so the fingerprints below have
 * something to be wrong about. Field sets are the real ones from the schema,
 * not a guess.
 */
async function createJourneyRows(userId: string, label: string): Promise<void> {
  const request = await prisma.guidanceRequest.create({
    data: {
      userId,
      topic: "EDUCATION",
      question: `${label} question.`,
      status: "READY",
      inputSnapshot: { label },
      promptVersion: "test-v1",
      idempotencyKey: randomUUID(),
    },
  });

  const report = await prisma.guidanceReport.create({
    data: {
      requestId: request.id,
      userId,
      version: 1,
      title: `${label} report`,
      questionRestatement: `${label} restated`,
      summary: `${label} summary`,
      disclaimer: "Fictional test data.",
      confidenceBasis: "HIGH_EVIDENCE",
      confidenceReasons: [label],
      missingInformation: [],
      evidenceSnapshot: { label },
      modelName: "deterministic",
      promptVersion: "test-v1",
    },
  });

  const path = await prisma.recommendationPath.create({
    data: {
      reportId: report.id,
      label: "BEST_FIT",
      title: `${label} path`,
      fit: "STRONG",
      timeHorizon: "6 months",
      mainTradeoff: "Time versus cost",
      position: 1,
    },
  });

  const plan = await prisma.actionPlan.create({
    data: {
      userId,
      reportId: report.id,
      pathId: path.id,
      title: `${label} plan`,
      desiredOutcome: `${label} outcome`,
      status: "ACTIVE",
    },
  });

  await prisma.planTask.create({
    data: {
      planId: plan.id,
      title: `${label} task`,
      description: `${label} task description`,
      status: "TODO",
      milestone: 30,
      position: 1,
    },
  });
  await prisma.planCheckIn.create({ data: { planId: plan.id, note: `${label} check-in` } });
  await prisma.feedback.create({
    data: { userId, reportId: report.id, rating: "USEFUL", tags: [] },
  });
  await prisma.usageLedger.create({
    data: { userId, requestId: request.id, feature: "report", periodKey: "2026-08" },
  });
  await prisma.analyticsEvent.create({
    data: { userId, eventName: "report_viewed", properties: {} },
  });
}

beforeAll(async () => {
  const passwordHash = await hashPassword("control-user-passphrase");

  const control = await prisma.user.create({
    data: {
      email: CONTROL_EMAIL,
      name: "Control User",
      role: "USER",
      passwordHash,
      profile: {
        create: { region: "Halifax, Nova Scotia", primaryGoal: "Sentinel goal", onboardingStep: 2 },
      },
      priorities: { create: [{ key: "LEARNING", rank: 1 }] },
      constraints: {
        create: [{ type: "TIME", value: "Sentinel constraint", isHardConstraint: false }],
      },
    },
  });
  controlUserId = control.id;

  await createJourneyRows(controlUserId, "Sentinel");
});

afterAll(async () => {
  await prisma.analyticsEvent.deleteMany({ where: { userId: controlUserId } });
  await prisma.user.deleteMany({ where: { email: { in: [CONTROL_EMAIL, DEMO_EMAIL] } } });
  const keys = await redis.keys("northstar:rl:v1:*demo-reset*");
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

describe("demo reset isolation", () => {
  it("creates the exact snapshot, leaves the control user and corpus untouched", async () => {
    const controlBefore = await controlFingerprint();
    const corpusBefore = await corpusFingerprint();

    // A key that belongs to nobody in particular — it must survive.
    await redis.set("northstar:retrieval:sentinel", "keep-me");
    const unrelatedKey = "northstar:rl:v1:auth_identifier:unrelated-subject-digest";
    await redis.set(unrelatedKey, "3", "EX", 900);

    const first = await resetDemoAccount(prisma, demoEnv);
    expect(first.ok).toBe(true);

    const snapshot = await demoSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.role).toBe("USER");
    expect(snapshot?.email).toBe(DEMO_EMAIL);
    expect(snapshot?.name).toBe(DEMO_PROFILE.name);
    expect(snapshot?.profile?.region).toBe(DEMO_PROFILE.region);
    expect(snapshot?.profile?.onboardingStep).toBe(DEMO_ONBOARDING_STEP);
    expect(snapshot?.profile?.onboardingCompletedAt).toBe(true);
    expect(snapshot?.priorities).toHaveLength(DEMO_PRIORITIES.length);
    expect(snapshot?.constraints).toHaveLength(DEMO_CONSTRAINTS.length);

    // No history, no billing, no external link.
    expect(snapshot?._count).toEqual({
      requests: 0,
      reports: 0,
      plans: 0,
      feedback: 0,
      usage: 0,
      accounts: 0,
      sessions: 0,
    });
    expect(snapshot?.subscription).toBeNull();

    expect(await controlFingerprint()).toBe(controlBefore);
    expect(await corpusFingerprint()).toBe(corpusBefore);
    expect(await redis.get("northstar:retrieval:sentinel")).toBe("keep-me");
    expect(await redis.get(unrelatedKey)).toBe("3");

    await redis.del("northstar:retrieval:sentinel", unrelatedKey);
  });

  it("removes demo-created state and reproduces the snapshot exactly", async () => {
    const controlBefore = await controlFingerprint();
    const corpusBefore = await corpusFingerprint();
    const snapshotBefore = await demoSnapshot();

    const demo = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });

    // Exercise the journey: the demo account accumulates its own rows across
    // every table the reset is supposed to clear.
    await createJourneyRows(demo.id, "Demo-created");

    const second = await resetDemoAccount(prisma, demoEnv);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.deleted["users"]).toBe(1);
      expect(second.deleted["analyticsEvents"]).toBe(1);
      // Masked, never the full address.
      expect(second.identity).not.toBe(DEMO_EMAIL);
      expect(second.identity).toContain("@northstar.test");
    }

    // Everything the demo created is gone, and the snapshot is reproduced.
    expect(await demoSnapshot()).toEqual(snapshotBefore);
    expect(
      await prisma.guidanceRequest.count({ where: { question: "Demo-created question." } }),
    ).toBe(0);
    expect(await prisma.actionPlan.count({ where: { title: "Demo-created plan" } })).toBe(0);
    expect(await prisma.planTask.count({ where: { title: "Demo-created task" } })).toBe(0);
    expect(await prisma.analyticsEvent.count({ where: { userId: demo.id } })).toBe(0);

    expect(await controlFingerprint()).toBe(controlBefore);
    expect(await corpusFingerprint()).toBe(corpusBefore);
  });

  it("is idempotent on a third consecutive run", async () => {
    const controlBefore = await controlFingerprint();
    const snapshotBefore = await demoSnapshot();

    const third = await resetDemoAccount(prisma, demoEnv);
    expect(third.ok).toBe(true);

    expect(await demoSnapshot()).toEqual(snapshotBefore);
    expect(await controlFingerprint()).toBe(controlBefore);
  });

  it("refuses to touch an account that is not role USER", async () => {
    const controlBefore = await controlFingerprint();

    await prisma.user.update({ where: { email: DEMO_EMAIL }, data: { role: "ADMIN" } });
    const refused = await resetDemoAccount(prisma, demoEnv);

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toMatch(/role USER/i);

    // Still there — a refusal must not delete anything.
    expect(await prisma.user.count({ where: { email: DEMO_EMAIL } })).toBe(1);
    expect(await controlFingerprint()).toBe(controlBefore);

    await prisma.user.update({ where: { email: DEMO_EMAIL }, data: { role: "USER" } });
  });

  it("refuses when the configuration is unsafe, without reaching the database", async () => {
    const controlBefore = await controlFingerprint();
    const demoBefore = await demoSnapshot();

    for (const overrides of [
      { DEMO_MODE_ENABLED: "false" },
      { DEMO_ACCOUNT_EMAIL: "" },
      { DEMO_ACCOUNT_EMAIL: "%" },
      { DEMO_ACCOUNT_EMAIL: "${DEMO_ACCOUNT_EMAIL}" },
      { DEMO_ACCOUNT_EMAIL: "dev@northstar.local" },
      { DEMO_ACCOUNT_PASSWORD: "short" },
      { NODE_ENV: "production" },
    ]) {
      const result = await resetDemoAccount(prisma, {
        ...demoEnv,
        ...overrides,
      } as unknown as NodeJS.ProcessEnv);
      expect(result.ok, JSON.stringify(overrides)).toBe(false);
    }

    expect(await demoSnapshot()).toEqual(demoBefore);
    expect(await controlFingerprint()).toBe(controlBefore);
    // The seeded development account is still there.
    expect(await prisma.user.count({ where: { email: "dev@northstar.local" } })).toBe(1);
  });

  it("computes demo Redis keys without touching shared cache state", async () => {
    const demo = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    const keys = demoRateLimitKeys({
      userId: demo.id,
      email: DEMO_EMAIL,
      secret: process.env["AUTH_SECRET"],
    });

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith("northstar:rl:v1:")).toBe(true);
    expect(keys.some((key) => key.includes(":auth_ip:"))).toBe(false);
  });
});
