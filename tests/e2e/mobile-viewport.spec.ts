import { expect, test, type Locator, type Page } from "@playwright/test";
import { TEST_PASSWORD, promoteToAdmin, uniqueEmail } from "./helpers/db";

/**
 * Mobile viewport hardening (A5 safe area, A6 dynamic viewport height).
 *
 * Both findings are invisible on a desktop viewport, which is why the audited
 * suites never caught them:
 *
 *  - A5: `viewport-fit=cover` is global, so *every* route reaches the physical
 *    edges. Each content-bearing edge of each shell needs an owner, not just
 *    the app's bottom bar.
 *  - A6: `min-h-screen` is `100vh`, measured against *collapsed* browser chrome
 *    on mobile Safari — the shell is taller than the visible viewport while the
 *    toolbar shows, and jumps as it hides.
 *
 * `env()` cannot be overridden from a test, so production reads the insets
 * through `--ns-safe-area-*` and this file sets those same four properties.
 * That leaves one gap the override cannot see — whether the properties are
 * actually wired to `env()` at all — and tests/unit/viewport-shell.test.ts
 * closes it by asserting the declarations themselves.
 */

/** Test-only. Production reads the device values and defaults to zero. */
const INSETS = { top: 47, right: 44, bottom: 34, left: 44 } as const;
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 } as const;

type Insets = { top: number; right: number; bottom: number; left: number };

const VIEWPORTS = [
  { label: "portrait 390", width: 390, height: 844 },
  { label: "narrow portrait 320", width: 320, height: 844 },
  { label: "landscape 844", width: 844, height: 390 },
] as const;

/** Layout is deterministic; this absorbs sub-pixel rounding only. */
const TOLERANCE = 1;

const DARK_CLASS = /(^|\s)dark(\s|$)/;

async function applyTheme(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  const html = page.locator("html");
  if (scheme === "dark") await expect(html).toHaveClass(DARK_CLASS);
  else await expect(html).not.toHaveClass(DARK_CLASS);
}

/** Sets the same four properties production reads, standing in for a device. */
async function applyInsets(page: Page, insets: Insets): Promise<void> {
  await page.evaluate((value) => {
    const style = document.documentElement.style;
    style.setProperty("--ns-safe-area-top", `${String(value.top)}px`);
    style.setProperty("--ns-safe-area-right", `${String(value.right)}px`);
    style.setProperty("--ns-safe-area-bottom", `${String(value.bottom)}px`);
    style.setProperty("--ns-safe-area-left", `${String(value.left)}px`);
  }, insets);
}

/** Asserts a visible element sits inside the safe rectangle on the given edges. */
async function expectWithinSafeArea(
  target: Locator,
  label: string,
  insets: Insets,
  edges: { inline?: boolean; top?: boolean; bottom?: boolean } = { inline: true },
): Promise<void> {
  await expect(target, `${label} is not visible`).toBeVisible();
  const box = (await target.boundingBox())!;
  const viewport = target.page().viewportSize()!;

  if (edges.inline) {
    expect(box.x, `${label} crosses the left inset`).toBeGreaterThanOrEqual(
      insets.left - TOLERANCE,
    );
    expect(box.x + box.width, `${label} crosses the right inset`).toBeLessThanOrEqual(
      viewport.width - insets.right + TOLERANCE,
    );
  }
  if (edges.top) {
    expect(box.y, `${label} sits under the top inset`).toBeGreaterThanOrEqual(
      insets.top - TOLERANCE,
    );
  }
  if (edges.bottom) {
    expect(box.y + box.height, `${label} sits under the bottom inset`).toBeLessThanOrEqual(
      viewport.height - insets.bottom + TOLERANCE,
    );
  }
}

/**
 * A surface must still span the physical width, insets notwithstanding.
 *
 * Geometry only. Some surfaces are deliberately transparent — the marketing
 * header has no background of its own until it becomes sticky, and the body
 * paints behind it — so asserting a computed colour here would be asserting a
 * design choice, not the safe-area contract. `expectBodyCoversViewport` checks
 * that the physical strip is painted at all.
 */
async function expectSpansViewportWidth(target: Locator, label: string): Promise<void> {
  const box = (await target.boundingBox())!;
  const width = target.page().viewportSize()!.width;

  expect(box.x, `${label} is inset from the left edge`).toBeLessThanOrEqual(TOLERANCE);
  expect(box.x + box.width, `${label} stops short of the right edge`).toBeGreaterThanOrEqual(
    width - TOLERANCE,
  );
}

