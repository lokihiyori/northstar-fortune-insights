import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // Prisma generates untyped-by-us client code; it is not ours to lint.
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // NorthStar rule: no `any` without a nearby justification comment.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      /**
       * Phase 8C: `console` is no longer the logging interface.
       *
       * Server code calls `src/lib/observability/logger`, which allow-lists
       * every field before emission. A stray `console.log(user)` bypasses that
       * entirely, so the rule is an error rather than a warning — the boundary
       * is enforced, not remembered.
       */
      "no-console": "error",
      eqeqeq: ["error", "smart"],
    },
  },
  {
    /**
     * The exceptions, each for a stated reason:
     *
     * - the logger itself writes to stdout, because that is what a container
     *   platform and a log collector already capture;
     * - `instrumentation.ts` prints a human-readable env failure before the
     *   logger is worth loading, and that block is what an operator reads on
     *   the first page of a failed boot;
     * - the client error boundary runs in the browser, where a server-only
     *   logger cannot go;
     * - seed and test tooling legitimately report to a terminal.
     */
    files: [
      "prisma/**/*.ts",
      "tests/**/*.ts",
      "tests/**/*.tsx",
      "*.config.ts",
      "*.config.mts",
      "src/instrumentation.ts",
      "src/lib/observability/logger.ts",
      "src/app/app/error.tsx",
    ],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
]);

export default eslintConfig;
