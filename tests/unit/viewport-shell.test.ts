import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/*
 * `next/font/google` runs a build-time loader that does not exist under Vitest,
 * and importing the root layout pulls it in. Only the `variable` each font
 * contributes to the html class is used, so a stub is enough to reach the
 * `viewport` export under test. Nothing about the fonts is asserted here.
 */
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "--font-inter" }),
  Manrope: () => ({ variable: "--font-manrope" }),
}));

const { viewport } = await import("@/app/layout");

/**
 * The two mobile viewport contracts (A5, A6).
 *
 * `viewportFit` is read from the real exported object rather than matched in
 * the file, so this fails if the export is renamed, retyped, or dropped — not
 * merely if the text moves.
 *
 * The layout assertions are deliberately source-level and deliberately narrow.
 * These four shells are async Server Components sitting behind auth guards, so
 * rendering them in jsdom would prove nothing about the class that survives to
 * the browser; the browser side of the contract is asserted against the real
 * DOM in tests/e2e/mobile-viewport.spec.ts. What this pins is the far cheaper
 * fact that no audited shell silently reverts.
 */

const APP = path.join(process.cwd(), "src", "app");

/** Exactly the four shells named in the Phase 8F audit. */
const AUDITED_LAYOUTS = [
  path.join(APP, "(auth)", "layout.tsx"),
  path.join(APP, "(marketing)", "layout.tsx"),
  path.join(APP, "app", "layout.tsx"),
  path.join(APP, "admin", "layout.tsx"),
] as const;

describe("root viewport", () => {
  it("opts into the full screen so safe-area insets are reported", () => {
    /*
     * Without this, iOS letterboxes the document inside the safe area and every
     * `env(safe-area-inset-*)` resolves to 0 — the bottom navigation's padding
     * would compute correctly and still always be zero on the one class of
     * device it exists for.
     */
    expect(viewport.viewportFit).toBe("cover");
  });

  it("keeps the existing theme-colour declarations", () => {
    // Guards against the export being rewritten rather than extended.
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
      { media: "(prefers-color-scheme: dark)", color: "#07111f" },
    ]);
  });
});

describe("audited shells use dynamic viewport height", () => {
  it.each(AUDITED_LAYOUTS.map((file) => [path.relative(APP, file), file] as const))(
    "%s uses min-h-dvh",
    (_label, file) => {
      expect(readFileSync(file, "utf8")).toContain("min-h-dvh");
    },
  );

  it.each(AUDITED_LAYOUTS.map((file) => [path.relative(APP, file), file] as const))(
    "%s no longer uses min-h-screen",
    (_label, file) => {
      /*
       * `100vh` is measured against the *collapsed* browser chrome on mobile
       * Safari, so a shell sized with it is taller than the visible viewport
       * while the toolbar is showing and jumps as it hides.
       */
      expect(readFileSync(file, "utf8")).not.toContain("min-h-screen");
    },
  );
});

describe("safe-area inset", () => {
  const CSS = readFileSync(path.join(APP, "globals.css"), "utf8");

  /*
   * This is the one part of the contract a browser test cannot reach.
   *
   * The e2e suite simulates a device by setting `--ns-safe-area-*` directly,
   * which means it would keep passing even if the property were wired to
   * nothing — or to a misspelled `env()` keyword. Asserting the declarations
   * themselves is what proves the production path is real.
   */
  it.each([
    ["top", "safe-area-inset-top"],
    ["right", "safe-area-inset-right"],
    ["bottom", "safe-area-inset-bottom"],
    ["left", "safe-area-inset-left"],
  ])("derives the %s inset from env() with a zero default", (edge, keyword) => {
    // The zero default is what keeps every non-notched device unaffected.
    expect(CSS).toContain(`--ns-safe-area-${edge}: env(${keyword}, 0px);`);
  });

  /*
   * `max()`, never a bare assignment.
   *
   * `padding: var(--inset)` would *replace* whatever padding the element
   * already had — a `py-12` main would collapse to nothing at a zero inset, and
   * a 10px inset would shrink a 32px gap. The existing spacing is the floor; a
   * cutout can only widen it. Both mistakes were made and caught here.
   */
  it.each([
    ["pt-safe-area", "padding-top", "--ns-pad-top", "--ns-safe-area-top"],
    ["pb-safe-area", "padding-bottom", "--ns-pad-bottom", "--ns-safe-area-bottom"],
    ["pl-safe-area", "padding-left", "--ns-pad-left", "--ns-safe-area-left"],
  ])("%s takes the larger of its base and the inset", (utility, property, base, inset) => {
    const block = CSS.slice(CSS.indexOf(`@utility ${utility} {`));
    expect(block).toContain(`${property}: max(var(${base}, 0px), var(${inset}, 0px));`);
  });

  it("takes the larger of the gutter and the inline inset, never the smaller", () => {
    const block = CSS.slice(CSS.indexOf("@utility px-safe-area"));
    expect(block).toContain(
      "padding-inline-start: max(var(--ns-gutter, 0px), var(--ns-safe-area-left, 0px));",
    );
    expect(block).toContain(
      "padding-inline-end: max(var(--ns-gutter, 0px), var(--ns-safe-area-right, 0px));",
    );
  });

  it("offsets the skip link by the top and left insets", () => {
    // Absolutely positioned, so it would otherwise land under the notch.
    const block = CSS.slice(CSS.indexOf("@utility skip-link-inset"));
    expect(block).toContain("top: calc(0.75rem + var(--ns-safe-area-top, 0px));");
    expect(block).toContain("left: calc(0.75rem + var(--ns-safe-area-left, 0px));");
  });

  it("does not redefine the insets per theme", () => {
    // A device fact, not a token. Redefining it in `.dark` would be a bug.
    // Bounded to the block itself — `.dark {` to the `}` that closes it — so
    // the `@utility` further down the file is not swept in.
    const start = CSS.indexOf(".dark {");
    expect(start, ".dark block not found").toBeGreaterThan(-1);
    const dark = CSS.slice(start, CSS.indexOf("\n}", start));

    expect(dark).toContain("--ns-brand-teal");
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(dark, `.dark redefines --ns-safe-area-${edge}`).not.toContain(
        `--ns-safe-area-${edge}`,
      );
    }
  });
});
