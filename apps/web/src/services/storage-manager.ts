/**
 * Persistent browser storage and quota diagnostics (T047, US6).
 *
 * Requests durable storage where supported and exposes quota information so
 * the interface can report storage pressure instead of failing silently.
 */
export interface StorageDiagnostics {
  readonly persisted: boolean | null;
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  readonly usageRatio: number | null;
}

export interface DatabaseOfflineReadiness {
  readonly coverage: "complete" | "partial";
  readonly availableCount: number;
  readonly expectedCount: number;
  readonly offlineReady: boolean;
  readonly persisted: boolean | null;
}

/**
 * Verifies a database pin against actual local coverage.
 *
 * The durable-storage request protects the whole origin; coverage still comes
 * from the structured repository so persistence permission can never turn a
 * partial projection into a false "ready offline" claim.
 */
export async function databaseOfflineReadiness(
  repository: import("@myownnotion/client-core").LocalDatabaseRepository,
  databaseId: import("@myownnotion/domain").Uuid,
  expectedCount?: number,
): Promise<DatabaseOfflineReadiness> {
  const [persisted, coverage] = await Promise.all([
    requestPersistentStorage(),
    repository.coverage(databaseId, expectedCount),
  ]);
  return { ...coverage, persisted };
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || navigator.storage?.persist === undefined) {
    return null;
  }
  try {
    const alreadyPersisted = await navigator.storage.persisted();
    if (alreadyPersisted) {
      return true;
    }
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageDiagnostics(): Promise<StorageDiagnostics> {
  if (typeof navigator === "undefined" || navigator.storage?.estimate === undefined) {
    return { persisted: null, usageBytes: null, quotaBytes: null, usageRatio: null };
  }
  try {
    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted?.() ?? Promise.resolve(null),
      navigator.storage.estimate(),
    ]);
    const usage = estimate.usage ?? null;
    const quota = estimate.quota ?? null;
    return {
      persisted,
      usageBytes: usage,
      quotaBytes: quota,
      usageRatio: usage !== null && quota !== null && quota > 0 ? usage / quota : null,
    };
  } catch {
    return { persisted: null, usageBytes: null, quotaBytes: null, usageRatio: null };
  }
}
