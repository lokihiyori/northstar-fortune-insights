import { expect, test, type Page } from "@playwright/test";
import { TEST_PASSWORD, uniqueEmail } from "./helpers/db";

/**
 * The full Phase 3 + Phase 4 happy path, against the real PostgreSQL and the
 * real pipeline — rules, retrieval over the seeded corpus, generation via the
 * deterministic provider, schema and citation validation, and persistence.
 *
 * Nothing is mocked. The deterministic provider is a real adapter selected
 * because no OPENAI_API_KEY is set, which is exactly how development and CI run.
 */
test.describe.configure({ mode: "serial" });

async function signUpAndOnboard(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app\/onboarding/);

  // A region is needed for region-filtered retrieval to behave realistically.
  await page.getByLabel("Country, province, or city").fill("Toronto, Ontario");
  await page.getByLabel("Where you are in your career").selectOption("MID_CAREER");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/step=2/);

  await page.getByLabel("Your main goal").fill("Work in accounting in Ontario within a year.");
  await page.getByLabel("When would you like to get there?").selectOption("WITHIN_1_YEAR");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/step=3/);

  await page.getByRole("button", { name: "Skip this step" }).click();
  await page.waitForURL(/step=4/);
  await page.getByRole("button", { name: "Skip this step" }).click();
  await page.waitForURL(/\/app$/);
}

async function composeQuestion(page: Page, question: string) {
  await page.goto("/app/ask");

  // Step 1 — topic
  await page.getByText("Education", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2 — question
  await page.getByLabel("Your decision question").fill(question);
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3 — context confirmation
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4 — criteria
  await page.getByText("Speed to outcome", { exact: true }).click();
  await page.getByText("Cost", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 5 — review and submit
  await expect(page.getByText("What will be analysed")).toBeVisible();
  await page.getByRole("button", { name: "Generate my insight" }).click();
}

test("generates a source-backed insight and converts it into an action plan", async ({ page }) => {
  const email = uniqueEmail("guidance");
  await signUpAndOnboard(page, email);

  await composeQuestion(
    page,
    "How do I get my international accounting credential recognised in Ontario?",
  );

  // The named-stage panel, then automatic navigation once the report is ready.
  await expect(page.getByRole("heading", { name: "Preparing your insight" })).toBeVisible();
  await page.waitForURL(/\/app\/insights\/[a-z0-9]+/, { timeout: 60_000 });

  // Report anatomy — spec section 5.5.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("accounting credential");
  await expect(page.getByRole("tablist", { name: "Recommended paths" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(3);

  // Confidence must never appear without its stated basis.
  const confidence = page.getByRole("region", { name: /^Confidence:/ });
  await expect(confidence).toBeVisible();
  await expect(confidence.getByRole("listitem").first()).toBeVisible();

  // Retrieval found real passages from the seeded corpus, so evidence is cited.
  await expect(page.getByText(/cited passages? across 3 paths/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();

  const reportUrl = page.url();

  // Comparison view.
  await page.getByRole("link", { name: "Compare the paths" }).click();
  await page.waitForURL(/\/app\/compare\//);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What would need to be true?" })).toBeVisible();

  // Convert the recommended path into a plan.
  await page.goto(reportUrl);
  await page.getByRole("button", { name: "Create an action plan" }).click();
  await page.waitForURL(/\/app\/plans\/[a-z0-9]+/);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const firstTask = page.getByRole("button", { name: /^Mark ".*" as done$/ }).first();
  await expect(firstTask).toBeVisible();

  // Completing a task moves the progress ring, which counts done tasks only.
  await firstTask.click();
  await expect(page.getByRole("img", { name: /complete$/ })).toBeVisible();

  // The report and plan are both in history and on the dashboard.
  await page.goto("/app/history");
  await expect(page.getByText("accounting credential")).toBeVisible();

  await page.goto("/app");
  await expect(page.getByText("Next best action")).toBeVisible();
});

test("refuses a high-stakes medical question instead of answering it", async ({ page }) => {
  const email = uniqueEmail("boundary");
  await signUpAndOnboard(page, email);

  await composeQuestion(page, "What medication should I take for my ongoing symptoms?");

  // The rules layer blocks this before any generation happens.
  await expect(page.getByRole("heading", { name: "That analysis did not finish" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/medical or mental-health/)).toBeVisible();
  await expect(page.getByText(/did not count against your monthly allowance/)).toBeVisible();
});

test("enforces report ownership across accounts", async ({ page, browser }) => {
  const ownerEmail = uniqueEmail("owner");
  await signUpAndOnboard(page, ownerEmail);
  await composeQuestion(page, "Is an apprenticeship a realistic route for me in Alberta?");
  await page.waitForURL(/\/app\/insights\/[a-z0-9]+/, { timeout: 60_000 });
  const reportUrl = page.url();

  // A different account must not be able to open it by id.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const intruderEmail = uniqueEmail("intruder");
  await signUpAndOnboard(otherPage, intruderEmail);

  await otherPage.goto(reportUrl);
  await expect(otherPage.getByText("We could not find that")).toBeVisible();

  await otherContext.close();
});
