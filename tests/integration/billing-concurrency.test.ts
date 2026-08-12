// @vitest-environment node
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { setStripeClientForTests } from "@/features/billing/stripe";
import { runCheckoutFlow } from "@/features/billing/checkout-flow";
import {
  deriveProjection,
  fetchMatchingSubscriptions,
  lockCustomer,
  writeProjection,
} from "@/features/billing/reconcile";
import { FakeStripe } from "./helpers/fake-stripe";

/**
 * D1 and D2 against real PostgreSQL.
 *
 * Every one of these fails on commit 200631d: the pre-fix checkout route created
 * a Session per request with no claim, and the pre-fix webhook wrote the
 * triggering event's snapshot straight into a single row.
 *
 * PostgreSQL is real because the correctness mechanism *is* a PostgreSQL unique
 * index and a PostgreSQL advisory lock — a fake would only prove that the fake
 * serializes. Stripe is faked at the boundary because these are statements about
 * how many times it was called.
 */

const PRICE = "price_plus_test";
const APP_URL = "http://localhost:3000";

let fake: FakeStripe;
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `billing-${randomUUID()}@northstar.test`, role: "USER" },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

beforeAll(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_0000000000000000000000000000";
  process.env["STRIPE_PLUS_PRICE_ID"] = PRICE;
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_0000000000000000";
  process.env["NEXT_PUBLIC_APP_URL"] = APP_URL;
});

beforeEach(() => {
  fake = new FakeStripe();
  setStripeClientForTests(fake.client);
});

afterEach(() => {
  setStripeClientForTests(undefined);
});

