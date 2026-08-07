/**
 * Shared application context passed to every route module.
 */
import type { Uuid } from "@myownnotion/domain";
import type { Database } from "@myownnotion/database";
import type { ContentStore } from "@myownnotion/blob-store";

export interface AppContext {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly schemaVersion: number;
  readonly contentStore: ContentStore;
}
