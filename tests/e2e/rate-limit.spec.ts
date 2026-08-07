import { expect, test, type Page } from "@playwright/test";
import {
  TEST_PASSWORD,
  getSourceByUrl,
  promoteToAdmin,
  uniqueEmail,
  uniqueSourceUrl,
} from "./helpers/db";

/**
 * Server-side rate limiting, through the real application.
 *
 * Nothing is stubbed and no test-only policy is substituted: these are the
 * production limits, enforced by the production code, against the real
 * PostgreSQL and the real Redis. A limit that only holds under a test
 * configuration is not a limit.
 *
 * Subjects are unique per test — a fresh account, a fresh admin, a fresh
 * address — so the suites cannot exhaust each other's budgets. Whatever is left
 * is cleared in global teardown.
 */
test.describe.configure({ mode: "serial" });

/** The one message every refusal uses. Duplicated from the server on purpose: */
/* if the server's wording drifts, this must fail rather than quietly follow. */
const RATE_LIMITED = "Too many attempts. Please wait a moment and try again.";
const WRONG_CREDENTIALS = "That email and password combination is not correct.";

/** Matches `AUTH_IDENTIFIER` in src/lib/rate-limit/policies.ts. */
const AUTH_FAILURES_ALLOWED = 5;
/** Matches `GUIDANCE_USER`. */
const GUIDANCE_ALLOWED = 3;
/** Matches `ADMIN_MUTATION_USER`. */
const ADMIN_MUTATIONS_ALLOWED = 30;

async function attemptSignIn(page: Page, email: string, password: string): Promise<string> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Scoped to the form: Next's route announcer is also role="alert".
  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toBeVisible();
  return (await alert.textContent()) ?? "";
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app\/onboarding/);
}

