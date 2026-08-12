// @vitest-environment node
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { setStripeClientForTests } from "@/features/billing/stripe";
import {
  deriveProjection,
  fetchMatchingSubscriptions,
  lockCustomer,
  recordReconcileFailure,
  writeProjection,
} from "@/features/billing/reconcile";
import { barrier, FakeStripe } from "./helpers/fake-stripe";

/**
 * Webhook reconciliation under concurrency, against real PostgreSQL.
 *
 * Ordering is forced with explicit barriers rather than sleeps: a timing guess
 * makes a concurrency test pass or fail on machine speed, which is exactly the
 * kind of test that hides a race instead of catching one.
 *
 * These exercise the same functions the webhook route composes — the advisory
 * lock, the transactional event claim, and full-set reconciliation.
 */

const PRICE = "price_plus_test";

/** Yield to the event loop so a pending transaction can reach its next await. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
let fake: FakeStripe;
const createdUserIds: string[] = [];
const createdEventIds: string[] = [];

async function makeUserWithCustomer(): Promise<{ userId: string; customerId: string }> {
  const user = await prisma.user.create({
    data: { email: `wh-${randomUUID()}@northstar.test`, role: "USER" },
    select: { id: true },
  });
  createdUserIds.push(user.id);

  const customerId = `cus_wh${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await prisma.subscription.create({
    data: { userId: user.id, stripeCustomerId: customerId, plan: "FREE", status: "ACTIVE" },
  });
  return { userId: user.id, customerId };
}

beforeAll(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_0000000000000000000000000000";
  process.env["STRIPE_PLUS_PRICE_ID"] = PRICE;
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_0000000000000000";
});

beforeEach(() => {
  fake = new FakeStripe();
  setStripeClientForTests(fake.client);
});

afterEach(() => setStripeClientForTests(undefined));

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await prisma.processedWebhookEvent.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

/**
 * The route's critical section, isolated: lock, claim the event, read Stripe,
 * write the projection — all in one transaction.
 */
async function handleEvent(args: {
  eventId: string;
  userId: string;
  customerId: string;
}): Promise<"reconciled" | "duplicate"> {
  createdEventIds.push(args.eventId);

  return prisma.$transaction(
    async (tx) => {
      await lockCustomer(tx, args.customerId);

      try {
        await tx.processedWebhookEvent.create({
          data: { id: args.eventId, type: "customer.subscription.updated" },
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "P2002") return "duplicate" as const;
        throw error;
      }

      const fetched = await fetchMatchingSubscriptions(fake.client, {
        customerId: args.customerId,
        userId: args.userId,
        priceId: PRICE,
      });
      if (fetched.kind !== "ok") throw new Error("incomplete");

      await writeProjection(
        tx,
        args.userId,
        deriveProjection({ matching: fetched.matching }),
        new Date(),
      );
      return "reconciled" as const;
    },
    { timeout: 15_000, maxWait: 5_000 },
  );
}

// --- D2: ordering ---------------------------------------------------------

describe("D2: two events for one customer", () => {
  it("converges to Stripe's final state when the older read finishes last", async () => {
    const { userId, customerId } = await makeUserWithCustomer();
    const sub = fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
    });

    // Handler A's Stripe read is held open until B has already changed the
    // world. Without the advisory lock, A's stale "active" snapshot would be
    // written after B's correct "canceled" one.
    const gate = barrier();
    let released = false;
    fake.setOptions({
      beforeListReturns: async () => {
        if (released) return;
        released = true;
        await gate.wait;
      },
    });

    // A enters the lock and blocks inside its Stripe read.
    const a = handleEvent({ eventId: `evt_a_${randomUUID()}`, userId, customerId });
    await tick();

    // The world changes, and B starts *while A is still in flight*. Both are
    // now concurrent: the advisory lock is the only thing that can order them.
    fake.setSubscriptionStatus(sub.id, "canceled");
    const b = handleEvent({ eventId: `evt_b_${randomUUID()}`, userId, customerId });
    await tick();

    // Now let A's stale "active" read return. Without the lock, B has already
    // written FREE and A's older snapshot lands on top of it as PLUS.
    gate.release();
    await Promise.all([a, b]);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("FREE");
    expect(row.entitledCount).toBe(0);
  });

  it("lets two different customers reconcile at the same time", async () => {
    const first = await makeUserWithCustomer();
    const second = await makeUserWithCustomer();

    fake.addSubscription({
      customer: first.customerId,
      status: "active",
      priceId: PRICE,
      userId: first.userId,
    });
    fake.addSubscription({
      customer: second.customerId,
      status: "active",
      priceId: PRICE,
      userId: second.userId,
    });

    // Both hold their own per-customer lock; neither blocks the other.
    await Promise.all([
      handleEvent({ eventId: `evt_1_${randomUUID()}`, ...first }),
      handleEvent({ eventId: `evt_2_${randomUUID()}`, ...second }),
    ]);

    for (const { userId } of [first, second]) {
      const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
      expect(row.plan).toBe("PLUS");
    }
  });
});

