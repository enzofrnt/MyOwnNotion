import { defineConfig } from "vitest/config";

/**
 * Root Vitest options shared by every workspace project.
 *
 * Coverage is a plan-level no-regression gate. The negative thresholds are
 * Istanbul's absolute maximum numbers of uncovered items, calibrated from the
 * first complete Bun/Istanbul run. Unlike a percentage, adding well-covered
 * code cannot dilute this debt or make room for new untested behavior.
 */
export default defineConfig({
  test: {
    // Vitest's process-fork pool depends on Node's child-process runtime.
    // Worker threads keep the complete suite inside the exact Bun process.
    pool: "threads",
    projects: [
      {
        test: {
          name: "domain",
          root: "packages/domain",
          environment: "node",
          include: ["tests/**/*.spec.ts"],
        },
      },
      {
        test: {
          name: "page-state",
          root: "packages/page-state",
          environment: "node",
          include: ["tests/**/*.spec.ts"],
        },
      },
      {
        test: {
          name: "contracts",
          root: "packages/contracts",
          environment: "node",
          include: ["tests/**/*.spec.ts"],
        },
      },
      {
        test: {
          name: "blob-store",
          root: "packages/blob-store",
          environment: "node",
          include: ["tests/**/*.spec.ts"],
        },
      },
      {
        test: {
          name: "client-core",
          root: "packages/client-core",
          environment: "node",
          include: ["tests/**/*.spec.ts"],
          setupFiles: ["tests/setup/indexeddb.ts"],
        },
      },
      {
        test: {
          name: "web",
          root: "apps/web",
          environment: "node",
          include: ["tests/**/*.spec.{ts,tsx}"],
          setupFiles: ["tests/setup/indexeddb.ts"],
        },
      },
      {
        test: {
          name: "database-integration",
          root: "packages/database",
          environment: "node",
          include: ["tests/**/*.spec.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
      {
        test: {
          name: "api-contract",
          root: "apps/api",
          environment: "node",
          include: ["tests/**/*.spec.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
      {
        test: {
          name: "workspace-contract",
          root: ".",
          environment: "node",
          include: ["tests/contract/**/*.spec.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
      {
        test: {
          name: "performance",
          root: ".",
          environment: "node",
          include: ["tests/performance/**/*.spec.ts"],
          setupFiles: ["packages/client-core/tests/setup/indexeddb.ts"],
          testTimeout: 600_000,
          hookTimeout: 600_000,
        },
      },
    ],
    coverage: {
      provider: "istanbul",
      enabled: false,
      all: true,
      include: ["packages/*/src/**/*.ts", "apps/api/src/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.d.ts",
        // The web client is exercised by Playwright journeys; browser-only
        // rendering files are not meaningfully measurable under Istanbul/Bun.
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
        // Process entry point, same exception: reads process.env, calls
        // process.exit(), and writes to the console. Every line of real
        // migration logic lives in packages/database/src/migrate.ts, which the
        // integration suite covers fully. Review if this file grows beyond
        // resolving the migrations directory and reporting the outcome.
        "apps/api/src/migrate.ts",
      ],
      thresholds: {
        statements: -2_216,
        lines: -1_866,
        functions: -337,
        branches: -2_465,
      },
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
