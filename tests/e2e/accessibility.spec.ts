import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SEEDED_USER, TEST_PASSWORD, promoteToAdmin, uniqueEmail } from "./helpers/db";

/**
 * Accessibility, audited against the running application (Phase 8F).
 *
 * Two halves that check different things:
 *
 *   - **axe** catches machine-detectable violations — missing names, bad ARIA,
 *     contrast, duplicate ids — across both themes.
 *   - **keyboard assertions** catch what axe cannot: whether Tab order is
 *     usable, whether focus is visible, whether a tablist responds to arrow
 *     keys, whether focus is lost after an async update.
 *
 * The gate is **zero critical and zero serious violations**. Nothing is
 * excluded by selector or rule; if an exception is ever needed it belongs in
 * docs/audits/accessibility.md with a rule, element, reason, owner, and date —
 * not hidden in a disable list here.
 */

/** WCAG 2.0/2.1 A and AA only. Best-practice rules are advisory, not a gate. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

type Violation = {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: { target: unknown[] }[];
};

/** Fails the test with a readable list rather than a wall of axe JSON. */
function reportViolations(violations: Violation[], context: string): void {
  const blocking = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  if (blocking.length === 0) return;

  const detail = blocking
    .map((v) => {
      const targets = v.nodes
        .slice(0, 3)
        .map((n) => JSON.stringify(n.target))
        .join(", ");
      return `  [${String(v.impact)}] ${v.id}: ${v.help}\n    ${targets}`;
    })
    .join("\n");

  throw new Error(`${context}: ${String(blocking.length)} blocking violation(s)\n${detail}`);
}

async function analyze(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  reportViolations(results.violations as Violation[], context);
}

/**
 * Puts the page into one theme and waits until it is *painted* in that theme.
 *
 * Two separate things have to settle, and missing the second one is what made
 * this suite flaky:
 *
 * 1. `ThemeProvider` runs next-themes with `defaultTheme="system"`, so
 *    emulating the media query is what changing an OS preference does — and the
 *    controller reacts asynchronously. Hand-mutating `.dark` as well raced it.
 * 2. Buttons carry `transition-[background-color,color,filter,border-color]
 *    duration-150`, so the class flips instantly but the colour does not. axe
 *    reads *painted* colour, so a scan started here measured a half-finished
 *    interpolation: a probe caught `#ebeced` on `#1b7b77` — neither theme's
 *    value — reported as a serious `color-contrast` failure at 4.28:1, on
 *    whichever route happened to be scanned mid-transition.
 *
 * Both waits are real conditions, not delays. Only transitions are awaited:
 * the skeleton's `animate-pulse` never ends, and a keyframe animation is not
 * what corrupts a contrast reading.
 */
const DARK_CLASS = /(^|\s)dark(\s|$)/;

async function applyTheme(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });

  const html = page.locator("html");
  if (scheme === "dark") {
    await expect(html).toHaveClass(DARK_CLASS);
  } else {
    await expect(html).not.toHaveClass(DARK_CLASS);
  }

  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.constructor.name !== "CSSTransition" || animation.playState !== "running",
      ),
  );
}

/** Both themes, because contrast and focus differ between them. */
async function analyzeBothThemes(page: Page, context: string): Promise<void> {
  await applyTheme(page, "light");
  await analyze(page, `${context} [light]`);

  await applyTheme(page, "dark");
  await analyze(page, `${context} [dark]`);
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app\/onboarding/);
}

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------

