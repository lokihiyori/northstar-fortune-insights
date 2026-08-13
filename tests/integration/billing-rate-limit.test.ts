// @vitest-environment node
import "dotenv/config";

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { setStripeClientForTests } from "@/features/billing/stripe";
import { runCheckoutFlow } from "@/features/billing/checkout-flow";
import { policy } from "@/lib/rate-limit/policies";
import { rateLimitKey } from "@/lib/rate-limit/limiter";
import { releaseReservation, reserve } from "@/lib/rate-limit/enforce";
import { FakeStripe } from "./helpers/fake-stripe";

/**
 * The billing attempt limit against real Redis.
 *
 * The point of these is *where* the limiter sits, not what it counts. Redis is
 * defence in depth here — PostgreSQL's unique index is what prevents duplicates
 * — so an outage must be able to stop a **new** attempt without stranding a user
 * halfway through a checkout they already started.
 */

const PRICE = "price_plus_test";
const APP_URL = "http://localhost:3000";
const POLICY = policy("BILLING_ATTEMPT_USER");

let fake: FakeStripe;
let redis: Redis;
const createdUserIds: string[] = [];
const createdKeys = new Set<string>();

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `rl-${randomUUID()}@northstar.test`, role: "USER" },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  createdKeys.add(rateLimitKey(POLICY.id, user.id));
  return user.id;
}

beforeAll(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_0000000000000000000000000000";
  process.env["STRIPE_PLUS_PRICE_ID"] = PRICE;
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_0000000000000000";
  process.env["NEXT_PUBLIC_APP_URL"] = APP_URL;

  const url = process.env["REDIS_URL"];
  if (!url) throw new Error("REDIS_URL is not set. Start the stack with `pnpm db:up`.");
  redis = new Redis(url);
});

/**
 * The application's Redis client sets `enableOfflineQueue: false`, so a command
 * issued while the socket is still connecting is rejected rather than queued.
 * That is correct for production — it turns an outage into a fast refusal
 * instead of latency — but in a test it looks like an outage on the first call.
 * Waiting for `ready` here measures the policy, not the connect window.
 */
beforeAll(async () => {
  const { getRedis } = await import("@/lib/redis/client");
  const client = getRedis();
  if (client && client.status !== "ready") {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 5_000);
      client.once("ready", done);
    });
  }
});

beforeEach(() => {
  fake = new FakeStripe();
  setStripeClientForTests(fake.client);
});

afterEach(() => setStripeClientForTests(undefined));

afterAll(async () => {
  // Only keys and rows this suite created.
  for (const key of createdKeys) await redis.del(key);
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await redis.quit();
  await prisma.$disconnect();
});

/** Counts how often the flow asks to charge a genuinely new attempt. */
function countingFlow(userId: string, now?: Date) {
  let charged = 0;
  const run = runCheckoutFlow({
    userId,
    mayClaim: true,
    appUrl: APP_URL,
    ...(now ? { now } : {}),
    onNewAttempt: async () => {
      charged += 1;
      return null;
    },
  });
  return { run, charged: () => charged };
}

describe("where the limiter sits", () => {
  it("charges exactly one unit for a genuinely new attempt", async () => {
    const userId = await makeUser();
    const { run, charged } = countingFlow(userId);
    expect((await run).kind).toBe("session");
    expect(charged()).toBe(1);
  });

  it("does not charge when an existing open Session is reused", async () => {
    const userId = await makeUser();
    await countingFlow(userId).run;

    const second = countingFlow(userId);
    expect((await second.run).kind).toBe("session");
    expect(second.charged()).toBe(0);
  });

  it("does not charge when recovering a PENDING attempt after a crash", async () => {
    const userId = await makeUser();
    fake.setOptions({ sessionCreateThrows: true });
    await countingFlow(userId).run;

    const recovery = countingFlow(userId, new Date(Date.now() + 60_000));
    await recovery.run;
    expect(recovery.charged()).toBe(0);
  });

  it("does not charge the continue path, which may not claim at all", async () => {
    const userId = await makeUser();
    await countingFlow(userId).run;

    let charged = 0;
    await runCheckoutFlow({
      userId,
      mayClaim: false,
      appUrl: APP_URL,
      onNewAttempt: async () => {
        charged += 1;
        return null;
      },
    });

    expect(charged).toBe(0);
  });
});

