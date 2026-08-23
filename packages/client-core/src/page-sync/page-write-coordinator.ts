import type { Uuid } from "@myownnotion/domain";
import type { LocalDatabase } from "../local-store/schema.ts";

const queues = new WeakMap<LocalDatabase, Map<Uuid, Promise<void>>>();

/** Serializes the read→seal→IndexedDB commit window for one page across tabs/services. */
export async function withPageStateWrite<T>(
  db: LocalDatabase,
  pageId: Uuid,
  operation: () => Promise<T>,
): Promise<T> {
  let pages = queues.get(db);
  if (pages === undefined) {
    pages = new Map();
    queues.set(db, pages);
  }
  const previous = pages.get(pageId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  pages.set(pageId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (pages.get(pageId) === tail) pages.delete(pageId);
  }
}
