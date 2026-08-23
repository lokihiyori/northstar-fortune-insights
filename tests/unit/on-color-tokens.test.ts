import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The paired-foreground tokens, checked by measurement rather than by review.
 *
 * `--ns-on-brand` exists because the dark theme's teal is *light*, so `white`
 * on it measures 1.84:1. That reasoning was written down and then not applied
 * twice: the shared `danger` button variant and the completed plan-task control
 * both hard-coded `text-white`.
 *
 * Neither was reachable by the axe gate — the danger variant has no call site
 * at all, so no rendered page can exercise it. A token-level check is the only
 * thing that catches a colour pair nothing renders yet.
 */

const SRC = path.join(process.cwd(), "src");
const CSS = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4]
    .map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG 2.x contrast ratio, 1:1 to 21:1. */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The declaration block for a selector. Neither `:root` nor `.dark` contains a
 * nested rule, so the first `}` at the start of a line closes it.
 */
function declarationBlock(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} block not found in globals.css`).toBeGreaterThan(-1);

  const end = CSS.indexOf("\n}", start);
  expect(end, `${selector} block is unterminated`).toBeGreaterThan(start);

  return CSS.slice(start, end);
}

function token(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  expect(match, `--${name} is not defined as a 6-digit hex in this block`).not.toBeNull();
  return match![1]!.toLowerCase();
}

const LIGHT = declarationBlock(":root");
const DARK = declarationBlock(".dark");

type Theme = "light" | "dark";

/** Resolved inside the test body, so no CSS ever reaches a test title. */
const BLOCKS: Record<Theme, string> = { light: LIGHT, dark: DARK };

/** WCAG 2.2 AA normal text. Both controls here render text below 18.66px. */
const AA_NORMAL_TEXT = 4.5;

describe("paired foreground tokens", () => {
  /*
   * Three parameters, three placeholders, and the CSS is looked up from the
   * theme rather than passed in. Passing the block as a title parameter made
   * every generated name a multi-line dump of `:root` or `.dark`, and pushed
   * the background token out of the title entirely.
   */
  it.each([
    ["light", "ns-on-brand", "ns-brand-teal"],
    ["dark", "ns-on-brand", "ns-brand-teal"],
    ["light", "ns-on-danger", "ns-danger"],
    ["dark", "ns-on-danger", "ns-danger"],
  ] as [Theme, string, string][])("%s: --%s meets AA on --%s", (theme, foreground, background) => {
    const block = BLOCKS[theme];
    const fg = token(block, foreground);
    const bg = token(block, background);
    const ratio = contrast(fg, bg);

    expect(
      ratio,
      `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${String(AA_NORMAL_TEXT)}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("records the failure each token was introduced to prevent", () => {
    // Regression anchors. If a background is ever retuned, these two numbers
    // move and the test says so rather than silently passing on a new value.
    expect(contrast("#ffffff", token(DARK, "ns-brand-teal"))).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrast("#ffffff", token(DARK, "ns-danger"))).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("maps every paired foreground into the Tailwind theme", () => {
    const theme = declarationBlock("@theme inline");

    expect(theme).toContain("--color-on-brand: var(--ns-on-brand);");
    expect(theme).toContain("--color-on-danger: var(--ns-on-danger);");
  });
});

/**
 * Every `.ts` and `.tsx` under `src`, and nothing outside it.
 *
 * `.tsx` alone was too narrow: the `VARIANTS` record in `button.tsx` is exactly
 * the kind of class-string map that gets extracted to a plain `.ts` module, and
 * the scan would have stopped seeing it the moment it moved.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("branded surfaces never hard-code a foreground", () => {
  /*
   * Line-scoped, which is what both real defects looked like: a single
   * `className` string carrying the background and the foreground together. A
   * pair split across two lines would slip through, so this is a regression
   * guard for the known shape rather than a proof of absence.
   */
  it("pairs no brand or danger background with text-white", () => {
    const offenders: string[] = [];
    const scanned = sourceFiles(SRC);

    // A scan that silently found nothing to read would pass forever.
    expect(scanned.length, "no source files were scanned").toBeGreaterThan(0);
    expect(
      scanned.some((file) => file.endsWith(".ts") && !file.endsWith(".tsx")),
      "the scan reached no plain .ts module, so a variant moved out of .tsx would escape it",
    ).toBe(true);

    for (const file of scanned) {
      const lines = readFileSync(file, "utf8").split("\n");

      lines.forEach((line, index) => {
        const hasBrandedBackground = /\bbg-(brand-teal|danger)\b/.test(line);
        const hasLiteralWhite = /\btext-white\b/.test(line);

        if (hasBrandedBackground && hasLiteralWhite) {
          offenders.push(`${path.relative(SRC, file)}:${String(index + 1)}`);
        }
      });
    }

    expect(
      offenders,
      "use the paired token (text-on-brand / text-on-danger), not text-white",
    ).toEqual([]);
  });
});
