import { startDisposablePostgres } from "@myownnotion/test-utils";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseServerUrl: string;
  }
}

/**
 * Start one PostgreSQL server for the whole Vitest project.
 *
 * Individual suites still acquire and drop their own randomly named database
 * through startDisposablePostgres(), so sharing the server does not share test
 * state. This avoids repeatedly asking Docker to publish a new random port for
 * every file, which becomes flaky when the complete gate is under load.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await startDisposablePostgres();
  project.provide("testDatabaseServerUrl", postgres.connectionString);

  return async () => {
    await postgres.stop();
  };
}