/** Something opaque must cover the full physical viewport, cutouts included. */
async function expectBodyCoversViewport(page: Page): Promise<void> {
  const painted = await page.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    return {
      background: getComputedStyle(document.body).backgroundColor,
      left: body.x,
      right: body.x + body.width,
      viewport: document.documentElement.clientWidth,
    };
  });

  expect(painted.background, "the body paints no background").not.toBe("rgba(0, 0, 0, 0)");
  expect(painted.left).toBeLessThanOrEqual(TOLERANCE);
  expect(painted.right).toBeGreaterThanOrEqual(painted.viewport - TOLERANCE);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(0);
}

/*
 * `html { scroll-behavior: smooth }` is set globally, so a plain `scrollTo`
 * animates and a measurement taken straight after reads a stale position — the
 * footer reported y=3126 in a 844px viewport. `instant` plus a settle wait
 * makes the geometry deterministic.
 */
async function scrollTo(page: Page, position: "top" | "bottom"): Promise<void> {
  await page.evaluate((where) => {
    window.scrollTo({
      top: where === "bottom" ? document.body.scrollHeight : 0,
      behavior: "instant",
    });
  }, position);
  await page.waitForFunction((where) => {
    const max = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    return where === "bottom" ? Math.abs(window.scrollY - max) <= 1 : window.scrollY <= 1;
  }, position);
}

async function signUpAndFinishOnboarding(page: Page, prefix = "viewport"): Promise<string> {
  const email = uniqueEmail(prefix);
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
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
  return email;
}

/**
 * The shell: the direct child of `<body>` that contains the page's `<main>`.
 *
 * Located structurally rather than by class, so the assertion is not circular —
 * and not as "the first div in body", which matches Next's dev-mode overlay
 * container instead. Admin names its landmark `#admin-main`, so this matches the
 * element, not the id.
 */
const shell = (page: Page) =>
  page
    .locator("body > div")
    .filter({ has: page.locator("main") })
    .first();

