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
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Seed and test tooling legitimately log to stdout.
    files: ["prisma/**/*.ts", "tests/**/*.ts", "tests/**/*.tsx", "*.config.ts", "*.config.mts"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
]);

export default eslintConfig;