// --- D3: same event, concurrently -----------------------------------------

describe("D3: the same event delivered twice at once", () => {
  it("commits exactly one event row and one projection effect", async () => {
    const { userId, customerId } = await makeUserWithCustomer();
    fake.addSubscription({ customer: customerId, status: "active", priceId: PRICE, userId });

    const eventId = `evt_same_${randomUUID()}`;

    // The first delivery claims the event and then stalls *inside its
    // transaction*, so the second delivery genuinely races the claim rather
    // than arriving after it has already committed.
    const gate = barrier();
    let stalled = false;
    fake.setOptions({
      beforeListReturns: async () => {
        if (stalled) return;
        stalled = true;
        await gate.wait;
      },
    });

    const first = handleEvent({ eventId, userId, customerId });
    await tick();

    const second = handleEvent({ eventId, userId, customerId });
    await tick();

    gate.release();
    const [a, b] = await Promise.all([first, second]);
    const [firstResult, secondResult] = [a, b];

    // Both callers succeed — neither is an error the sender must retry.
    const outcomes = [firstResult, secondResult].sort();
    expect(outcomes).toEqual(["duplicate", "reconciled"]);

    const rows = await prisma.processedWebhookEvent.count({ where: { id: eventId } });
    expect(rows).toBe(1);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("PLUS");
    expect(row.entitledCount).toBe(1);
  });
});

// --- failure handling -----------------------------------------------------

describe("reconciliation failure", () => {
  it("leaves no processed-event row and no projection change, so the event is retryable", async () => {
    const { userId, customerId } = await makeUserWithCustomer();
    fake.addSubscription({ customer: customerId, status: "active", priceId: PRICE, userId });

    const before = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    const eventId = `evt_fail_${randomUUID()}`;

    // A truncated Stripe read must roll the whole transaction back.
    fake.setOptions({ subscriptionListIncomplete: true });
    await expect(handleEvent({ eventId, userId, customerId })).rejects.toThrow();

    expect(await prisma.processedWebhookEvent.count({ where: { id: eventId } })).toBe(0);

    const after = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(after.plan).toBe(before.plan);
    expect(after.entitledCount).toBe(before.entitledCount);
    expect(after.reconciledAt).toBeNull();
  });

  it("records failure metadata in a separate transaction that survives the rollback", async () => {
    const { userId, customerId } = await makeUserWithCustomer();
    fake.addSubscription({ customer: customerId, status: "active", priceId: PRICE, userId });

    fake.setOptions({ subscriptionListIncomplete: true });
    await expect(
      handleEvent({ eventId: `evt_meta_${randomUUID()}`, userId, customerId }),
    ).rejects.toThrow();

    // Written after the rollback — anything inside the failed transaction would
    // have rolled back with it, recording nothing at all.
    await recordReconcileFailure(userId);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.reconcileFailureCount).toBe(1);
    expect(row.reconcileFailedAt).not.toBeNull();
    // And the correctness state is still untouched.
    expect(row.reconciledAt).toBeNull();
  });
});

// --- D2: cancellation semantics -------------------------------------------

describe("D2: cancellation", () => {
  it("retains PLUS when one of two entitled subscriptions is cancelled", async () => {
    const { userId, customerId } = await makeUserWithCustomer();
    const first = fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
      created: 10,
    });
    fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
      created: 20,
    });

    await handleEvent({ eventId: `evt_c1_${randomUUID()}`, userId, customerId });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { userId } })).entitledCount).toBe(
      2,
    );

    fake.setSubscriptionStatus(first.id, "canceled");
    await handleEvent({ eventId: `evt_c2_${randomUUID()}`, userId, customerId });

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("PLUS");
    expect(row.entitledCount).toBe(1);
  });

  it("produces FREE when the last entitled subscription is cancelled", async () => {
    const { userId, customerId } = await makeUserWithCustomer();
    const only = fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
    });

    await handleEvent({ eventId: `evt_d1_${randomUUID()}`, userId, customerId });
    fake.setSubscriptionStatus(only.id, "canceled");
    await handleEvent({ eventId: `evt_d2_${randomUUID()}`, userId, customerId });

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("FREE");
    expect(row.entitledCount).toBe(0);
  });

  it("keeps PLUS while cancel_at_period_end is set but the status is still active", async () => {
    const { userId, customerId } = await makeUserWithCustomer();
    fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
      cancelAtPeriodEnd: true,
    });

    await handleEvent({ eventId: `evt_e_${randomUUID()}`, userId, customerId });

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("PLUS");
    expect(row.cancelAtPeriodEnd).toBe(true);
  });
});

// --- isolation ------------------------------------------------------------

describe("isolation", () => {
  it("never touches seeded accounts", async () => {
    const seeded = await prisma.subscription.count({
      where: { user: { email: { endsWith: "@northstar.local" } } },
    });
    expect(seeded).toBe(0);
  });
});
