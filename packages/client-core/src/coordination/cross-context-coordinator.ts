/**
 * Same-origin coordination for local durable state.
 *
 * A module-level promise queue only coordinates callers inside one JavaScript
 * realm. MyOwnNotion can have several tabs and workers sharing the same
 * IndexedDB database, so browsers use Web Locks: the user agent releases an
 * exclusive lock when its document/worker terminates. Node and test runtimes
 * use the deterministic process-wide queue below.
 */

import type { LocalDatabase } from "../local-store/schema.ts";

const fallbackTails = new Map<string, Promise<void>>();
const LOCK_PREFIX = "myownnotion.local.v1";

export const PROJECTION_WRITE_RESOURCE = "projection:write";
export const WORKSPACE_SYNC_RESOURCE = "workspace:sync";

export function pageStateWriteResource(pageId: string): string {
  return `page:${pageId}:write`;
}

export function pageSynchronizationResource(pageId: string): string {
  return `page:${pageId}:sync`;
}

export function localDatabaseLockName(db: Pick<LocalDatabase, "name">, resource: string): string {
  if (db.name.length === 0) throw new TypeError("a local database name is required");
  if (resource.length === 0) throw new TypeError("a local coordination resource is required");
  return `${LOCK_PREFIX}:${encodeURIComponent(db.name)}:${resource}`;
}

async function withFallbackLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const previous = fallbackTails.get(name) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  fallbackTails.set(name, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (fallbackTails.get(name) === tail) fallbackTails.delete(name);
  }
}

function browserLockManager(): LockManager | null {
  if (typeof navigator === "undefined") return null;
  return navigator.locks ?? null;
}

/** Runs one exclusive operation across every same-origin tab and worker. */
export async function withLocalDatabaseLock<T>(
  db: Pick<LocalDatabase, "name">,
  resource: string,
  work: () => Promise<T>,
): Promise<T> {
  const name = localDatabaseLockName(db, resource);
  const locks = browserLockManager();
  if (locks === null) return await withFallbackLock(name, work);
  return await locks.request(name, { mode: "exclusive" }, async () => await work());
}
