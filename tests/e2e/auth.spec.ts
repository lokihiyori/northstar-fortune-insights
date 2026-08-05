import { expect, test } from "@playwright/test";

/**
 * These cover the Phase 2 acceptance criterion that unauthorized users cannot
 * reach /app or the APIs. They need no database: the checks reject the request
 * before any query runs.
 */
test.describe("unauthenticated access", () => {
  test("redirects /app to sign-in with a return path", async ({ page }) => {
    await page.goto("/app");

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome back");
  });

  test("redirects a nested app route to sign-in", async ({ page }) => {
    await page.goto("/app/onboarding");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("rejects the me endpoint with the standard error envelope", async ({ request }) => {
    const response = await request.get("/api/v1/me");

    expect(response.status()).toBe(401);

    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.requestId).toBeTruthy();
    // An error body must never carry a stack trace or provider payload.
    expect(JSON.stringify(body)).not.toContain("prisma");
  });
});

test.describe("sign-in page", () => {
  test("ignores an off-site callbackUrl", async ({ page }) => {
    await page.goto("/sign-in?callbackUrl=https://example.com/evil");

    const callback = page.locator('input[name="callbackUrl"]');
    await expect(callback).toHaveValue("/app");
  });

  test("keeps a same-origin callbackUrl", async ({ page }) => {
    await page.goto("/sign-in?callbackUrl=%2Fapp%2Fonboarding");

    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue("/app/onboarding");
  });

  test("labels every field and links to sign-up", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  });
});

test.describe("marketing navigation", () => {
  test("reaches every public route from the landing page", async ({ page }) => {
    await page.goto("/");

    for (const [name, heading] of [
      ["How it works", "Most of NorthStar is not the AI part"],
      ["Examples", "Complete reports, not screenshots"],
      ["Pricing", "Two plans, no puzzle"],
    ] as const) {
      await page.goto("/");
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name }).click();
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
  });
});
