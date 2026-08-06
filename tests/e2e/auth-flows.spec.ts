import { expect, test } from "@playwright/test";
import { SEEDED_USER, TEST_PASSWORD, getUserByEmail, uniqueEmail } from "./helpers/db";

/**
 * Database-backed flows. Every test here drives the real application against the
 * real PostgreSQL container — no mocking, no stubbed session, no seeded cookie.
 * Assertions check both the rendered result and the persisted rows, so a flow
 * that merely *looks* right but writes nothing will fail.
 *
 * These run serially: they share one database, and the sign-out test depends on
 * an established session.
 */
test.describe.configure({ mode: "serial" });

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
  target = "/sign-in",
) {
  await page.goto(target);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signUp(page: import("@playwright/test").Page, email: string, name?: string) {
  await page.goto("/sign-up");
  if (name) await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("signs in with the seeded user and reaches the authenticated app", async ({ page }) => {
  await signIn(page, SEEDED_USER.email, SEEDED_USER.password);

  // The seeded profile has onboardingStep 0, so the dashboard forwards to setup.
  await page.waitForURL(/\/app(\/onboarding)?/);
  await expect(page).not.toHaveURL(/\/sign-in/);

  // Proves a real session exists: this endpoint 401s without one.
  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  const body = (await me.json()) as { data: { user: { email: string; role: string } } };
  expect(body.data.user.email).toBe(SEEDED_USER.email);
  expect(body.data.user.role).toBe("USER");
});

test("rejects a wrong password without revealing which field was wrong", async ({ page }) => {
  await signIn(page, SEEDED_USER.email, "definitely-not-the-password");

  // Scoped to the form: Next's route announcer is also role="alert".
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "That email and password combination is not correct.",
  );
  await expect(page).toHaveURL(/\/sign-in/);

  // Still unauthenticated.
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
});

test("honours a same-origin callbackUrl after a real sign-in", async ({ page }) => {
  await signIn(
    page,
    SEEDED_USER.email,
    SEEDED_USER.password,
    "/sign-in?callbackUrl=%2Fapp%2Fonboarding",
  );

  await page.waitForURL(/\/app\/onboarding/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("signs out and loses access to protected routes", async ({ page }) => {
  await signIn(page, SEEDED_USER.email, SEEDED_USER.password);
  await page.waitForURL(/\/app/);

  await page.getByRole("button", { name: "Sign out" }).click();
  // `commit` rather than the default `load`: this only needs to observe that
  // the sign-out redirect happened, not that every subresource on the landing
  // page — the heaviest in the app — finished downloading.
  await page.waitForURL("/", { waitUntil: "commit" });

  // The session is genuinely gone, not just visually.
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("signs up, persisting a user and profile, then lands on onboarding", async ({ page }) => {
  const email = uniqueEmail("signup");

  await signUp(page, email, "Casey Example");
  await page.waitForURL(/\/app\/onboarding/);

  const user = await getUserByEmail(email);
  expect(user, "sign-up must persist a user row").not.toBeNull();
  expect(user?.name).toBe("Casey Example");
  expect(user?.role).toBe("USER");
  // The password must be stored as a scrypt hash, never in the clear.
  expect(user?.passwordHash).toMatch(/^scrypt\$/);
  expect(user?.passwordHash).not.toContain(TEST_PASSWORD);
  expect(user?.profile, "a profile row must exist to resume onboarding").not.toBeNull();
  expect(user?.profile?.onboardingStep).toBe(0);
});

test("refuses a duplicate email and keeps the entered values", async ({ page }) => {
  const email = uniqueEmail("dupe");

  await signUp(page, email);
  await page.waitForURL(/\/app\/onboarding/);

  // A second registration with the same address, from a clean session.
  await page.context().clearCookies();
  await signUp(page, email);

  await expect(page.getByText("An account with this email already exists.")).toBeVisible();
  // Input is preserved so the user does not retype it.
  await expect(page.getByLabel("Email")).toHaveValue(email);
});

test("completes onboarding across all four steps and persists every answer", async ({ page }) => {
  const email = uniqueEmail("onboard");

  await signUp(page, email, "Robin Example");
  await page.waitForURL(/\/app\/onboarding/);

  // Step 1 — where are you now
  await page.getByLabel("Country, province, or city").fill("Halifax, Nova Scotia");
  await page.getByLabel("Where you are in your career").selectOption("MID_CAREER");
  await page.getByLabel("Current role or field of study").fill("Operations lead");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/step=2/);

  // Step 2 — where do you want to go
  await page.getByLabel("Your main goal").fill("Move into healthcare project management.");
  await page.getByLabel("When would you like to get there?").selectOption("WITHIN_1_YEAR");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/step=3/);

  // Step 3 — ranked priorities
  await page.getByLabel("Most important").selectOption("STABILITY");
  await page.getByLabel("Second").selectOption("LEARNING");
  await page.getByLabel("Third").selectOption("LOCATION");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/step=4/);

  // Step 4 — constraints
  await page.getByLabel("Time available").fill("about 6 hours a week");
  await page.getByLabel("Work authorization").fill("Canadian citizen");
  await page.getByRole("button", { name: "Finish" }).click();

  // Finishing returns to the dashboard, which no longer prompts to finish setup.
  await page.waitForURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome back");
  await expect(page.getByText("Finish building your compass")).toHaveCount(0);

  // Everything must actually be in PostgreSQL.
  const user = await getUserByEmail(email);
  expect(user?.profile?.region).toBe("Halifax, Nova Scotia");
  expect(user?.profile?.careerStage).toBe("MID_CAREER");
  expect(user?.profile?.currentRole).toBe("Operations lead");
  expect(user?.profile?.primaryGoal).toBe("Move into healthcare project management.");
  expect(user?.profile?.timeframe).toBe("WITHIN_1_YEAR");
  expect(user?.profile?.onboardingStep).toBe(4);
  expect(user?.profile?.onboardingCompletedAt).not.toBeNull();

  expect(user?.priorities.map((p) => p.key)).toEqual(["STABILITY", "LEARNING", "LOCATION"]);
  expect(user?.priorities.map((p) => p.rank)).toEqual([1, 2, 3]);

  const authorization = user?.constraints.find((c) => c.type === "WORK_AUTHORIZATION");
  expect(authorization?.value).toBe("Canadian citizen");
  // Authorization is classified as a hard constraint by the save action.
  expect(authorization?.isHardConstraint).toBe(true);
  expect(user?.constraints.find((c) => c.type === "TIME")?.value).toBe("about 6 hours a week");
});

test("resumes onboarding at the next unfinished step in a new session", async ({ page }) => {
  const email = uniqueEmail("resume");

  await signUp(page, email);
  await page.waitForURL(/\/app\/onboarding/);

  await page.getByLabel("Country, province, or city").fill("Winnipeg, Manitoba");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/step=2/);

  // Sign out, then back in — progress must survive the session.
  await page.goto("/app");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/", { waitUntil: "commit" });

  await signIn(page, email, TEST_PASSWORD);

  // A user with partial progress lands on the dashboard, not back inside the
  // wizard, and is offered the resume path rather than being trapped in it.
  await page.waitForURL(/\/app$/);
  await expect(page.getByText("Finish building your compass")).toBeVisible();

  await page.getByRole("link", { name: "Continue setup" }).click();
  await page.waitForURL(/\/app\/onboarding/);

  // Resumes at the next unfinished step, not back at step 1.
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await expect(page.getByLabel("Country, province, or city")).toHaveCount(0);

  // And the step-1 answer is still stored.
  const user = await getUserByEmail(email);
  expect(user?.profile?.region).toBe("Winnipeg, Manitoba");
  expect(user?.profile?.onboardingStep).toBe(1);
});

test("cannot skip ahead to a later onboarding step by URL", async ({ page }) => {
  const email = uniqueEmail("skipahead");

  await signUp(page, email);
  await page.waitForURL(/\/app\/onboarding/);

  // Nothing completed yet, so step 4 must clamp back to step 1.
  await page.goto("/app/onboarding?step=4");
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
});
