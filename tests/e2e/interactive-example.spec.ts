import { expect, test, type Page } from "@playwright/test";

/**
 * Mobile containment for the shared `InteractiveExample`, which both `/` and
 * `/examples` render.
 *
 * The defect: a grid item defaults to `min-width: auto`, so its minimum size is
 * its content's min-content. The recommendation map's tablist is three cards
 * with a 15rem readable minimum — 744px — and that escaped the tablist's own
 * `overflow-x-auto` through the item wrapping it. The single mobile column
 * resolved to 786px inside a 350px grid box, the aside stretched to match, and
 * the *document* scrolled sideways: 416px at 390 and 486px at 320, on both
 * routes, in both themes.
 *
 * The contract is not "nothing is wider than the viewport" — the tablist is
 * supposed to scroll. It is that the overflow stays inside the tablist and
 * never reaches the document. These assertions check both halves, because
 * hiding the overflow would satisfy the first alone.
 *
 * Public routes: no account, no database setup.
 */

const ROUTES = ["/", "/examples"] as const;
const MOBILE_WIDTHS = [320, 390] as const;
const THEMES = ["light", "dark"] as const;
const DARK_CLASS = /(^|\s)dark(\s|$)/;

/** Representative portrait insets; see tests/e2e/mobile-viewport.spec.ts. */
const PORTRAIT_INSETS = { top: 59, right: 0, bottom: 34, left: 0 } as const;

async function applyTheme(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  const html = page.locator("html");
  if (scheme === "dark") await expect(html).toHaveClass(DARK_CLASS);
  else await expect(html).not.toHaveClass(DARK_CLASS);
}

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function expectNoDocumentOverflow(page: Page, context: string): Promise<void> {
  const overflow = await documentOverflow(page);
  expect(overflow, `${context}: the document scrolls sideways by ${String(overflow)}px`).toBe(0);
}

// ---------------------------------------------------------------------------
// Document containment
// ---------------------------------------------------------------------------

for (const route of ROUTES) {
  for (const width of MOBILE_WIDTHS) {
    test.describe(`${route} @${String(width)}px`, () => {
      test.use({ viewport: { width, height: 844 } });

      test("the document never scrolls sideways, in either theme", async ({ page }) => {
        await page.goto(route);

        for (const scheme of THEMES) {
          await applyTheme(page, scheme);
          await expectNoDocumentOverflow(page, `${route} ${scheme}`);
        }
      });

      test("the example grid takes the width available, not its content's", async ({ page }) => {
        await page.goto(route);

        const measured = await page.evaluate(() => {
          const grid = document.querySelector("div.mt-6.grid") as HTMLElement | null;
          if (!grid) return null;
          const aside = grid.querySelector("aside") as HTMLElement | null;
          return {
            gridWidth: Math.round(grid.getBoundingClientRect().width),
            columns: getComputedStyle(grid).gridTemplateColumns,
            asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : -1,
          };
        });

        expect(measured, "the interactive example did not render").not.toBeNull();

        /*
         * The regression in one number: the column used to resolve to 786px in a
         * 350px grid because the map's min-content escaped through a grid item
         * with `min-width: auto`.
         */
        const columnWidth = Number.parseFloat(measured!.columns);
        expect(
          columnWidth,
          `the column is ${measured!.columns} in a ${String(measured!.gridWidth)}px grid`,
        ).toBeLessThanOrEqual(measured!.gridWidth + 1);

        // The aside was stretched to the same oversized track; it must not be.
        expect(measured!.asideWidth).toBeLessThanOrEqual(measured!.gridWidth + 1);
      });
    });
  }
}

// ---------------------------------------------------------------------------
// The tablist keeps its own scroll
// ---------------------------------------------------------------------------

test.describe("recommendation map on mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("overflow stays inside the tablist and the last tab is reachable", async ({ page }) => {
    await page.goto("/");

    const tablist = page.getByRole("tablist", { name: "Recommended paths" });
    await expect(tablist).toBeVisible();

    const box = await tablist.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      overflowX: getComputedStyle(node).overflowX,
    }));

    // It must genuinely scroll — that is the intended behaviour, not a defect.
    expect(box.overflowX).toBe("auto");
    expect(
      box.scrollWidth,
      "the tablist no longer scrolls; the tabs may have lost their readable minimum",
    ).toBeGreaterThan(box.clientWidth);

    // And the document must not, at the same moment.
    await expectNoDocumentOverflow(page, "with the tablist scrollable");

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);

    const last = tabs.nth(2);
    await last.scrollIntoViewIfNeeded();

    const contained = await tablist.evaluate((node) => {
      const list = node.getBoundingClientRect();
      const tab = node.querySelectorAll('[role="tab"]')[2]!.getBoundingClientRect();
      return { listRight: list.right, tabRight: tab.right, tabLeft: tab.left, listLeft: list.left };
    });

    expect(Math.round(contained.tabRight)).toBeLessThanOrEqual(Math.round(contained.listRight) + 1);
    expect(Math.round(contained.tabLeft)).toBeGreaterThanOrEqual(
      Math.round(contained.listLeft) - 1,
    );
    await expectNoDocumentOverflow(page, "after scrolling to the last tab");
  });

  test("all three tabs stay operable by keyboard", async ({ page }) => {
    await page.goto("/");

    const tabs = page.getByRole("tab");
    await tabs.first().focus();
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toBeFocused();
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(1)).toBeFocused();

    // Exactly one selected tab and one exposed panel throughout.
    await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expectNoDocumentOverflow(page, "after arrow-key navigation");
  });
});

