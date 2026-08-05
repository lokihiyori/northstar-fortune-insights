import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolves the `@/*` alias from tsconfig.json natively.
    tsconfigPaths: true,
    // See tests/stubs/server-only.ts — the real boundary is still enforced by
    // `next build`, this only makes server modules importable under Vitest.
    // fileURLToPath, not `.pathname`: on Windows the latter leaves a leading
    // slash and percent-encoded spaces, which Vite cannot resolve.
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // Playwright owns tests/e2e; Vitest must not try to run those specs.
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/generated/**", "src/**/*.d.ts"],
    },
  },
});
