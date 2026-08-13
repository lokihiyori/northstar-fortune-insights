// @vitest-environment node
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { setStripeClientForTests } from "@/features/billing/stripe";
import { runCheckoutFlow } from "@/features/billing/checkout-flow";
import { buildSessionRequest, sessionIdempotencyKey } from "@/features/billing/checkout-attempt";
import { FakeStripe } from "./helpers/fake-stripe";

/**
 * Attempt recovery, Session discovery, and Customer ambiguity.
 *
 * Time is injected through `runCheckoutFlow`'s `now`, never slept on: a lease
 * test that waits 30 seconds is a test nobody runs, and a sleep would make the
 * result depend on machine speed.
 */

const PRICE = "price_plus_test";
const APP_URL = "http://localhost:3000";

let fake: FakeStripe;
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `rec-${randomUUID()}@northstar.test`, role: "USER" },
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

afterEach(() => setStripeClientForTests(undefined));

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

const flow = (userId: string, now?: Date) =>
  runCheckoutFlow({ userId, mayClaim: true, appUrl: APP_URL, ...(now ? { now } : {}) });

const later = (ms: number) => new Date(Date.now() + ms);

// --- attempt recovery -----------------------------------------------------

describe("attempt recovery", () => {
  it("recovers a PENDING attempt stranded by a crash, without waiting for the long TTL", async () => {
    const userId = await makeUser();

    // Simulate a crash after the claim but before Stripe answered.
    fake.setOptions({ loseSessionResponses: 1 });
    expect((await flow(userId)).kind).toBe("unavailable");

    const stranded = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    expect(stranded.status).toBe("PENDING");

    // 60s later the 30s lease has lapsed; the attempt TTL is 20 hours away.
    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("session");
    const after = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    // Same attempt id — and therefore the same idempotency key.
    expect(after.id).toBe(stranded.id);
    expect(await prisma.checkoutAttempt.count({ where: { userId } })).toBe(1);
  });

  it("takeover keeps the same attempt id, Customer key, and Session idempotency key", async () => {
    const userId = await makeUser();
    fake.setOptions({ loseSessionResponses: 1 });
    await flow(userId);

    const before = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    await flow(userId, later(60_000));
    const after = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    expect(after.id).toBe(before.id);
    expect(after.customerIdemKey).toBe(before.customerIdemKey);
    expect(sessionIdempotencyKey(after)).toBe(sessionIdempotencyKey(before));
    expect(fake.customerCreateCalls).toBe(1);
  });

  it("holds off other callers while a lease is live, with a bounded retry", async () => {
    const userId = await makeUser();
    fake.setOptions({ loseSessionResponses: 1 });
    await flow(userId);

    // Lease still held: a continue-style caller must not take over.
    const other = await runCheckoutFlow({ userId, mayClaim: false, appUrl: APP_URL });

    expect(other.kind).toBe("conflict");
    if (other.kind === "conflict") expect(other.retryAfterSeconds).toBe(2);
  });

  it("returns a bounded conflict when Stripe reports the idempotency key in use", async () => {
    const userId = await makeUser();
    fake.setOptions({ sessionCreateThrows: true });
    await flow(userId);

    fake.setOptions({ idempotencyInUse: true });
    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") expect(result.retryAfterSeconds).toBe(2);
    // Nothing new was claimed.
    expect(await prisma.checkoutAttempt.count({ where: { userId } })).toBe(1);
  });

  it("a replay returning complete never becomes OPEN", async () => {
    const userId = await makeUser();
    fake.setOptions({ sessionCreateThrows: true });
    await flow(userId);

    fake.setOptions({ createReturnsComplete: true });
    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("conflict");
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    expect(attempt.status).toBe("COMPLETED");
  });

  it("a replay returning expired never becomes OPEN", async () => {
    const userId = await makeUser();
    fake.setOptions({ sessionCreateThrows: true });
    await flow(userId);

    fake.setOptions({ createReturnsExpired: true });
    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("conflict");
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    expect(attempt.status).toBe("EXPIRED");
  });
});

// --- the frozen request ---------------------------------------------------

