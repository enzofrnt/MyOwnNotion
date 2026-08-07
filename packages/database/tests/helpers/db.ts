/**
 * Shared disposable-database helper for integration suites.
 */

import { createDatabase, type DatabaseHandle, getOrCreateWorkspace } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";

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
