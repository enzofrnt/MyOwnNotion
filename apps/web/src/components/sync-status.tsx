/**
 * Synchronization status indicator (T046, US6, FR-043).
 *
 * Shows offline, pending, synchronizing, synchronized, quota-failure, and
 * unresolved-conflict states. Never claims server durability for local-only
 * work: "pending" and "offline" explicitly say changes are local.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { LocalContentService } from "../services/local-content.ts";
import { storageDiagnostics } from "../services/storage-manager.ts";

const LABELS: Record<string, string> = {
  offline: "Offline — changes are saved locally and will sync on reconnection",
  pending: "Pending — local changes are saved and awaiting synchronization",
  syncing: "Synchronizing…",
  synced: "Synchronized — all local changes are accepted by the server",
  conflict: "Conflict — some local work needs resolution and is kept safe",
  // Local persistence failed: the change is not saved anywhere. This must
  // never read like "offline", where the change IS durable locally.
  "quota-failure": "Not saved — local storage is unavailable or full; the last change was rejected",
};

export function SyncStatus({ service }: { readonly service: LocalContentService }) {
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);

  useEffect(() => {
    void storageDiagnostics().then((diagnostics) => {
      if (diagnostics.usageRatio !== null && diagnostics.usageRatio > 0.85) {
        setQuotaWarning(
          `Local storage is ${Math.round(diagnostics.usageRatio * 100)}% full — saving may fail soon`,
        );
      }
    });
  }, []);

  return (
    <div>
      <p
        className="status-banner"
        data-state={snapshot.syncState}
        data-testid="sync-status"
        role="status"
        aria-live="polite"
      >
        {LABELS[snapshot.syncState] ?? snapshot.syncState}
        {snapshot.pendingCount > 0 ? ` (${snapshot.pendingCount} pending)` : ""}
        {snapshot.conflictCount > 0 ? ` (${snapshot.conflictCount} unresolved conflicts)` : ""}
        {snapshot.storagePersisted === false ? " — durable storage was not granted" : ""}
      </p>
      {quotaWarning !== null ? (
        <p
          className="status-banner"
          data-state="quota-warning"
          role="alert"
          data-testid="quota-warning"
        >
          {quotaWarning}
        </p>
      ) : null}
    </div>
  );
}