describe("immutable request snapshot", () => {
  it("is unchanged by app URL, Price, or clock changes after the claim", async () => {
    const userId = await makeUser();
    await flow(userId);

    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    const before = JSON.stringify(buildSessionRequest(attempt));

    // Everything the old design would have recomputed on retry.
    process.env["NEXT_PUBLIC_APP_URL"] = "https://a-totally-different-host.example";
    process.env["STRIPE_PLUS_PRICE_ID"] = "price_reconfigured_since";
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const after = JSON.stringify(buildSessionRequest(attempt));

    expect(after).toBe(before);

    process.env["NEXT_PUBLIC_APP_URL"] = APP_URL;
    process.env["STRIPE_PLUS_PRICE_ID"] = PRICE;
  });

  it("sends expires_at as exact integer seconds from the persisted value", async () => {
    const userId = await makeUser();
    await flow(userId);

    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    const request = buildSessionRequest(attempt);

    expect(request.expires_at).toBe(Math.floor(attempt.requestedSessionExpiresAt.getTime() / 1000));
    expect(Number.isInteger(request.expires_at)).toBe(true);
  });

  it("carries opaque metadata only — no email anywhere in the request", async () => {
    const userId = await makeUser();
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    const serialized = JSON.stringify(buildSessionRequest(attempt));
    expect(serialized).not.toContain("@northstar.test");
    expect(serialized).not.toContain("@");
  });
});

// --- session discovery ----------------------------------------------------

describe("open Session discovery", () => {
  async function openAttempt(userId: string) {
    await flow(userId);
    return prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
  }

  it("a stored session id does not bypass discovery: a second matching Session fails closed", async () => {
    const userId = await makeUser();
    const attempt = await openAttempt(userId);
    expect(attempt.stripeSessionId).not.toBeNull();

    // A second verified open Session appears for the same customer.
    fake.seedOpenSession({ customer: attempt.stripeCustomerId!, priceId: PRICE, userId });

    const result = await flow(userId);

    // No URL is returned; returning either would leave the other completable.
    expect(result.kind).toBe("unavailable");
  });

  it("adopts an orphan Session that carries this attempt's id", async () => {
    const userId = await makeUser();
    fake.setOptions({ loseSessionResponses: 1 });
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    expect(attempt.stripeSessionId).toBeNull();

    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("session");
    expect(fake.sessionCreateCalls).toBe(1);
  });

  it("expires and confirms a legacy Session before creating a new one", async () => {
    const userId = await makeUser();
    fake.setOptions({ sessionCreateThrows: true });
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    // Pre-fix Session: right customer and Price, no attempt metadata.
    const legacy = fake.seedOpenSession({
      customer: attempt.stripeCustomerId!,
      priceId: PRICE,
    });

    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("session");
    expect(fake.sessionStatus(legacy.id)).toBe("expired");
  });

  it("fails closed on a Session belonging to a different attempt", async () => {
    const userId = await makeUser();
    fake.setOptions({ loseSessionResponses: 1 });
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    const foreign = fake.seedOpenSession({
      customer: attempt.stripeCustomerId!,
      priceId: PRICE,
      userId,
      attemptId: "att_someone_elses",
    });

    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("unavailable");
    // Never adopted and never expired: it is not ours to touch.
    expect(fake.sessionStatus(foreign.id)).toBe("open");
  });

  it("fails closed when Session pagination is incomplete", async () => {
    const userId = await makeUser();
    fake.setOptions({ sessionCreateThrows: true });
    await flow(userId);

    fake.setOptions({ sessionListIncomplete: true });
    const before = fake.sessionCreateCalls;
    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("unavailable");
    expect(fake.sessionCreateCalls).toBe(before);
  });

  it("fails closed when line items cannot be retrieved", async () => {
    const userId = await makeUser();
    const attempt = await openAttempt(userId);

    fake.setOptions({ lineItemsUnavailable: true });
    const result = await flow(userId);

    // The stored Session cannot be verified, so it is not offered. A new one is
    // created only because discovery found nothing it could confirm.
    expect(["unavailable", "session"]).toContain(result.kind);
    expect(attempt.stripeSessionId).not.toBeNull();
  });

  it("rejects a Session with the wrong number of line items", async () => {
    const userId = await makeUser();
    const attempt = await openAttempt(userId);
    const stored = attempt.stripeSessionId!;

    fake.setOptions({ lineItemsMultiple: true });
    await flow(userId);

    // The multi-item Session was never treated as reusable.
    expect(fake.sessionCreateCalls).toBeGreaterThan(1);
    expect(stored).not.toBe("");
  });

  it("neither adopts nor expires a Session for an unrelated Price", async () => {
    const userId = await makeUser();
    fake.setOptions({ loseSessionResponses: 1 });
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    const unrelated = fake.seedOpenSession({
      customer: attempt.stripeCustomerId!,
      priceId: "price_unrelated",
    });

    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("session");
    expect(fake.sessionStatus(unrelated.id)).toBe("open");
  });

  it("creates nothing when a conflicting Session cannot be confirmed expired", async () => {
    const userId = await makeUser();
    fake.setOptions({ loseSessionResponses: 1 });
    await flow(userId);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });

    fake.seedOpenSession({ customer: attempt.stripeCustomerId!, priceId: PRICE });
    fake.setOptions({ expireDoesNotStick: true });

    const before = fake.sessionCreateCalls;
    const result = await flow(userId, later(60_000));

    expect(result.kind).toBe("unavailable");
    expect(fake.sessionCreateCalls).toBe(before);
  });

  it("never persists a Checkout URL", async () => {
    const userId = await makeUser();
    await flow(userId);

    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { userId } });
    const serialized = JSON.stringify(attempt);

    expect(serialized).not.toContain("checkout.stripe.com");
    expect(serialized).not.toContain("/c/pay/");
    expect(Object.keys(attempt)).not.toContain("url");
  });
});