// ---------------------------------------------------------------------------
// Profile options
// ---------------------------------------------------------------------------

test.describe("profile options at the narrowest width", () => {
  test.use({ viewport: { width: 320, height: 844 } });

  test("labels wrap rather than clip, and add no document overflow", async ({ page }) => {
    await page.goto("/");

    const group = page.locator("fieldset").first();
    await expect(group).toBeVisible();

    const labels = await group.locator("label").evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: (node.textContent ?? "").trim().slice(0, 30),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        right: Math.round(node.getBoundingClientRect().right),
        wraps: getComputedStyle(node.parentElement!).flexWrap,
      })),
    );

    expect(labels.length).toBeGreaterThan(0);
    const viewportWidth = page.viewportSize()!.width;

    for (const label of labels) {
      // Not clipped: the text fits the box it was given.
      expect(
        label.scrollWidth,
        `"${label.text}" is clipped by ${String(label.scrollWidth - label.clientWidth)}px`,
      ).toBeLessThanOrEqual(label.clientWidth);
      expect(label.right, `"${label.text}" runs past the viewport`).toBeLessThanOrEqual(
        viewportWidth,
      );
      // Wrapping is what keeps them inside, so the container must allow it.
      expect(label.wraps).toBe("wrap");
    }

    await expectNoDocumentOverflow(page, "profile options at 320");
  });
});

// ---------------------------------------------------------------------------
// Desktop composition is untouched
// ---------------------------------------------------------------------------

test.describe("desktop composition", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the aside and the map stay side by side on the 12-column grid", async ({ page }) => {
    await page.goto("/");

    const layout = await page.evaluate(() => {
      const grid = document.querySelector("div.mt-6.grid")! as HTMLElement;
      const aside = grid.querySelector("aside")!.getBoundingClientRect();
      /*
       * The grid's second child, located structurally rather than by the class
       * the fix happens to add. Matching on `.min-w-0` would make this test
       * prove a class name instead of a layout.
       */
      const map = (grid.children[1] as HTMLElement).getBoundingClientRect();
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        asideTop: Math.round(aside.top),
        mapTop: Math.round(map.top),
        asideRight: Math.round(aside.right),
        mapLeft: Math.round(map.left),
        asideWidth: Math.round(aside.width),
        mapWidth: Math.round(map.width),
      };
    });

    // Twelve tracks, and the two items share a row rather than stacking.
    expect(layout.columns).toBe(12);
    expect(Math.abs(layout.asideTop - layout.mapTop)).toBeLessThanOrEqual(1);
    expect(layout.mapLeft).toBeGreaterThan(layout.asideRight);

    // 4/8 split: the map is close to twice the aside.
    const ratio = layout.mapWidth / layout.asideWidth;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.4);

    await expectNoDocumentOverflow(page, "desktop");
  });
});

// ---------------------------------------------------------------------------
// A5/A6 did not regress
// ---------------------------------------------------------------------------

test.describe("safe-area profiles still hold on these routes", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("zero and representative portrait insets add no document overflow", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);

      // Zero: the shipped `env()` default, with nothing simulated.
      await expectNoDocumentOverflow(page, `${route} at zero inset`);

      await page.evaluate((insets) => {
        const style = document.documentElement.style;
        style.setProperty("--ns-safe-area-top", `${String(insets.top)}px`);
        style.setProperty("--ns-safe-area-right", `${String(insets.right)}px`);
        style.setProperty("--ns-safe-area-bottom", `${String(insets.bottom)}px`);
        style.setProperty("--ns-safe-area-left", `${String(insets.left)}px`);
      }, PORTRAIT_INSETS);

      await expectNoDocumentOverflow(page, `${route} under portrait insets`);

      // The shell still owns its edges; the fix touched neither.
      const owners = await page.evaluate(() => ({
        headerTop: getComputedStyle(document.querySelector("header")!).paddingTop,
        footerBottom: getComputedStyle(document.querySelector("footer")!).paddingBottom,
      }));
      expect(owners.headerTop).toBe(`${String(PORTRAIT_INSETS.top)}px`);
      expect(owners.footerBottom).toBe(`${String(PORTRAIT_INSETS.bottom)}px`);
    }
  });
});