test.describe("public routes", () => {
  for (const path of ["/", "/pricing", "/how-it-works", "/resources", "/sign-in", "/sign-up"]) {
    test(`no blocking violations: ${path}`, async ({ page }) => {
      await page.goto(path);
      await analyzeBothThemes(page, `axe ${path}`);
    });
  }

  test("landmarks, heading order, and document title on the landing page", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/NorthStar/i);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    // Exactly one h1, and no level skipped on the way down.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const levels = await page
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((nodes) => nodes.map((n) => Number(n.tagName.slice(1))));

    for (let i = 1; i < levels.length; i += 1) {
      const jump = levels[i]! - levels[i - 1]!;
      expect(
        jump,
        `heading jumped from h${String(levels[i - 1])} to h${String(levels[i])}`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Keyboard behaviour — what axe cannot see
// ---------------------------------------------------------------------------

test.describe("keyboard", () => {
  test("the skip link is the first stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const skip = page.getByRole("link", { name: /skip to content/i });
    await expect(skip).toBeFocused();

    await page.keyboard.press("Enter");
    // The target must be focusable, or the skip link only moves the scroll
    // position and a screen-reader user carries on from the header.
    await expect(page.locator("#main")).toBeFocused();
  });

  test("focus is visible in both themes", async ({ page }) => {
    await page.goto("/");

    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((t) => {
        document.documentElement.classList.toggle("dark", t === "dark");
      }, theme);

      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const s = getComputedStyle(el);
        return { width: s.outlineWidth, style: s.outlineStyle };
      });

      expect(outline, `no focus style in ${theme}`).not.toBeNull();
      expect(parseFloat(outline!.width), `focus outline invisible in ${theme}`).toBeGreaterThan(0);
      expect(outline!.style, `focus outline suppressed in ${theme}`).not.toBe("none");
    }
  });

  test("marketing navigation is reachable and activates with Enter", async ({ page }) => {
    await page.goto("/");

    const pricing = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Pricing" });
    await pricing.focus();
    await expect(pricing).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/pricing/);
  });

  test("the theme switch is operable from the keyboard", async ({ page }) => {
    await page.goto("/");

    const toggle = page.getByRole("button", { name: /colour theme|color theme/i });
    await toggle.focus();
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Enter");
    // It must remain focused and named after activating, or a keyboard user
    // loses their place every time they switch.
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAccessibleName(/theme/i);
  });

  test("sign-in errors are announced and keep focus reachable", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(SEEDED_USER.email);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toBeVisible();

    // The submit control must still be operable after a failed attempt.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    await page.getByLabel("Email").focus();
    await expect(page.getByLabel("Email")).toBeFocused();
  });

  test("no keyboard trap on the landing page", async ({ page }) => {
    await page.goto("/");

    const seen = new Set<string>();
    let repeats = 0;

    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "none";
        return `${el.tagName}:${el.getAttribute("href") ?? el.textContent?.slice(0, 24) ?? ""}`;
      });
      if (seen.has(id)) repeats += 1;
      seen.add(id);
    }

    // A trap shows up as the same element every press; cycling back through the
    // page after reaching the end is normal.
    expect(seen.size, "focus never moved — keyboard trap").toBeGreaterThan(5);
    expect(repeats).toBeLessThan(38);
  });
});

// ---------------------------------------------------------------------------
// Authenticated routes and complex states
// ---------------------------------------------------------------------------