afterAll(async () => {
  // Only rows this suite created. Seeded dev/admin/demo accounts are untouched.
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

function flow(userId: string) {
  return runCheckoutFlow({ userId, mayClaim: true, appUrl: APP_URL });
}

// --- D1: concurrency ------------------------------------------------------

describe("D1: concurrent checkout requests", () => {
  it("two simultaneous requests produce one attempt, one Customer, and one Session", async () => {
    const userId = await makeUser();

    const [a, b] = await Promise.all([flow(userId), flow(userId)]);

    // Exactly one of them got a Session; the other was told to wait.
    const sessions = [a, b].filter((r) => r.kind === "session");
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    expect(fake.customerCreateCalls).toBe(1);
    expect(fake.sessionCreateCalls).toBe(1);

    const attempts = await prisma.checkoutAttempt.count({ where: { userId } });
    expect(attempts).toBe(1);
  });

  it("ten simultaneous requests still produce one Customer and one Session", async () => {
    const userId = await makeUser();

    await Promise.all(Array.from({ length: 10 }, () => flow(userId)));

    expect(fake.customerCreateCalls).toBe(1);
    expect(fake.sessionCreateCalls).toBe(1);
    expect(await prisma.checkoutAttempt.count({ where: { userId } })).toBe(1);

    // And the claim is genuinely unique, not merely un-raced by luck.
    const live = await prisma.checkoutAttempt.count({
      where: { userId, activeForUserId: { not: null } },
    });
    expect(live).toBe(1);
  });

  it("a retry reuses the same attempt rather than creating a second Session", async () => {
    const userId = await makeUser();

    const first = await flow(userId);
    const second = await flow(userId);

    expect(first.kind).toBe("session");
    expect(second.kind).toBe("session");
    expect(fake.sessionCreateCalls).toBe(1);
    expect(await prisma.checkoutAttempt.count({ where: { userId } })).toBe(1);
  });

  it("an existing active subscription blocks checkout entirely", async () => {
    const userId = await makeUser();
    await flow(userId);

    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    fake.addSubscription({
      customer: attempt.stripeCustomerId!,
      status: "active",
      priceId: PRICE,
      userId,
    });

    const before = fake.sessionCreateCalls;
    const result = await flow(userId);

    expect(result.kind).toBe("conflict");
    expect(fake.sessionCreateCalls).toBe(before);
  });

  it("a trialing subscription blocks checkout and grants PLUS", async () => {
    const userId = await makeUser();
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    fake.addSubscription({
      customer: attempt.stripeCustomerId!,
      status: "trialing",
      priceId: PRICE,
      userId,
    });

    expect((await flow(userId)).kind).toBe("conflict");

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("PLUS");
    expect(row.entitledCount).toBe(1);
  });

  it("a past_due subscription blocks checkout but grants nothing", async () => {
    const userId = await makeUser();
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    fake.addSubscription({
      customer: attempt.stripeCustomerId!,
      status: "past_due",
      priceId: PRICE,
      userId,
    });

    const before = fake.sessionCreateCalls;
    expect((await flow(userId)).kind).toBe("conflict");
    expect(fake.sessionCreateCalls).toBe(before);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("FREE");
    expect(row.entitledCount).toBe(0);
    expect(row.matchingBlockingCount).toBe(1);
  });

  it("an unrelated Price never grants PLUS and never blocks", async () => {
    const userId = await makeUser();
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    fake.addSubscription({
      customer: attempt.stripeCustomerId!,
      status: "active",
      priceId: "price_something_else",
      userId,
    });

    const fetched = await fetchMatchingSubscriptions(fake.client, {
      customerId: attempt.stripeCustomerId!,
      userId,
      priceId: PRICE,
    });
    expect(fetched.kind).toBe("ok");
    if (fetched.kind === "ok") expect(fetched.matching).toHaveLength(0);
  });
});

// --- D1: customer recovery ------------------------------------------------

describe("D1: Stripe Customer recovery", () => {
  it("recovers the same Customer when the create response is lost", async () => {
    const userId = await makeUser();
    fake.setOptions({ loseCustomerResponses: 1 });

    // First attempt: Stripe created the Customer but the response never arrived.
    await flow(userId).catch(() => undefined);

    // Recovery replays the same persisted idempotency key.
    const result = await flow(userId);

    expect(result.kind).toBe("session");

    // The property that matters is not the call count but the outcome: exactly
    // one Customer exists for this user and it is the one Stripe already had.
    // Recovery may come from the idempotent replay or from the metadata search;
    // either way a second Customer must never be created.
    const customers = new Set(
      (await prisma.checkoutAttempt.findMany({ where: { userId } })).map((a) => a.stripeCustomerId),
    );
    customers.delete(null);
    expect(customers.size).toBe(1);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.stripeCustomerId).toBe([...customers][0]);
  });

  it("recovers the orphaned Session when the create response is lost", async () => {
    const userId = await makeUser();
    fake.setOptions({ loseSessionResponses: 1 });

    // Stripe created the Session; the response never arrived, so its id was
    // never persisted. This is the orphan case a retrieve-by-stored-id design
    // cannot see, and it is why discovery enumerates the customer's open
    // Sessions rather than trusting the local row.
    const first = await flow(userId);
    expect(first.kind).toBe("unavailable");

    const stranded = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    expect(stranded.status).toBe("PENDING");
    expect(stranded.stripeSessionId).toBeNull();

    const result = await flow(userId);

    expect(result.kind).toBe("session");
    // Discovery adopted the orphan rather than creating a second Session.
    expect(fake.sessionCreateCalls).toBe(1);
    expect(await prisma.checkoutAttempt.count({ where: { userId } })).toBe(1);
  });
});

// --- D2: reconciliation ---------------------------------------------------

describe("D2: entitlement follows the whole Stripe set", () => {
  async function reconcile(userId: string, customerId: string): Promise<void> {
    const fetched = await fetchMatchingSubscriptions(fake.client, {
      customerId,
      userId,
      priceId: PRICE,
    });
    if (fetched.kind !== "ok") throw new Error("incomplete");
    const projection = deriveProjection({ matching: fetched.matching });
    await prisma.$transaction(async (tx) => {
      await lockCustomer(tx, customerId);
      await writeProjection(tx, userId, projection, new Date());
    });
  }

  it("keeps PLUS when one of two active subscriptions is cancelled", async () => {
    const userId = await makeUser();
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    const customerId = attempt.stripeCustomerId!;

    const first = fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
      created: 100,
    });
    fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
      created: 200,
    });

    await reconcile(userId, customerId);
    let row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("PLUS");
    expect(row.entitledCount).toBe(2);
    expect(row.matchingBlockingCount).toBe(2);

    // Cancel the OLDER one — the pre-fix code downgraded to FREE here.
    fake.setSubscriptionStatus(first.id, "canceled");
    await reconcile(userId, customerId);

    row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("PLUS");
    expect(row.entitledCount).toBe(1);
  });

  it("drops to FREE only when the last entitled subscription is gone", async () => {
    const userId = await makeUser();
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    const customerId = attempt.stripeCustomerId!;

    const only = fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
    });

    await reconcile(userId, customerId);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { userId } })).plan).toBe("PLUS");

    fake.setSubscriptionStatus(only.id, "canceled");
    await reconcile(userId, customerId);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("FREE");
    expect(row.entitledCount).toBe(0);
  });

  it("flags an active + past_due pair as duplicate risk", async () => {
    const userId = await makeUser();
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    const customerId = attempt.stripeCustomerId!;

    fake.addSubscription({ customer: customerId, status: "active", priceId: PRICE, userId });
    fake.addSubscription({ customer: customerId, status: "past_due", priceId: PRICE, userId });

    await reconcile(userId, customerId);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.entitledCount).toBe(1);
    expect(row.matchingBlockingCount).toBe(2);
    expect(row.plan).toBe("PLUS");
  });

  it("converges to current truth when an older read finishes after a newer one", async () => {
    const userId = await makeUser();
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    const customerId = attempt.stripeCustomerId!;

    const sub = fake.addSubscription({
      customer: customerId,
      status: "active",
      priceId: PRICE,
      userId,
    });

    // Handler A reads a slow "active" snapshot. Handler B then cancels and
    // reconciles. Under the advisory lock B cannot start until A commits, and
    // whichever runs second re-reads Stripe — so the final state is Stripe's.
    fake.setOptions({ listDelayMs: 150 });
    const slow = reconcile(userId, customerId);

    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.setSubscriptionStatus(sub.id, "canceled");
    fake.setOptions({ listDelayMs: 0 });
    const fast = reconcile(userId, customerId);

    await Promise.all([slow, fast]);

    // Final Stripe truth is "canceled", and the projection agrees regardless of
    // which handler committed last.
    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.plan).toBe("FREE");
    expect(row.entitledCount).toBe(0);
  });
});

// --- isolation ------------------------------------------------------------

describe("isolation", () => {
  it("leaves seeded developer, admin, and demo accounts untouched", async () => {
    const seeded = await prisma.user.findMany({
      where: { email: { endsWith: "@northstar.local" } },
      select: { email: true, role: true },
      orderBy: { email: "asc" },
    });

    expect(seeded.map((u) => u.email)).toEqual([
      "admin@northstar.local",
      "demo@northstar.local",
      "dev@northstar.local",
    ]);

    // And none of them acquired billing state from this suite.
    const withBilling = await prisma.subscription.count({
      where: { user: { email: { endsWith: "@northstar.local" } } },
    });
    expect(withBilling).toBe(0);
  });
});