describe("the policy against real Redis", () => {
  it("admits five attempts in a window and refuses the sixth", async () => {
    const userId = await makeUser();
    const context = { headers: new Headers(), userId };

    for (let i = 0; i < POLICY.limit; i += 1) {
      const outcome = await reserve("billingAttempt", context);
      expect(outcome.kind, `attempt ${String(i + 1)}`).toBe("allow");
    }

    const sixth = await reserve("billingAttempt", context);
    expect(sixth.kind).toBe("limit");
  });

  it("refunds the unit when a reservation is released", async () => {
    const userId = await makeUser();
    const context = { headers: new Headers(), userId };

    // Fill the window, then give one back.
    const held = [];
    for (let i = 0; i < POLICY.limit; i += 1) {
      const outcome = await reserve("billingAttempt", context);
      if (outcome.kind === "allow") held.push(outcome.reservation);
    }
    expect((await reserve("billingAttempt", context)).kind).toBe("limit");

    await releaseReservation(held[0]!);

    // The refunded slot is usable again — an outage or a lost claim race must
    // not burn an hour of a legitimate user's budget.
    expect((await reserve("billingAttempt", context)).kind).toBe("allow");
  });

  it("counts each user separately", async () => {
    const first = await makeUser();
    const second = await makeUser();

    for (let i = 0; i < POLICY.limit; i += 1) {
      await reserve("billingAttempt", { headers: new Headers(), userId: first });
    }

    expect((await reserve("billingAttempt", { headers: new Headers(), userId: first })).kind).toBe(
      "limit",
    );
    expect((await reserve("billingAttempt", { headers: new Headers(), userId: second })).kind).toBe(
      "allow",
    );
  });

  it("stores nothing readable: the key is a policy id and an opaque user id", async () => {
    const userId = await makeUser();
    await reserve("billingAttempt", { headers: new Headers(), userId });

    const key = rateLimitKey(POLICY.id, userId);
    expect(key).toContain("northstar:rl:v1:billing_attempt_user");
    expect(key).not.toContain("@");

    const value = await redis.get(key);
    expect(value).toMatch(/^\d+$/);
  });
});

describe("Redis unavailable", () => {
  it("refuses a genuinely new attempt but never creates anything", async () => {
    const userId = await makeUser();

    // The route maps a fail-closed unavailable decision to 503 and creates
    // nothing. Simulated here by refusing at the same point the route does.
    const result = await runCheckoutFlow({
      userId,
      mayClaim: true,
      appUrl: APP_URL,
      onNewAttempt: async () => ({ kind: "unavailable" }),
    });

    expect(result.kind).toBe("unavailable");
    expect(fake.customerCreateCalls).toBe(0);
    expect(fake.sessionCreateCalls).toBe(0);
    expect(await prisma.checkoutAttempt.count({ where: { userId } })).toBe(0);
  });

  it("still allows recovery of an already persisted attempt", async () => {
    const userId = await makeUser();
    fake.setOptions({ sessionCreateThrows: true });
    await countingFlow(userId).run;
    expect(await prisma.checkoutAttempt.count({ where: { userId } })).toBe(1);

    // The limiter would refuse a new attempt, but recovery never asks it.
    const recovery = await runCheckoutFlow({
      userId,
      mayClaim: true,
      appUrl: APP_URL,
      now: new Date(Date.now() + 60_000),
      onNewAttempt: async () => ({ kind: "unavailable" }),
    });

    expect(recovery.kind).toBe("session");
    expect(await prisma.checkoutAttempt.count({ where: { userId } })).toBe(1);
  });

  it("still allows the continue path to validate an open Session", async () => {
    const userId = await makeUser();
    await countingFlow(userId).run;

    const result = await runCheckoutFlow({
      userId,
      mayClaim: false,
      appUrl: APP_URL,
      onNewAttempt: async () => ({ kind: "unavailable" }),
    });

    expect(result.kind).toBe("session");
  });
});
