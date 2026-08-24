import { expect, test, type Page } from "@playwright/test";
import { TEST_PASSWORD, uniqueEmail } from "./helpers/db";

/**
 * Mobile viewport hardening (A5 safe area, A6 dynamic viewport height).
 *
 * Both findings are invisible on a desktop viewport, which is why the audited
 * suites never caught them:
 *
 *  - A5: the sticky bottom bar ended at `bottom: 0`, so on a notched phone its
 *    controls sat under the home indicator.
 *  - A6: `min-h-screen` is `100vh`, measured against *collapsed* browser
 *    chrome on mobile Safari — the shell is taller than the visible viewport
 *    while the toolbar shows, and jumps as it hides.
 *
 * `env()` cannot be overridden from a test, so the inset is read through
 * `--ns-safe-area-bottom` and simulated by setting that property on the root
 * element. 34px is the iPhone home-indicator inset and is used **only here** —
 * production reads the real value and defaults to 0.
 */

/** The project's touch-target floor. See accessibility.spec.ts for the note. */
const MIN_TARGET = 44;

/** Simulated notch inset. Test-only; never a production constant. */
const SIMULATED_INSET = 34;

const WIDTHS = [320, 390] as const;
const DARK_CLASS = /(^|\s)dark(\s|$)/;

async function applyTheme(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  const html = page.locator("html");
  if (scheme === "dark") await expect(html).toHaveClass(DARK_CLASS);
  else await expect(html).not.toHaveClass(DARK_CLASS);
}

/** Overrides the derived inset, standing in for a notched device. */
async function simulateInset(page: Page, pixels: number): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.style.setProperty("--ns-safe-area-bottom", `${String(value)}px`);
  }, pixels);
}

async function signUpAndFinishOnboarding(page: Page): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(uniqueEmail("viewport"));
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app\/onboarding/);

  await page.getByLabel("Country, province, or city").fill("Halifax, Nova Scotia");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/step=2/);
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Skip this step" }).click();
  }
  await page.waitForURL(/\/app$/);
}

const paddingBottom = (page: Page) =>
  page
    .getByRole("navigation", { name: "Application" })
    .evaluate((node) => getComputedStyle(node).paddingBottom);

// ---------------------------------------------------------------------------
// A5 — safe-area inset on the sticky bottom navigation
// ---------------------------------------------------------------------------