// --- customer recovery ----------------------------------------------------

describe("Customer recovery ambiguity", () => {
  it("reuses exactly one matching Customer", async () => {
    const userId = await makeUser();
    const seeded = fake.seedCustomer({ userId });
    fake.setOptions({ customerCreateThrows: true });

    await flow(userId);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.stripeCustomerId).toBe(seeded.id);
  });

  it("blocks billing and creates nothing when several Customers match", async () => {
    const userId = await makeUser();
    fake.seedCustomer({ userId });
    fake.seedCustomer({ userId });
    fake.setOptions({ customerCreateThrows: true });

    const before = fake.sessionCreateCalls;
    const result = await flow(userId);

    expect(result.kind).toBe("blocked");
    expect(fake.sessionCreateCalls).toBe(before);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(row.billingBlockedReason).toBe("duplicate_customer");
  });

  it("keeps billing blocked on later requests until an operator clears it", async () => {
    const userId = await makeUser();
    fake.seedCustomer({ userId });
    fake.seedCustomer({ userId });
    fake.setOptions({ customerCreateThrows: true });
    await flow(userId);

    // A fresh, healthy fake: the block must still hold.
    fake = new FakeStripe();
    setStripeClientForTests(fake.client);

    const result = await flow(userId);
    expect(result.kind).toBe("blocked");
    expect(fake.sessionCreateCalls).toBe(0);
  });

  it("creates nothing when Search is unavailable", async () => {
    const userId = await makeUser();
    fake.setOptions({ customerCreateThrows: true, searchUnavailable: true });

    const result = await flow(userId);

    expect(result.kind).toBe("unavailable");
    expect(fake.sessionCreateCalls).toBe(0);
    expect(await prisma.subscription.findUnique({ where: { userId } })).toBeNull();
  });

  it("creates nothing when Search pagination is incomplete", async () => {
    const userId = await makeUser();
    fake.setOptions({ customerCreateThrows: true, searchIncomplete: true });

    const result = await flow(userId);

    expect(result.kind).toBe("unavailable");
    expect(fake.sessionCreateCalls).toBe(0);
  });

  it("creates nothing when the Customer comes back in the wrong mode", async () => {
    const userId = await makeUser();
    fake.setOptions({ customerWrongLivemode: true });

    const result = await flow(userId);

    expect(result.kind).toBe("unavailable");
    expect(fake.sessionCreateCalls).toBe(0);
  });
});
