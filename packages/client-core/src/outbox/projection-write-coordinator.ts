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
import type { LocalDatabase } from "../local-store/schema.ts";

const tails = new WeakMap<LocalDatabase, Promise<void>>();

export async function withProjectionWrite<T>(
  db: LocalDatabase,
  work: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(db) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  tails.set(db, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (tails.get(db) === tail) tails.delete(db);
  }
}