for (const width of WIDTHS) {
  test.describe(`safe area @${String(width)}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true });

    test("declares viewport-fit=cover, without which every inset is zero", async ({ page }) => {
      await page.goto("/");

      const content = await page.locator('meta[name="viewport"]').getAttribute("content");

      expect(content, "no viewport meta rendered").not.toBeNull();
      expect(content).toContain("viewport-fit=cover");
    });

    test("adds no padding on a device without an inset", async ({ page }) => {
      await signUpAndFinishOnboarding(page);

      // The default arm of `env(safe-area-inset-bottom, 0px)`. Desktop Chrome
      // reports no inset, so the bar must be exactly as tall as before.
      expect(await paddingBottom(page)).toBe("0px");
    });

    for (const scheme of ["light", "dark"] as const) {
      test(`honours a ${String(SIMULATED_INSET)}px inset in ${scheme}`, async ({ page }) => {
        await signUpAndFinishOnboarding(page);
        await applyTheme(page, scheme);

        const nav = page.getByRole("navigation", { name: "Application" });
        const before = (await nav.boundingBox())!;

        await simulateInset(page, SIMULATED_INSET);
        expect(await paddingBottom(page)).toBe(`${String(SIMULATED_INSET)}px`);

        // The bar grows by exactly the inset; nothing else moves.
        const after = (await nav.boundingBox())!;
        expect(Math.round(after.height - before.height)).toBe(SIMULATED_INSET);

        /*
         * The surface must cover the strip, not leave a transparent gap over
         * whatever is scrolled behind it.
         */
        const background = await nav.evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(background).not.toBe("rgba(0, 0, 0, 0)");
        expect(background).not.toBe("transparent");
      });
    }

    test("keeps all five targets at 44x44 with the inset applied", async ({ page }) => {
      await signUpAndFinishOnboarding(page);
      await simulateInset(page, SIMULATED_INSET);

      const nav = page.getByRole("navigation", { name: "Application" });
      const targets = nav.getByRole("link").or(nav.getByRole("button"));
      const count = await targets.count();
      expect(count).toBe(5);

      const navBox = (await nav.boundingBox())!;

      for (let index = 0; index < count; index += 1) {
        const target = targets.nth(index);
        const label = (await target.textContent())?.trim() ?? "target";
        const box = (await target.boundingBox())!;

        // The inset is padding *below* the controls, so their own boxes are
        // unchanged by it.
        expect(box.height, `${label} is ${String(box.height)}px tall`).toBeGreaterThanOrEqual(
          MIN_TARGET,
        );
        expect(box.width, `${label} is ${String(box.width)}px wide`).toBeGreaterThanOrEqual(
          MIN_TARGET,
        );

        // And they must sit above the inset strip, not inside it.
        const navBottom = navBox.y + navBox.height;
        expect(
          Math.round(navBottom - (box.y + box.height)),
          `${label} intrudes into the safe-area strip`,
        ).toBeGreaterThanOrEqual(SIMULATED_INSET);
      }
    });

    test("keeps the expanded panel above the entire padded bar", async ({ page }) => {
      await signUpAndFinishOnboarding(page);
      await simulateInset(page, SIMULATED_INSET);

      const nav = page.getByRole("navigation", { name: "Application" });
      await nav.getByRole("button", { name: /^More/ }).tap();

      const navBox = (await nav.boundingBox())!;
      const panel = page.locator("#app-nav-more");
      await expect(panel).toBeVisible();
      const panelBox = (await panel.boundingBox())!;

      /*
       * `bottom-full` resolves against the nav's padding box, so the panel must
       * clear the inset strip as well as the controls — not merely the row.
       */
      expect(
        Math.round(panelBox.y + panelBox.height),
        "the panel overlaps the bar or its safe-area strip",
      ).toBeLessThanOrEqual(Math.round(navBox.y) + 1);
    });

    test("does not scroll the page sideways with the inset applied", async ({ page }) => {
      await signUpAndFinishOnboarding(page);
      await simulateInset(page, SIMULATED_INSET);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(0);
    });

    test("does not hide page content behind the enlarged bar", async ({ page }) => {
      await signUpAndFinishOnboarding(page);
      await simulateInset(page, SIMULATED_INSET);

      /*
       * The bar is `sticky`, so it occupies layout space rather than floating
       * over the document. Scrolled to the end, the last content must still sit
       * above the bar's top edge.
       */
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      const nav = page.getByRole("navigation", { name: "Application" });
      const navBox = (await nav.boundingBox())!;
      const main = page.getByRole("main");
      const mainBox = (await main.boundingBox())!;

      expect(
        Math.round(mainBox.y + mainBox.height),
        "main content runs underneath the bottom bar",
      ).toBeLessThanOrEqual(Math.round(navBox.y) + 1);
    });
  });
}

test.describe("safe area does not reach the desktop shell", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the sidebar is unaffected and still lists all six destinations", async ({ page }) => {
    await signUpAndFinishOnboarding(page);
    await simulateInset(page, SIMULATED_INSET);

    const sidebar = page.getByRole("navigation", { name: "Application" });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link")).toHaveCount(6);

    /*
     * The desktop sidebar is a different element from the bottom bar and never
     * carried the utility, so a simulated inset must not reach it. Its own
     * padding is zero — `p-4` lives on the list inside it.
     */
    expect(await sidebar.evaluate((node) => getComputedStyle(node).paddingBottom)).toBe("0px");
  });
});

// ---------------------------------------------------------------------------
// A6 — dynamic viewport height across the four audited shells
// ---------------------------------------------------------------------------

test.describe("dynamic viewport height", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * The shell: the direct child of `<body>` that contains the page's `<main>`.
   *
   * Located structurally rather than by class, so the assertion is not circular
   * — and not as "the first div in body", which matches Next's dev-mode overlay
   * container instead. Admin names its landmark `#admin-main`, so this matches
   * the element, not the id.
   *
   * Asserted on the real DOM rather than the source, because `100dvh` and
   * `100vh` resolve to the same pixel value at rest and computed style cannot
   * tell them apart.
   */
  const shell = (page: Page) =>
    page
      .locator("body > div")
      .filter({ has: page.locator("main") })
      .first();

  test("the marketing shell uses dvh and fills a short page", async ({ page }) => {
    await page.goto("/terms");

    await expect(shell(page)).toHaveClass(/\bmin-h-dvh\b/);
    await expect(shell(page)).not.toHaveClass(/\bmin-h-screen\b/);

    const { shellHeight, viewportHeight } = await page.evaluate(() => {
      const node = Array.from(document.querySelectorAll("body > div")).find((el) =>
        el.querySelector("main"),
      );
      return {
        shellHeight: node ? node.getBoundingClientRect().height : 0,
        viewportHeight: document.documentElement.clientHeight,
      };
    });
    expect(Math.round(shellHeight)).toBeGreaterThanOrEqual(Math.round(viewportHeight));
  });

  test("the marketing shell still scrolls a long page", async ({ page }) => {
    await page.goto("/");

    // The landing page is many sections tall; it must scroll, not be cropped.
    const { scrollHeight, clientHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("the auth shell uses dvh", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(shell(page)).toHaveClass(/\bmin-h-dvh\b/);
    await expect(shell(page)).not.toHaveClass(/\bmin-h-screen\b/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the app shell uses dvh and keeps its bottom navigation", async ({ page }) => {
    await signUpAndFinishOnboarding(page);

    await expect(shell(page)).toHaveClass(/\bmin-h-dvh\b/);
    await expect(shell(page)).not.toHaveClass(/\bmin-h-screen\b/);
    await expect(page.getByRole("navigation", { name: "Application" })).toBeVisible();
  });

  test("the admin shell uses dvh", async ({ page }) => {
    const email = uniqueEmail("viewport-admin");
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/app\/onboarding/);

    const { promoteToAdmin } = await import("./helpers/db");
    await promoteToAdmin(email);

    // The role lives in the JWT, so the session has to be reissued.
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/", { waitUntil: "commit" });
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app/);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(shell(page)).toHaveClass(/\bmin-h-dvh\b/);
    await expect(shell(page)).not.toHaveClass(/\bmin-h-screen\b/);
    await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  });
});
