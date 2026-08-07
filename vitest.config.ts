import { defineConfig } from "vitest/config";

/**
 * Root Vitest options shared by every workspace project.
 *
 * Coverage floors are a plan-level gate: 90% statements/lines/functions and
 * 85% branches for maintained TypeScript. They complement — never replace —
 * requirement, property, fault-injection, contract, and end-to-end tests.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      enabled: false,
      all: true,
      include: ["packages/*/src/**/*.ts", "apps/api/src/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.d.ts",
        // The web client is exercised by Playwright journeys; browser-only
        // rendering files are not meaningfully measurable under V8/node.
        "apps/web/**",
      ],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 90,
        branches: 85,
      },
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
