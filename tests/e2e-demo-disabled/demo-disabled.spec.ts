import "dotenv/config";
import { expect, test } from "@playwright/test";
import { DEMO_DISABLED_ORIGIN } from "../e2e/helpers/ports";

/**
 * Demo mode, switched off, proved in a browser against a real server.
 *
 * The rest of the suite runs against a server with demo mode **on**. Demo
 * status is read from the server's environment on every request, so the only
 * honest way to prove the disabled behaviour is a second process started with
 * the flag off — a test that flipped a client-side value would be proving
 * nothing, since the browser is not the authority here.
 *
 * This covers one half of the boundary: **no usable entry point is exposed**.
 * The other half — that invoking the Server Action directly is refused even if
 * someone reached it — is proved in `tests/unit/demo-disabled.test.ts`, at the
 * functions the action branches on. That split is deliberate: Next's Server
 * Action ids are build-generated and unstable, so scraping one out of the
 * markup would produce a test that breaks on every unrelated rebuild.
 *
 * The second server is declared in `playwright.config.ts` rather than spawned
 * in a `beforeAll`, because a hook is bounded by the test timeout and booting
 * `next dev` does not reliably fit inside it. Raising that timeout to make room
 * would have been the wrong fix. Playwright owns the lifecycle, so the port is
 * released when the run ends and no temporary log survives it.
 */

test.describe.configure({ mode: "serial" });

test("with demo mode disabled, the sign-in page offers no demo entry point", async ({ page }) => {
  const response = await page.goto(`${DEMO_DISABLED_ORIGIN}/sign-in`);

  // The page itself is healthy — this is not a 500 that trivially has no button.
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();

  // No demo entry point in any form.
  await expect(page.getByRole("button", { name: /explore the demo/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /explore the demo/i })).toHaveCount(0);
  await expect(page.getByText(/explore the demo/i)).toHaveCount(0);

  // Normal sign-in is untouched.
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: /create an account/i })).toBeVisible();

  // No demo label anywhere on an unauthenticated page.
  await expect(page.getByRole("note", { name: "Demo workspace notice" })).toHaveCount(0);
});

test("with demo mode disabled, no demo credential reaches the browser", async ({ page }) => {
  const demoEmail = process.env["DEMO_ACCOUNT_EMAIL"] ?? "";
  const demoPassword = process.env["DEMO_ACCOUNT_PASSWORD"] ?? "";

  // Without these the assertions below would pass vacuously.
  expect(
    demoEmail,
    "DEMO_ACCOUNT_EMAIL must be configured for this test to mean anything",
  ).not.toBe("");
  expect(
    demoPassword,
    "DEMO_ACCOUNT_PASSWORD must be configured for this test to mean anything",
  ).not.toBe("");

  await page.goto(`${DEMO_DISABLED_ORIGIN}/sign-in`);

  // Full markup, including the serialized RSC payload embedded in the document.
  const html = await page.content();
  expect(html).not.toContain(demoPassword);
  expect(html).not.toContain(demoEmail);

  // Visible text.
  const visible = await page.locator("body").innerText();
  expect(visible).not.toContain(demoPassword);
  expect(visible).not.toContain(demoEmail);

  // Every client script's text, inline or fetched.
  const scriptText = await page.evaluate(async () => {
    const parts: string[] = [];
    for (const script of Array.from(document.querySelectorAll("script"))) {
      if (script.textContent) parts.push(script.textContent);
      if (script.src) {
        try {
          parts.push(await (await fetch(script.src)).text());
        } catch {
          // A script that cannot be re-fetched contributes nothing.
        }
      }
    }
    return parts.join("\n");
  });
  expect(scriptText).not.toContain(demoPassword);
  expect(scriptText).not.toContain(demoEmail);
});

test("with demo mode disabled, the normal sign-in path still works", async ({ page }) => {
  await page.goto(`${DEMO_DISABLED_ORIGIN}/sign-in`);

  // Submitting the ordinary form still reaches the server and comes back with
  // the standard refusal, so disabling the demo has not broken authentication.
  // A *successful* sign-in is not asserted here on purpose: this server issues
  // its own random AUTH_SECRET, so a session it minted would be meaningless to
  // the rest of the suite. The enabled-demo specs already cover authenticated
  // journeys end to end.
  await page.getByLabel("Email").fill("nobody-demo-disabled@northstar.test");
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);

  // Still no demo entry point after a failed attempt re-renders the page.
  await expect(page.getByRole("button", { name: /explore the demo/i })).toHaveCount(0);
});
