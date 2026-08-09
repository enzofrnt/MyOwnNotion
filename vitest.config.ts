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
        // Type-only contracts (no runtime statements): excluding these is not
        // an "executable code" exclusion under the constitution's coverage
        // policy, since there is nothing executable to measure.
        "apps/api/src/context.ts",
        "packages/blob-store/src/blob-store.ts",
        // Process entry point: binds signals and calls app.listen()/process.exit();
        // meaningfully exercising it requires a live bound port and OS signals,
        // which unit/integration tests do not attempt. buildApp(), which holds
        // all of its real logic, is fully covered by the contract-test suites.
        // Recorded exception: plan.md "Quality Gates" — narrow, first-party
        // executable exclusion; review if server.ts grows beyond bootstrap wiring.
        "apps/api/src/server.ts",
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
