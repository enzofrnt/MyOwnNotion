/**
 * Shared disposable-database helper for integration suites.
 */
import { startMigratedPostgres, type DisposablePostgres } from "@myownnotion/test-utils";
import { createDatabase, getOrCreateWorkspace, type DatabaseHandle } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";

export interface IntegrationContext {
  readonly postgres: DisposablePostgres;
  readonly handle: DatabaseHandle;
  readonly workspaceId: Uuid;
  close(): Promise<void>;
}

export async function createIntegrationContext(): Promise<IntegrationContext> {
  const postgres = await startMigratedPostgres();
  const handle = createDatabase(postgres.connectionString);
  const workspace = await getOrCreateWorkspace(handle.db);
  return {
    postgres,
    handle,
    workspaceId: workspace.id,
    close: async () => {
      await handle.close();
      await postgres.stop();
    },
  };
}