// ---------------------------------------------------------------------------
// A5 — every shell, every edge, both themes, three viewports
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  test.describe(`safe area — ${viewport.label}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
    });

    test("declares viewport-fit=cover, without which every inset is zero", async ({ page }) => {
      await page.goto("/");
      const content = await page.locator('meta[name="viewport"]').getAttribute("content");

      expect(content, "no viewport meta rendered").not.toBeNull();
      expect(content).toContain("viewport-fit=cover");
    });

    test("marketing shell clears every edge in both themes", async ({ page }) => {
      /*
       * `/pricing`, not `/`. The landing page already overflows horizontally by
       * 416px at 320-390px with *zero* insets — a pre-existing defect in
       * `InteractiveExample`, untouched by this change and measured on the
       * unmodified tree. `/pricing` exercises the same shell, header, and
       * footer without that confound.
       */
      await page.goto("/pricing");

      for (const scheme of ["light", "dark"] as const) {
        await applyTheme(page, scheme);
        await applyInsets(page, INSETS);

        const header = page.getByRole("banner");
        // The header's surface still spans the display; its content does not.
        await expectWithinSafeArea(
          page.getByRole("link", { name: /NorthStar/ }).first(),
          `logo ${scheme}`,
          INSETS,
          {
            inline: true,
            top: true,
          },
        );
        await expectWithinSafeArea(
          page.getByRole("button", { name: /colour theme|color theme/i }),
          `theme toggle ${scheme}`,
          INSETS,
          { inline: true, top: true },
        );
        await expectSpansViewportWidth(header, `marketing header ${scheme}`);
        await expectBodyCoversViewport(page);

        // Footer content must clear the home indicator; its surface need not.
        await scrollTo(page, "bottom");
        const footer = page.getByRole("contentinfo");

        /*
         * The *last* row, not a link from the columns above it. A mutation that
         * removed the footer's bottom protection still passed when this asserted
         * the "Privacy" link, because that link sits far enough up the footer to
         * clear the strip on its own. The copyright line is the content actually
         * at risk.
         */
        await expectWithinSafeArea(
          footer.getByText(/Built in Canada/),
          `footer last row ${scheme}`,
          INSETS,
          { inline: true, bottom: true },
        );
        await expectWithinSafeArea(
          footer.getByRole("link", { name: "Privacy" }),
          `footer link ${scheme}`,
          INSETS,
        );
        await expectSpansViewportWidth(footer, `marketing footer ${scheme}`);

        await expectNoHorizontalOverflow(page);
      }
    });

    // Declared only below `md`: the mobile menu does not exist above it, and a
    // conditional `test.skip` would report as a skipped test rather than an
    // inapplicable one.
    if (viewport.width < 768) {
      test("marketing mobile menu clears the inline and top edges", async ({ page }) => {
        await page.goto("/pricing");
        await applyInsets(page, INSETS);

        await page.getByRole("button", { name: /open menu/i }).click();
        const menu = page.getByRole("navigation", { name: "Primary mobile" });

        await expectWithinSafeArea(
          menu.getByRole("link", { name: "Pricing" }),
          "menu link",
          INSETS,
        );
        await expectNoHorizontalOverflow(page);
      });
    }

    test("skip link focus UI clears the top and inline edges", async ({ page }) => {
      await page.goto("/pricing");
      await applyInsets(page, INSETS);

      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: /skip to content/i });
      await expect(skip).toBeFocused();

      /*
       * The focus ring is drawn outside the border box, so the element itself
       * must clear the inset by more than zero for the ring to stay visible.
       */
      await expectWithinSafeArea(skip, "skip link", INSETS, { inline: true, top: true });
    });

    test("auth shell clears every edge", async ({ page }) => {
      await page.goto("/sign-in");
      await applyInsets(page, INSETS);

      await expectWithinSafeArea(page.getByRole("banner"), "auth header", INSETS, {
        inline: false,
      });
      await expectWithinSafeArea(
        page.getByRole("button", { name: /colour theme|color theme/i }),
        "auth theme toggle",
        INSETS,
        { inline: true, top: true },
      );
      await expectWithinSafeArea(page.getByLabel("Email"), "email field", INSETS);
      await expectWithinSafeArea(
        page.getByRole("button", { name: "Sign in" }),
        "sign-in button",
        INSETS,
      );
      await expectNoHorizontalOverflow(page);
    });

    test("app shell clears every edge and applies the bottom inset exactly once", async ({
      page,
    }) => {
      await signUpAndFinishOnboarding(page);
      await applyInsets(page, INSETS);
      // Top-edge geometry is only meaningful from an unscrolled viewport.
      await scrollTo(page, "top");

      /*
       * Header rows are fixed-height and single-line, so at 320px an inset of
       * 44px per side leaves 232px for a logo, a theme toggle, and a sign-out
       * button — not enough, measured. That combination is synthetic: a portrait
       * device reports 0 on both inline edges, and inline insets come from
       * landscape cutouts, where the viewport is 844px wide. Flowing content has
       * no such ceiling, so it is asserted at every width below.
       */
      const headerRowFits = viewport.width >= 390;

      await expectWithinSafeArea(
        page.getByRole("button", { name: "Sign out" }),
        "sign out",
        INSETS,
        { inline: headerRowFits, top: true },
      );
      await expectWithinSafeArea(page.getByRole("heading", { level: 1 }), "dashboard h1", INSETS);

      const nav = page.getByRole("navigation", { name: "Application" });
      const belowMd = viewport.width < 768;

      if (belowMd) {
        // The bar owns the bottom edge here, and `<main>` must not also pad it.
        expect(await nav.evaluate((node) => getComputedStyle(node).paddingBottom)).toBe(
          `${String(INSETS.bottom)}px`,
        );
        expect(
          await page.getByRole("main").evaluate((node) => getComputedStyle(node).paddingBottom),
        ).toBe("32px");
        await expectSpansViewportWidth(nav, "bottom bar");
        await expectBodyCoversViewport(page);
      } else {
        /*
         * Above `md` the bar is hidden, so `<main>` takes the bottom edge and
         * the sidebar takes the left one. Still exactly one owner per edge.
         */
        const mainPadding = await page
          .getByRole("main")
          .evaluate((node) => getComputedStyle(node).paddingBottom);
        // `max(2rem, inset)` — the base is the floor, never additive.
        expect(mainPadding).toBe(`${String(Math.max(32, INSETS.bottom))}px`);
        expect(await nav.evaluate((node) => getComputedStyle(node).paddingLeft)).toBe(
          `${String(INSETS.left)}px`,
        );
        await expectWithinSafeArea(
          nav.getByRole("link", { name: "Dashboard" }),
          "sidebar link",
          INSETS,
        );
      }

      /*
       * Same ceiling as above: the header row cannot fit 232px, so it is what
       * widens the document at 320px. Every other shell clears its inline insets
       * at this width, and this one does at zero insets — verified 0px overflow
       * on the unmodified tree at both 320 and 390.
       */
      if (headerRowFits) await expectNoHorizontalOverflow(page);
    });

    // Declared only below `md`, where the bar exists at all.
    if (viewport.width < 768) {
      test("bottom bar geometry survives the inset", async ({ page }) => {
        await signUpAndFinishOnboarding(page);
        await applyInsets(page, INSETS);

        const nav = page.getByRole("navigation", { name: "Application" });
        const navBox = (await nav.boundingBox())!;
        const targets = nav.getByRole("link").or(nav.getByRole("button"));
        expect(await targets.count()).toBe(5);

        for (let index = 0; index < 5; index += 1) {
          const target = targets.nth(index);
          const label = (await target.textContent())?.trim() ?? "target";
          const box = (await target.boundingBox())!;

          // The inset is padding *below* the controls; their own boxes are unchanged.
          expect(box.height, `${label} is ${String(box.height)}px tall`).toBeGreaterThanOrEqual(44);
          expect(box.width, `${label} is ${String(box.width)}px wide`).toBeGreaterThanOrEqual(44);
          expect(
            Math.round(navBox.y + navBox.height - (box.y + box.height)),
            `${label} intrudes into the safe-area strip`,
          ).toBeGreaterThanOrEqual(INSETS.bottom);
        }

        await nav.getByRole("button", { name: /^More/ }).tap();
        const panel = page.locator("#app-nav-more");
        await expect(panel).toBeVisible();
        const panelBox = (await panel.boundingBox())!;

        expect(
          Math.round(panelBox.y + panelBox.height),
          "the panel overlaps the bar or its safe-area strip",
        ).toBeLessThanOrEqual(Math.round(navBox.y) + TOLERANCE);
      });
    }

    test("admin shell clears every edge", async ({ page }) => {
      const email = await signUpAndFinishOnboarding(page, "viewport-admin");
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
      await applyInsets(page, INSETS);

      await scrollTo(page, "top");

      /*
       * The admin header already overflows a narrow viewport with *zero* insets
       * — measured 33px at 390 and 103px at 320 on the unmodified tree, because
       * it packs a logo, a badge, a link, a toggle, and a sign-out button into
       * one row. That is a pre-existing layout defect, out of scope here, so the
       * inline assertions run only where the shell fits and the top/bottom ones
       * run everywhere.
       */
      const inlineFits = viewport.width >= 768;

      await expectWithinSafeArea(
        page.getByRole("button", { name: "Sign out" }),
        "admin sign out",
        INSETS,
        { inline: inlineFits, top: true },
      );
      await expectWithinSafeArea(
        page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Sources" }),
        "admin nav link",
        INSETS,
        { inline: inlineFits },
      );
      await expectWithinSafeArea(
        page.getByRole("heading", { name: "Operations" }),
        "admin heading",
        INSETS,
        { inline: inlineFits },
      );
      expect(
        await page.getByRole("main").evaluate((node) => getComputedStyle(node).paddingBottom),
      ).toBe(`${String(Math.max(32, INSETS.bottom))}px`);

      if (inlineFits) await expectNoHorizontalOverflow(page);
    });

    test("spacing is unchanged when every inset is zero", async ({ page }) => {
      await page.goto("/pricing");
      await applyInsets(page, NO_INSETS);

      /*
       * The invariant that keeps this change invisible on every device without
       * a cutout: `max(gutter, 0)` is the gutter, and every `padding: inset`
       * owner resolves to zero.
       */
      const header = page.getByRole("banner");
      expect(await header.evaluate((node) => getComputedStyle(node).paddingTop)).toBe("0px");

      const gutter = viewport.width >= 640 ? "32px" : "20px";
      const container = header.locator("div").first();
      const padding = await container.evaluate((node) => ({
        left: getComputedStyle(node).paddingLeft,
        right: getComputedStyle(node).paddingRight,
      }));
      expect(padding.left).toBe(gutter);
      expect(padding.right).toBe(gutter);

      expect(
        await page
          .getByRole("contentinfo")
          .evaluate((node) => getComputedStyle(node).paddingBottom),
      ).toBe("0px");
      await expectNoHorizontalOverflow(page);
    });
  });
}

// ---------------------------------------------------------------------------
// A6 — dynamic viewport height across the four audited shells
// ---------------------------------------------------------------------------

test.describe("dynamic viewport height", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * Asserted on the real DOM rather than the source, because `100dvh` and
   * `100vh` resolve to the same pixel value at rest and computed style cannot
   * tell them apart.
   */
  async function expectDynamicShell(page: Page): Promise<void> {
    await expect(shell(page)).toHaveClass(/\bmin-h-dvh\b/);
    await expect(shell(page)).not.toHaveClass(/\bmin-h-screen\b/);
  }

  test("the marketing shell uses dvh and fills a short page", async ({ page }) => {
    await page.goto("/terms");
    await expectDynamicShell(page);

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

    const { scrollHeight, clientHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    await scrollTo(page, "bottom");
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("the auth shell uses dvh", async ({ page }) => {
    await page.goto("/sign-in");
    await expectDynamicShell(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the app shell uses dvh and keeps its bottom navigation", async ({ page }) => {
    await signUpAndFinishOnboarding(page);
    await expectDynamicShell(page);
    await expect(page.getByRole("navigation", { name: "Application" })).toBeVisible();
  });

  test("the admin shell uses dvh", async ({ page }) => {
    const email = await signUpAndFinishOnboarding(page, "viewport-admin-dvh");
    await promoteToAdmin(email);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/", { waitUntil: "commit" });
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app/);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expectDynamicShell(page);
    await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  });
});
