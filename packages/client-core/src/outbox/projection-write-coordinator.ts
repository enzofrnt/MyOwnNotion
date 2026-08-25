/**
 * Serializes the short local projection/outbox commit windows for one Dexie
 * database.
 *
 * Crypto is deliberately prepared outside Dexie transactions. Without this
 * coordinator an acknowledgement can retire a local revision while the next
 * mutation is sealing a payload based on it. The two writes are individually
 * atomic but causally inconsistent together. Only local preparation and
 * persistence are serialized here; network requests never hold the lock.
 */

import {
  PROJECTION_WRITE_RESOURCE,
  withLocalDatabaseLock,
} from "../coordination/cross-context-coordinator.ts";
import type { LocalDatabase } from "../local-store/schema.ts";

export async function withProjectionWrite<T>(
  db: LocalDatabase,
  work: () => Promise<T>,
): Promise<T> {
  return await withLocalDatabaseLock(db, PROJECTION_WRITE_RESOURCE, work);
}
