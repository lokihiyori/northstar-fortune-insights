import { expect, test } from "@playwright/test";

test("home page leads with the product promise", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Turn uncertainty into a path you can act on.",
  );
});

test("health endpoint reports the service as ok", async ({ request }) => {
  const response = await request.get("/api/v1/health");

  expect(response.ok()).toBe(true);
  const body: unknown = await response.json();
  expect(body).toMatchObject({ data: { status: "ok", service: "northstar" } });
});
