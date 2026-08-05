import { expect, test } from "@playwright/test";

test("home page renders the product heading", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("NorthStar Fortune Insights");
});

test("health endpoint reports the service as ok", async ({ request }) => {
  const response = await request.get("/api/v1/health");

  expect(response.ok()).toBe(true);
  const body: unknown = await response.json();
  expect(body).toMatchObject({ data: { status: "ok", service: "northstar" } });
});
