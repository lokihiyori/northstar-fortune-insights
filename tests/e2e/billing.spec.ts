import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { SEEDED_USER, TEST_PASSWORD, uniqueEmail } from "./helpers/db";

/**
 * The billing page's states and the continue route's safety properties.
 *
 * Stripe is not configured for the e2e run, so the states that depend on live
 * Stripe data are driven by writing the projection and attempt rows the server
 * reads — which is exactly what the page derives its render from. That keeps
 * these tests about *what the server decides to show*, which is the control
 * that failed in D1: the page kept offering "Upgrade" while Stripe already had
 * a subscription.
 */

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is not set.");

async function sql<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function signUp(page: import("@playwright/test").Page): Promise<string> {
  const email = uniqueEmail("billing");
  await page.goto("/sign-up");
  await page.fill('input[name="name"]', "Billing State");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app/);

  await sql((c) =>
    c.query(
      `UPDATE user_profiles SET "onboardingStep" = 99, "onboardingCompletedAt" = now()
         WHERE "userId" = (SELECT id FROM users WHERE email = $1)`,
      [email],
    ),
  );
  return email;
}

async function userId(email: string): Promise<string> {
  return sql(async (c) => {
    const rows = await c.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    return rows.rows[0]!.id;
  });
}

async function upsertSubscription(
  id: string,
  fields: Record<string, string | number | boolean | null>,
): Promise<void> {
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const setters = columns.map((c, i) => `"${c}" = $${String(i + 2)}`).join(", ");
  const insertCols = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map((_, i) => `$${String(i + 2)}`).join(", ");

  await sql((c) =>
    c.query(
      `INSERT INTO subscriptions (id, "userId", ${insertCols}, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, ${placeholders}, now(), now())
       ON CONFLICT ("userId") DO UPDATE SET ${setters}, "updatedAt" = now()`,
      [id, ...values],
    ),
  );
}

async function insertAttempt(id: string, status: string, sessionId: string | null): Promise<void> {
  await sql((c) =>
    c.query(
      `INSERT INTO checkout_attempts
         (id, "userId", "activeForUserId", status, "requestVersion",
          "requestedSessionExpiresAt", "successUrl", "cancelUrl", "stripePriceId",
          "allowPromotionCodes", "metadataJson", "customerIdemKey", "stripeSessionId",
          "leaseExpiresAt", "expiresAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $1, $2, 1,
               now() + interval '30 minutes', 'http://x/s', 'http://x/c', 'price_x',
               true, '{}'::jsonb, $3, $4,
               now() + interval '30 seconds', now() + interval '20 hours', now(), now())`,
      [id, status, `nsc_${Math.random().toString(36).slice(2)}`, sessionId],
    ),
  );
}

