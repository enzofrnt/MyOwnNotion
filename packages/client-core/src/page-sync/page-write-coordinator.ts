import type { Uuid } from "@myownnotion/domain";
import {
  pageStateWriteResource,
  withLocalDatabaseLock,
} from "../coordination/cross-context-coordinator.ts";
import type { LocalDatabase } from "../local-store/schema.ts";

/** Serializes the read→seal→IndexedDB commit window for one page across tabs/services. */
export async function withPageStateWrite<T>(
  db: LocalDatabase,
  pageId: Uuid,
  operation: () => Promise<T>,
): Promise<T> {
  return await withLocalDatabaseLock(db, pageStateWriteResource(pageId), operation);
}
