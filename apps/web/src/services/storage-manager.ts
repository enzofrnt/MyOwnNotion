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
 * Persistence is a best-effort eviction hint, never a workspace readiness
 * dependency. Firefox can leave the permission promise unsettled when several
 * isolated profiles start together, so a browser API that does not answer must
 * degrade to "unknown" instead of holding the whole application on its loading
 * screen forever.
 */
const PERSISTENCE_REQUEST_TIMEOUT_MS = 2_000;

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

export async function requestPersistentStorage(
  timeoutMs = PERSISTENCE_REQUEST_TIMEOUT_MS,
): Promise<boolean | null> {
  if (typeof navigator === "undefined" || navigator.storage?.persist === undefined) {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      const alreadyPersisted = await navigator.storage.persisted();
      return alreadyPersisted ? true : await navigator.storage.persist();
    })();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([request, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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