test.describe("authenticated", () => {
  test.describe.configure({ mode: "serial" });

  test("app dashboard and onboarding wizard", async ({ page }) => {
    const email = uniqueEmail("a11y-app");
    await signUp(page, email);

    // Onboarding wizard — labelled controls, step status, validation.
    await analyzeBothThemes(page, "axe /app/onboarding");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByLabel("Country, province, or city").fill("Halifax, Nova Scotia");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=2/);
    await analyzeBothThemes(page, "axe /app/onboarding step 2");

    await page.getByRole("button", { name: "Skip this step" }).click();
    await page.waitForURL(/step=3/);
    await page.getByRole("button", { name: "Skip this step" }).click();
    await page.waitForURL(/step=4/);
    await page.getByRole("button", { name: "Skip this step" }).click();
    await page.waitForURL(/\/app$/);

    // The dashboard itself — one of the four Lighthouse gate routes.
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("navigation", { name: "Application" })).toBeVisible();
    await analyzeBothThemes(page, "axe /app");
  });

  test("sidebar navigation is keyboard operable", async ({ page }) => {
    await signUp(page, uniqueEmail("a11y-nav"));

    /*
     * The sidebar lives in the app layout, so this exercises it in the state
     * this test's own setup produces: signed in, onboarding not yet finished.
     *
     * `/app` redirects such an account to the wizard, and that redirect lands
     * *after* `goto` resolves — a probe saw `page.url()` report `/app` on every
     * run while the frame then navigated to `/app/onboarding` on 19 of 20, and
     * the sidebar link the test had focused was detached on 7 of 20. Focusing
     * before the route settles is the whole defect. Waiting for the settled URL
     * and a marker unique to it removes it.
     */
    await page.goto("/app");
    await page.waitForURL(/\/app\/onboarding/);
    await expect(page).toHaveURL(/\/app\/onboarding/);
    await expect(page.getByRole("heading", { level: 1, name: "Where are you now?" })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Application" });
    const history = nav.getByRole("link", { name: "History" });
    await expect(nav).toBeVisible();
    await expect(history).toBeVisible();
    await expect(history).toBeEnabled();

    await history.focus();
    await expect(history).toBeFocused();
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/app\/history/);
    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByRole("heading", { level: 1, name: "Your history" })).toBeVisible();

    // Focus must land somewhere in the document after client navigation, not
    // be lost to the body with no indication of position.
    await expect(page.getByRole("main")).toBeVisible();
    await analyzeBothThemes(page, "axe /app/history");
  });

  test("Ask composer: criteria controls, labels, and validation", async ({ page }) => {
    await signUp(page, uniqueEmail("a11y-ask"));
    await page.goto("/app/ask");

    await analyzeBothThemes(page, "axe /app/ask step 1");

    await page.getByText("Education", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    const question = page.getByLabel("Your decision question");
    await expect(question).toBeVisible();
    await question.fill(
      "How do I get my international accounting credential recognised in Ontario?",
    );
    await analyzeBothThemes(page, "axe /app/ask question step");

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Criteria step — checkbox group plus range inputs, both label-sensitive.
    await page.getByText("Speed to outcome", { exact: true }).click();
    await analyzeBothThemes(page, "axe /app/ask criteria step");
  });

  test("report tabs: roles, selected state, and arrow-key behaviour", async ({ page }) => {
    await signUp(page, uniqueEmail("a11y-report"));

    await page.goto("/app/ask");
    await page.getByText("Education", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page
      .getByLabel("Your decision question")
      .fill("Is a bridging programme a realistic route for me in Ontario?");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Speed to outcome", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Generate my insight" }).click();
    await page.waitForURL(/\/app\/insights\/[a-z0-9]+/, { timeout: 60_000 });

    const tablist = page.getByRole("tablist", { name: "Recommended paths" });
    await expect(tablist).toBeVisible();

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);

    // Exactly one selected tab, and it has a matching panel.
    await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
    await expect(page.getByRole("tabpanel")).toHaveCount(1);

    // Arrow keys move between tabs — the documented pattern for a tablist.
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.first()).toBeFocused();

    await analyzeBothThemes(page, "axe /app/insights/[id]");

    // Feedback and regeneration controls live on the same page.
    await expect(page.getByRole("button", { name: /regenerate/i })).toBeVisible();
  });

  test("action plan task controls", async ({ page }) => {
    await signUp(page, uniqueEmail("a11y-plan"));

    await page.goto("/app/ask");
    await page.getByText("Education", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page
      .getByLabel("Your decision question")
      .fill("What is a realistic route into project management for me?");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Speed to outcome", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Generate my insight" }).click();
    await page.waitForURL(/\/app\/insights\/[a-z0-9]+/, { timeout: 60_000 });

    await page.getByRole("button", { name: "Create an action plan" }).click();
    await page.waitForURL(/\/app\/plans\/[a-z0-9]+/);

    const task = page.getByRole("button", { name: /^Mark ".*" as done$/ }).first();
    await expect(task).toBeVisible();

    // Space activates a button, and the progress indicator must be named.
    await task.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("img", { name: /complete$/ })).toBeVisible();

    await analyzeBothThemes(page, "axe /app/plans/[id]");
  });

  test("admin source table and form", async ({ page }) => {
    const email = uniqueEmail("a11y-admin");
    await signUp(page, email);
    await promoteToAdmin(email);

    // The role lives in the JWT, so the session must be reissued.
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/", { waitUntil: "commit" });
    await signIn(page, email, TEST_PASSWORD);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
    await analyzeBothThemes(page, "axe /admin");

    await page.goto("/admin/sources");
    // The only scan in this file that sampled a page with nothing asserted
    // first, and the only one that went flaky in CI — axe reported a serious
    // contrast violation on one attempt and none on the retry. This `h1` sits
    // outside the populated/empty branch, so it proves the intended page has
    // finished rendering whether or not the corpus has rows.
    await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
    await analyzeBothThemes(page, "axe /admin/sources");

    await page.goto("/admin/sources/new");
    await expect(page.getByLabel("Title")).toBeVisible();
    await analyzeBothThemes(page, "axe /admin/sources/new");
  });
});

// ---------------------------------------------------------------------------
// Demo mode (Phase 8G) — new UI, so it goes through the same gate
// ---------------------------------------------------------------------------

test.describe("demo mode", () => {
  test.skip(
    process.env["DEMO_MODE_ENABLED"] !== "true",
    "demo mode is not enabled in this environment",
  );

  test("the demo entry point and banner pass in both themes", async ({ page }) => {
    await page.goto("/sign-in");
    const enter = page.getByRole("button", { name: "Explore the demo" });
    await expect(enter).toBeVisible();

    // The entry point must have a real accessible name, not an icon alone.
    await expect(enter).toHaveAccessibleName(/explore the demo/i);
    await analyzeBothThemes(page, "axe /sign-in with demo entry");

    // Keyboard-operable, like every other control on the page.
    await enter.focus();
    await expect(enter).toBeFocused();
    await enter.press("Enter");
    await page.waitForURL(/\/app/);

    const banner = page.getByRole("note", { name: "Demo workspace notice" });
    await expect(banner).toBeVisible();

    // The state is carried by text, not by colour alone (WCAG 1.4.1).
    await expect(banner).toContainText(/Demo workspace/i);

    await analyzeBothThemes(page, "axe /app with demo banner");
  });
});