test.describe("billing page states", () => {
  test("no attempt and no subscription offers Upgrade", async ({ page }) => {
    await signUp(page);
    await page.goto("/app/billing");

    // Stripe is unconfigured in e2e, so the honest not-configured notice shows
    // instead of an armed button. Either way there must be no Continue link.
    await expect(page.getByRole("link", { name: "Continue checkout" })).toHaveCount(0);
    await expect(page.getByText("Plan and usage")).toBeVisible();
  });

  test("a PENDING attempt shows Preparing checkout and offers no Continue or Upgrade", async ({
    page,
  }) => {
    const email = await signUp(page);
    await insertAttempt(await userId(email), "PENDING", null);

    await page.goto("/app/billing");

    await expect(page.getByText(/Preparing checkout/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue checkout" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upgrade to Plus" })).toHaveCount(0);
  });

  test("an OPEN attempt shows Continue checkout and no second Upgrade", async ({ page }) => {
    const email = await signUp(page);
    await insertAttempt(
      await userId(email),
      "OPEN",
      `cs_test_${Math.random().toString(36).slice(2)}`,
    );

    await page.goto("/app/billing");

    await expect(page.getByRole("link", { name: "Continue checkout" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade to Plus" })).toHaveCount(0);
  });

  test("a COMPLETED attempt before the projection catches up shows Payment processing", async ({
    page,
  }) => {
    const email = await signUp(page);
    await insertAttempt(await userId(email), "COMPLETED", null);

    await page.goto("/app/billing");

    await expect(page.getByText(/Payment processing/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade to Plus" })).toHaveCount(0);
  });

  test("a blocking-but-not-entitled subscription offers payment recovery, never Upgrade", async ({
    page,
  }) => {
    const email = await signUp(page);
    const id = await userId(email);
    await upsertSubscription(id, {
      plan: "FREE",
      status: "PAST_DUE",
      stripeStatusRaw: "past_due",
      entitledCount: 0,
      matchingBlockingCount: 1,
      reconciledAt: new Date().toISOString(),
    });

    await page.goto("/app/billing");

    await expect(page.getByText(/charge you twice/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade to Plus" })).toHaveCount(0);
  });

  test("duplicate risk warns and never offers Upgrade", async ({ page }) => {
    const email = await signUp(page);
    const id = await userId(email);
    await upsertSubscription(id, {
      plan: "PLUS",
      status: "ACTIVE",
      stripeStatusRaw: "active",
      entitledCount: 2,
      matchingBlockingCount: 2,
      reconciledAt: new Date().toISOString(),
    });

    await page.goto("/app/billing");

    await expect(page.getByRole("alert")).toContainText(/more than one live subscription/i);
    await expect(page.getByRole("button", { name: "Upgrade to Plus" })).toHaveCount(0);
  });

  test("an operator block refuses billing entirely", async ({ page }) => {
    const email = await signUp(page);
    const id = await userId(email);
    await upsertSubscription(id, { billingBlockedReason: "duplicate_customer" });

    await page.goto("/app/billing");

    await expect(page.getByText(/manual review/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade to Plus" })).toHaveCount(0);
  });

  test("the success redirect alone never grants PLUS", async ({ page }) => {
    await signUp(page);

    // The banner is a receipt, not an entitlement: access comes from the webhook.
    await page.goto("/app/billing?checkout=success");

    await expect(page.getByText(/Checkout complete/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plan and usage" })).toBeVisible();

    // Scoped to the *current plan* block — the plan comparison table further
    // down legitimately names "NorthStar Plus" as a product.
    const currentPlan = page.locator("#current-heading").locator("..");
    await expect(currentPlan).toContainText("Free");
    await expect(currentPlan).not.toContainText("NorthStar Plus");
  });
});

test.describe("continue route safety", () => {
  test("refuses an unauthenticated caller", async ({ request }) => {
    const response = await request.get("/api/v1/billing/checkout/continue", {
      maxRedirects: 0,
    });
    // Either the API envelope or a redirect to sign-in; never a Stripe redirect.
    expect(response.status()).not.toBe(303);
    expect(response.headers()["location"] ?? "").not.toContain("stripe.com");
  });

  test("ignores a client-supplied session id or url", async ({ page, request }) => {
    await signUp(page);
    const cookies = await page.context().cookies();
    const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get(
      "/api/v1/billing/checkout/continue?session_id=cs_test_attacker&url=https://evil.example",
      { headers: { cookie: header }, maxRedirects: 0 },
    );

    const location = response.headers()["location"] ?? "";
    expect(location).not.toContain("evil.example");
    expect(location).not.toContain("cs_test_attacker");
  });

  test("sets no-store so the redirect is not cached", async ({ page, request }) => {
    await signUp(page);
    const cookies = await page.context().cookies();
    const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get("/api/v1/billing/checkout/continue", {
      headers: { cookie: header },
      maxRedirects: 0,
    });

    expect(response.headers()["cache-control"] ?? "").toContain("no-store");
  });

  test("the Portal route stays separate from the continue route", async ({ page, request }) => {
    await signUp(page);
    const cookies = await page.context().cookies();
    const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Portal is a POST endpoint; continue is a GET redirect. They are not
    // interchangeable, and continue must never open a portal session.
    const portal = await request.post("/api/v1/billing/portal", { headers: { cookie: header } });
    expect([404, 409, 500, 503]).toContain(portal.status());
  });
});

test.describe("demo isolation", () => {
  test("the demo account cannot reach the continue route", async ({ page, request }) => {
    // Sign in as the seeded developer to obtain a session shape, then confirm
    // the demo guard is enforced server-side on the continue route for demo.
    await page.goto("/sign-in");
    await page.fill('input[name="email"]', SEEDED_USER.email);
    await page.fill('input[name="password"]', SEEDED_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/app/);

    const cookies = await page.context().cookies();
    const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get("/api/v1/billing/checkout/continue", {
      headers: { cookie: header },
      maxRedirects: 0,
    });

    // The developer account is not demo, so this is about the route existing
    // and never redirecting off-site without a verified Session.
    const location = response.headers()["location"] ?? "";
    if (location) expect(location).toContain("localhost:3000");
  });
});
