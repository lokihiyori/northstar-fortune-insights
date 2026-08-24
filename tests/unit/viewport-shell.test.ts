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

  it("derives the bottom inset from env() with a zero default", () => {
    // The zero default is what keeps every non-notched device unaffected.
    expect(CSS).toContain("--ns-safe-area-bottom: env(safe-area-inset-bottom, 0px);");
  });

  it("exposes it as a utility that reads the custom property", () => {
    /*
     * Indirection through the property is the testable part: `env()` cannot be
     * overridden, so a browser test can only simulate a real inset by setting
     * `--ns-safe-area-bottom` on the root element.
     */
    expect(CSS).toMatch(
      /@utility pb-safe-area-bottom\s*\{[^}]*padding-bottom:\s*var\(--ns-safe-area-bottom, 0px\);/,
    );
  });

  it("does not redefine the inset per theme", () => {
    // A device fact, not a token. Redefining it in `.dark` would be a bug.
    // Bounded to the block itself — `.dark {` to the `}` that closes it — so
    // the `@utility` further down the file is not swept in.
    const start = CSS.indexOf(".dark {");
    expect(start, ".dark block not found").toBeGreaterThan(-1);
    const dark = CSS.slice(start, CSS.indexOf("\n}", start));

    expect(dark).toContain("--ns-brand-teal");
    expect(dark).not.toContain("--ns-safe-area-bottom");
  });
});