test.describe("credential rate limiting", () => {
  test("locks out repeated wrong passwords without revealing whether the account exists", async ({
    browser,
  }) => {
    const realEmail = uniqueEmail("rl-real");
    const unknownEmail = uniqueEmail("rl-unknown");

    // One account genuinely exists; the other never will.
    const setup = await browser.newContext();
    const setupPage = await setup.newPage();
    await signUp(setupPage, realEmail);
    await setup.close();

    // Separate contexts so neither carries a session into the attempts.
    const realContext = await browser.newContext();
    const unknownContext = await browser.newContext();
    const realPage = await realContext.newPage();
    const unknownPage = await unknownContext.newPage();

    try {
      // Every attempt up to the allowance answers the same way for both.
      for (let attempt = 1; attempt <= AUTH_FAILURES_ALLOWED; attempt += 1) {
        const forReal = await attemptSignIn(realPage, realEmail, "not-the-right-password");
        const forUnknown = await attemptSignIn(unknownPage, unknownEmail, "not-the-right-password");

        expect(forReal, `attempt ${String(attempt)} (existing account)`).toBe(WRONG_CREDENTIALS);
        expect(forUnknown, `attempt ${String(attempt)} (unknown address)`).toBe(WRONG_CREDENTIALS);
      }

      // And past it, both are refused — still identically.
      const limitedReal = await attemptSignIn(realPage, realEmail, "not-the-right-password");
      const limitedUnknown = await attemptSignIn(
        unknownPage,
        unknownEmail,
        "not-the-right-password",
      );

      expect(limitedReal).toBe(RATE_LIMITED);
      expect(limitedUnknown).toBe(RATE_LIMITED);
      // The whole enumeration defence in one assertion: an attacker cannot tell
      // a real account from an address that was never registered.
      expect(limitedReal).toBe(limitedUnknown);

      // The refusal names no account, no limit, no window, and no bucket.
      expect(limitedReal).not.toMatch(/account|exists|registered|limit|window|redis|bucket/i);

      // Still unauthenticated, and the correct password does not sneak past the
      // lockout either — the limit is on the account, not on the wrong guess.
      expect((await realPage.request.get("/api/v1/me")).status()).toBe(401);
      expect(await attemptSignIn(realPage, realEmail, TEST_PASSWORD)).toBe(RATE_LIMITED);
      expect((await realPage.request.get("/api/v1/me")).status()).toBe(401);
    } finally {
      await realContext.close();
      await unknownContext.close();
    }
  });

  test("a rate-limited sign-in keeps what the user typed", async ({ page }) => {
    const email = uniqueEmail("rl-ux");

    for (let attempt = 0; attempt <= AUTH_FAILURES_ALLOWED; attempt += 1) {
      await attemptSignIn(page, email, "not-the-right-password");
    }

    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toHaveText(RATE_LIMITED);

    // Accessible: announced as an alert, not only styled red.
    await expect(alert).toBeVisible();

    // The address is preserved so the user does not retype it...
    await expect(page.getByLabel("Email")).toHaveValue(email);
    // ...and the password is never echoed back into the page.
    await expect(page.getByLabel("Password")).toHaveValue("");

    // The form still works: this is a refusal, not a dead end.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("a burst of simultaneous wrong passwords is bounded, not just a sequence", async ({
    browser,
  }) => {
    // The gate reserves capacity before the password is verified. If it merely
    // read a count first, every one of these would see the same pre-attempt
    // value and all of them would reach verification.
    const email = uniqueEmail("rl-burst");
    const CONCURRENT = 8;

    const contexts = await Promise.all(
      Array.from({ length: CONCURRENT }, () => browser.newContext()),
    );

    try {
      const messages = await Promise.all(
        contexts.map(async (context) => {
          const page = await context.newPage();
          return attemptSignIn(page, email, "not-the-right-password");
        }),
      );

      const wrongCredentials = messages.filter((message) => message === WRONG_CREDENTIALS).length;
      const rateLimited = messages.filter((message) => message === RATE_LIMITED).length;

      expect(wrongCredentials + rateLimited, "every attempt must get one of the two").toBe(
        CONCURRENT,
      );
      // The decisive assertion: no more than the allowance reached verification,
      // even though all of them were in flight together.
      expect(wrongCredentials).toBeLessThanOrEqual(AUTH_FAILURES_ALLOWED);
      expect(rateLimited).toBeGreaterThanOrEqual(CONCURRENT - AUTH_FAILURES_ALLOWED);

      // And the account is locked afterwards.
      const page = await contexts[0]!.newPage();
      expect(await attemptSignIn(page, email, "not-the-right-password")).toBe(RATE_LIMITED);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test("repeated successful sign-ins never consume the failure allowance", async ({ page }) => {
    const email = uniqueEmail("rl-success");
    await signUp(page, email);

    // Sign-up leaves the session on the onboarding step, so each pass signs out
    // from wherever it is and back in again. Well past the allowance: each
    // success releases its own reservation, so none of them leaves anything.
    for (let i = 0; i < AUTH_FAILURES_ALLOWED + 3; i += 1) {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL("/", { waitUntil: "commit" });

      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(TEST_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/app/);
    }

    // Signing in eight times has not spent the account's failure budget: a wrong
    // password still reads as a wrong password, not as a lockout.
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/", { waitUntil: "commit" });

    expect(await attemptSignIn(page, email, "not-the-right-password")).toBe(WRONG_CREDENTIALS);
  });

  test("one account being locked out does not lock out another", async ({ browser }) => {
    const locked = uniqueEmail("rl-locked");
    const bystander = uniqueEmail("rl-bystander");

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      for (let attempt = 0; attempt <= AUTH_FAILURES_ALLOWED; attempt += 1) {
        await attemptSignIn(page, locked, "not-the-right-password");
      }
      expect(await attemptSignIn(page, locked, "not-the-right-password")).toBe(RATE_LIMITED);

      // A different address from the same browser is unaffected, because the
      // budget is per account. (Per-address limits are skipped here: no trusted
      // proxy is configured, which is the documented default.)
      expect(await attemptSignIn(page, bystander, "not-the-right-password")).toBe(
        WRONG_CREDENTIALS,
      );
    } finally {
      await context.close();
    }
  });
});

test.describe("guidance generation rate limiting", () => {
  test("limits generation server-side and cannot be bypassed from the client", async ({ page }) => {
    await signUp(page, uniqueEmail("rl-guidance"));

    const body = {
      topic: "EDUCATION",
      question: "Should I take a part-time diploma while working full time in Ontario?",
      criteria: [{ key: "SPEED", weight: 3 }],
      includeProfile: false,
    };

    async function submit(
      extra: Record<string, unknown> = {},
      headers: Record<string, string> = {},
    ) {
      return page.request.post("/api/v1/guidance", {
        headers: {
          "content-type": "application/json",
          // A fresh key every time, so idempotency never hides a refusal.
          "idempotency-key": crypto.randomUUID(),
          ...headers,
        },
        data: { ...body, ...extra },
      });
    }

    for (let attempt = 1; attempt <= GUIDANCE_ALLOWED; attempt += 1) {
      const response = await submit();
      expect(response.status(), `attempt ${String(attempt)}`).toBe(202);
    }

    const refused = await submit();
    expect(refused.status()).toBe(429);
    expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);

    const payload = (await refused.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(payload.error.code).toBe("RATE_LIMITED");
    expect(payload.error.requestId).toBeTruthy();
    expect(payload.error.message).toBe(RATE_LIMITED);

    // Nothing internal is disclosed.
    const raw = JSON.stringify(payload);
    expect(raw).not.toMatch(/northstar:rl|guidance_user|redis/i);

    // --- bypass attempts ----------------------------------------------------
    //
    // The limit is keyed to the server's idea of who is calling, so none of the
    // things a client controls can move it.

    // A forged user id and plan in the body.
    const forgedBody = await submit({
      userId: "someone-else",
      user: { id: "someone-else", role: "ADMIN" },
      plan: "plus",
      entitlements: { monthlyReports: 9999 },
    });
    expect(forgedBody.status()).toBe(429);

    // A spoofed forwarding header, which is ignored with no trusted proxy.
    const forgedHeaders = await submit(
      {},
      { "x-forwarded-for": "203.0.113.99", "x-real-ip": "203.0.113.99" },
    );
    expect(forgedHeaders.status()).toBe(429);

    // A different idempotency key is a new request, not a new allowance.
    const newKey = await submit({}, { "idempotency-key": crypto.randomUUID() });
    expect(newKey.status()).toBe(429);
  });

  test("a different account has its own allowance", async ({ page }) => {
    await signUp(page, uniqueEmail("rl-guidance-2"));

    const response = await page.request.post("/api/v1/guidance", {
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      data: {
        topic: "CAREER",
        question: "Is moving into project management realistic for me within a year?",
        criteria: [{ key: "STABILITY", weight: 3 }],
        includeProfile: false,
      },
    });

    // The previous account is exhausted; this one is untouched.
    expect(response.status()).toBe(202);
  });
});

test.describe("admin mutation rate limiting", () => {
  test("limits admin source mutations server-side", async ({ page }) => {
    const email = uniqueEmail("rl-admin");
    await signUp(page, email);
    await promoteToAdmin(email);

    // The role lives in the JWT, so the session has to be reissued.
    await page.goto("/app");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/", { waitUntil: "commit" });
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app/);

    async function createSource(index: number) {
      return page.request.post("/api/v1/admin/sources", {
        data: {
          title: `Rate limit fixture ${String(index)}`,
          publisher: "Integration Test Registry",
          region: "Canada",
          topic: "CAREER",
          canonicalUrl: uniqueSourceUrl(`rl-${String(index)}`),
          summary: "Metadata-only fixture used to exercise the admin mutation limit.",
        },
      });
    }

    for (let index = 1; index <= ADMIN_MUTATIONS_ALLOWED; index += 1) {
      const response = await createSource(index);
      expect(response.status(), `mutation ${String(index)}`).toBe(201);
    }

    const blockedUrl = uniqueSourceUrl("rl-blocked");
    const refused = await page.request.post("/api/v1/admin/sources", {
      data: {
        title: "One too many",
        publisher: "Integration Test Registry",
        region: "Canada",
        topic: "CAREER",
        canonicalUrl: blockedUrl,
        summary: "This request must be refused before it reaches the database.",
      },
    });

    expect(refused.status()).toBe(429);
    expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);

    const payload = (await refused.json()) as { error: { code: string; requestId: string } };
    expect(payload.error.code).toBe("RATE_LIMITED");
    expect(payload.error.requestId).toBeTruthy();

    // Refused before any write: the row does not exist.
    expect(await getSourceByUrl(blockedUrl)).toBeNull();

    // Publishing is limited by the same budget, so it is refused too.
    const publish = await page.request.post("/api/v1/admin/sources/some-id/publish");
    expect(publish.status()).toBe(429);
  });
});
