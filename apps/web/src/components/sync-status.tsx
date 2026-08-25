/**
 * Synchronization status indicator (T046, US6, FR-043).
 *
 * Shows offline, pending, synchronizing, synchronized, quota-failure, and
 * unresolved-conflict states. Never claims server durability for local-only
 * work: "pending" and "offline" explicitly say changes are local.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ConnectionState } from "../features/sync/connection-state.tsx";
import { useChangeStream } from "../features/sync/use-change-stream.ts";
import type { LocalContentService, LocalContentSnapshot } from "../services/local-content.ts";
import { storageDiagnostics } from "../services/storage-manager.ts";
import { FR_COPY } from "../ui/copy/index.ts";

const LABELS: Record<string, string> = {
  offline: FR_COPY.synchronization.offline,
  pending: FR_COPY.synchronization.pending,
  syncing: FR_COPY.synchronization.syncing,
  synced: FR_COPY.synchronization.synced,
  conflict: FR_COPY.synchronization.attention,
  // Local persistence failed: the change is not saved anywhere. This must
  // never read like "offline", where the change IS durable locally.
  "quota-failure": FR_COPY.synchronization.localSaveFailed,
};

const COMPACT_LABELS: Record<string, string> = {
  offline: "Enregistré sur cet appareil",
  pending: "Enregistré sur cet appareil",
  syncing: FR_COPY.synchronization.syncing,
  synced: FR_COPY.synchronization.synced,
  conflict: "Intervention nécessaire",
  "quota-failure": "Non enregistré",
};

export function syncStatusDetails(snapshot: LocalContentSnapshot): string {
  const details: string[] = [];
  const nonFilePendingCount = Math.max(0, snapshot.pendingCount - snapshot.filePendingCount);
  if (nonFilePendingCount > 0) {
    details.push(
      `${nonFilePendingCount} ${
        nonFilePendingCount === 1
          ? FR_COPY.synchronization.pendingSingular
          : FR_COPY.synchronization.pendingPlural
      }`,
    );
  }
  if (snapshot.filePendingCount > 0) {
    details.push(
      `${snapshot.filePendingCount} ${
        snapshot.filePendingCount === 1
          ? FR_COPY.synchronization.filePendingSingular
          : FR_COPY.synchronization.filePendingPlural
      }`,
    );
  }
  if (snapshot.conflictCount > 0) {
    details.push(
      `${snapshot.conflictCount} ${
        snapshot.conflictCount === 1
          ? FR_COPY.synchronization.decisionSingular
          : FR_COPY.synchronization.decisionPlural
      }`,
    );
  }
  if (snapshot.quarantinedRecoveryCount > 0) {
    details.push(
      `${snapshot.quarantinedRecoveryCount} ${
        snapshot.quarantinedRecoveryCount === 1
          ? FR_COPY.synchronization.oldDraftSingular
          : FR_COPY.synchronization.oldDraftPlural
      }`,
    );
  }
  return details.length === 0 ? "" : ` (${details.join(" · ")})`;
}

export function SyncStatus({ service }: { readonly service: LocalContentService }) {
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  const subscribeRealtime = useCallback(
    (listener: () => void) => service.realtimePageSync.subscribe(() => listener()),
    [service],
  );
  const realtimeState = useSyncExternalStore(
    subscribeRealtime,
    () => service.realtimePageSync.state,
    () => service.realtimePageSync.state,
  );
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);
  // Opened here because the retained workspace owns the synchronization
  // lifetime. The workspace may be visually hidden while settings are open,
  // but it deliberately stays mounted so remote changes keep arriving and the
  // owner returns to current content rather than a frozen copy.
  const stream = useChangeStream(service);

  useEffect(() => {
    void storageDiagnostics().then((diagnostics) => {
      if (diagnostics.usageRatio !== null && diagnostics.usageRatio > 0.85) {
        setQuotaWarning(
          `Local storage is ${Math.round(diagnostics.usageRatio * 100)}% full — saving may fail soon`,
        );
      }
    });
  }, []);

  const detail = syncStatusDetails(snapshot);
  const detailedLabel = `${LABELS[snapshot.syncState] ?? snapshot.syncState}${detail}`;
  const compactLabel = `${COMPACT_LABELS[snapshot.syncState] ?? snapshot.syncState}${detail}`;
  const liveStatus = (() => {
    if (realtimeState === "ready") return { state: "live" as const, refusal: null };
    if (realtimeState === "revoked") {
      return { state: "revoked" as const, refusal: "Sign in again or authorize this device." };
    }
    if (realtimeState === "needs-update") {
      return { state: "needs-update" as const, refusal: "Reload after updating the app." };
    }
    if (stream.state === "revoked" || stream.state === "needs-update") return stream;
    if (realtimeState === "connecting" || realtimeState === "authenticating") {
      return { state: "connecting" as const, refusal: null };
    }
    return { state: "local" as const, refusal: null };
  })();

  return (
    <div>
      <p
        className="status-banner"
        data-state={snapshot.syncState}
        data-testid="sync-status"
        role="status"
        aria-live="polite"
        title={detailedLabel}
      >
        <span className="workspace-status__full">{detailedLabel}</span>
        <span className="workspace-status__compact" aria-hidden="true">
          {compactLabel}
        </span>
      </p>
      <ConnectionState status={liveStatus} />
      {snapshot.storagePersisted === false ? (
        <p
          className="status-banner"
          data-state="storage-advisory"
          role="status"
          data-testid="storage-persistence-advisory"
        >
          {FR_COPY.synchronization.storageNotPersistent}
        </p>
      ) : null}
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
