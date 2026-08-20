import { defineWorkspace } from "vitest/config";

/**
 * Shared Vitest projects.
 *
 * - Pure/unit/property projects run without external services.
 * - `database-integration` requires PostgreSQL (Testcontainers or
 *   TEST_DATABASE_URL) and covers constraints, transactions, and migrations.
 * - `api-contract` boots the Fastify app against PostgreSQL and validates the
 *   OpenAPI contract.
 * - `workspace-contract` holds repo-level contract suites (OpenAPI document,
 *   export round-trips, compose security).
 */
export default defineWorkspace([
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
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
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
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
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
]);
