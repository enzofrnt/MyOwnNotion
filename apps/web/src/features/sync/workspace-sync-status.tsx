/** Compact workspace-level synchronization summary retained in the sidebar. */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { LocalContentService, LocalContentSnapshot } from "../../services/local-content.ts";
import { storageDiagnostics } from "../../services/storage-manager.ts";
import { FR_COPY } from "../../ui/copy/index.ts";
import { Status, type StatusKind } from "../../ui/primitives/status.tsx";
import { ConnectionState } from "./connection-state.tsx";
import { useChangeStream } from "./use-change-stream.ts";

const LABELS: Readonly<Record<LocalContentSnapshot["syncState"], string>> = {
  offline: FR_COPY.synchronization.offline,
  pending: FR_COPY.synchronization.pending,
  syncing: FR_COPY.synchronization.syncing,
  synced: FR_COPY.synchronization.synced,
  conflict: FR_COPY.synchronization.attention,
  "quota-failure": FR_COPY.synchronization.localSaveFailed,
};

const COMPACT_LABELS: Readonly<Record<LocalContentSnapshot["syncState"], string>> = {
  offline: FR_COPY.synchronization.compact.localSaved,
  pending: FR_COPY.synchronization.compact.localSaved,
  syncing: FR_COPY.synchronization.compact.syncing,
  synced: FR_COPY.synchronization.compact.synced,
  conflict: FR_COPY.synchronization.compact.attention,
  "quota-failure": FR_COPY.synchronization.compact.notSaved,
};

const STATUS_KINDS: Readonly<Record<LocalContentSnapshot["syncState"], StatusKind>> = {
  offline: "offline",
  pending: "pending",
  syncing: "syncing",
  synced: "success",
  conflict: "conflict",
  "quota-failure": "error",
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

export function WorkspaceSyncStatus({ service }: { readonly service: LocalContentService }) {
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
  const stream = useChangeStream(service);

  useEffect(() => {
    void storageDiagnostics().then((diagnostics) => {
      if (diagnostics.usageRatio !== null && diagnostics.usageRatio > 0.85) {
        setQuotaWarning(
          FR_COPY.synchronization.quotaWarning(Math.round(diagnostics.usageRatio * 100)),
        );
      }
    });
  }, []);

  const detail = syncStatusDetails(snapshot);
  const detailedLabel = `${LABELS[snapshot.syncState]}${detail}`;
  const compactLabel = `${COMPACT_LABELS[snapshot.syncState]}${detail}`;
  const liveStatus = (() => {
    if (realtimeState === "ready") return { state: "live" as const, refusal: null };
    if (realtimeState === "revoked") {
      return {
        state: "revoked" as const,
        refusal: FR_COPY.synchronization.realtime.revokedRefusal,
      };
    }
    if (realtimeState === "needs-update") {
      return {
        state: "needs-update" as const,
        refusal: FR_COPY.synchronization.realtime.updateRefusal,
      };
    }
    if (stream.state === "revoked" || stream.state === "needs-update") return stream;
    if (realtimeState === "connecting" || realtimeState === "authenticating") {
      return { state: "connecting" as const, refusal: null };
    }
    return { state: "local" as const, refusal: null };
  })();

  return (
    <section className="workspace-sync-status" aria-label={FR_COPY.synchronization.workspaceLabel}>
      <Status
        kind={STATUS_KINDS[snapshot.syncState]}
        state={snapshot.syncState}
        data-testid="sync-status"
        title={
          <>
            <span className="workspace-status__full">{detailedLabel}</span>
            <span className="workspace-status__compact" aria-hidden="true">
              {compactLabel}
            </span>
          </>
        }
      />
      <ConnectionState status={liveStatus} />
      {snapshot.storagePersisted === false ? (
        <Status
          kind="info"
          state="storage-advisory"
          data-testid="storage-persistence-advisory"
          title={
            <>
              <span className="workspace-status__full">
                {FR_COPY.synchronization.storageNotPersistent}
              </span>
              <span className="workspace-status__compact" aria-hidden="true">
                {FR_COPY.synchronization.compact.storageNotPersistent}
              </span>
            </>
          }
        />
      ) : null}
      {quotaWarning === null ? null : (
        <Status
          kind="error"
          state="quota-warning"
          data-testid="quota-warning"
          title={quotaWarning}
        />
      )}
    </section>
  );
}
