/**
 * Honest page-level save and synchronization state.
 *
 * Durability, transport and semantic attention are intentionally separate.
 * A pending update is already safe on this device; an open ambiguity can
 * coexist with a fully synchronized causal frontier; and a local write
 * failure must never be presented as merely offline.
 */

import { versionVectorDominates } from "@myownnotion/page-state";
import type {
  PageAmbiguityRecord,
  PageOperationStateRecord,
  PageOperationUpdateRecord,
} from "./encrypted-update-log.ts";

export type PageSyncStateKind =
  | "local-saving"
  | "local-saved"
  | "pending"
  | "syncing"
  | "synced"
  | "offline"
  | "blocked"
  | "attention";

export type PageSynchronizationKind = Exclude<PageSyncStateKind, "attention">;

export type PageSyncBlockedReason =
  | "quota"
  | "key"
  | "protocol"
  | "revocation"
  | "validation"
  | "integrity"
  | "operation"
  | "storage";

export interface PageSyncState {
  /** User-facing primary state. Semantic attention may wrap another sync state. */
  readonly kind: PageSyncStateKind;
  /** Transport/durability state even when `kind` is `attention`. */
  readonly synchronizationKind: PageSynchronizationKind;
  readonly pendingCount: number;
  readonly attentionCount: number;
  /** Whether the currently visible editor transaction is durable on this device. */
  readonly locallyDurable: boolean;
  readonly blockedReason?: PageSyncBlockedReason;
}

export interface DerivePageSyncStateInput {
  readonly localCommit: "idle" | "saving" | "blocked";
  readonly localBlockedReason?: PageSyncBlockedReason;
  readonly online: boolean;
  readonly importingRemote?: boolean;
  readonly operationState: Pick<
    PageOperationStateRecord,
    "status" | "versionVector" | "serverVersionVector"
  > | null;
  readonly updates: readonly Pick<PageOperationUpdateRecord, "status">[];
  readonly ambiguities: readonly Pick<PageAmbiguityRecord, "status">[];
}

interface BasePageSyncState {
  readonly synchronizationKind: PageSynchronizationKind;
  readonly locallyDurable: boolean;
  readonly blockedReason?: PageSyncBlockedReason;
}

function baseSyncState(input: DerivePageSyncStateInput): BasePageSyncState {
  if (input.localCommit === "blocked") {
    return {
      synchronizationKind: "blocked",
      locallyDurable: false,
      blockedReason: input.localBlockedReason ?? "storage",
    };
  }
  if (
    input.operationState?.status === "blocked" ||
    input.updates.some(({ status }) => status === "blocked")
  ) {
    return {
      synchronizationKind: "blocked",
      locallyDurable: true,
      blockedReason: "operation",
    };
  }
  if (input.localCommit === "saving") {
    return { synchronizationKind: "local-saving", locallyDurable: false };
  }
  if (input.importingRemote === true || input.updates.some(({ status }) => status === "sending")) {
    return { synchronizationKind: "syncing", locallyDurable: true };
  }
  if (!input.online) {
    return { synchronizationKind: "offline", locallyDurable: true };
  }
  if (input.updates.some(({ status }) => status === "pending")) {
    return { synchronizationKind: "pending", locallyDurable: true };
  }
  if (
    input.operationState !== null &&
    input.operationState.serverVersionVector !== null &&
    versionVectorDominates(
      input.operationState.serverVersionVector,
      input.operationState.versionVector,
    )
  ) {
    return { synchronizationKind: "synced", locallyDurable: true };
  }
  return { synchronizationKind: "local-saved", locallyDurable: true };
}

export function derivePageSyncState(input: DerivePageSyncStateInput): PageSyncState {
  const pendingCount = input.updates.filter(
    ({ status }) => status === "pending" || status === "sending" || status === "blocked",
  ).length;
  const attentionCount = input.ambiguities.filter(({ status }) => status === "open").length;
  const base = baseSyncState(input);
  const canSurfaceAttention =
    base.synchronizationKind !== "blocked" && base.synchronizationKind !== "local-saving";

  return {
    kind: attentionCount > 0 && canSurfaceAttention ? "attention" : base.synchronizationKind,
    synchronizationKind: base.synchronizationKind,
    pendingCount,
    attentionCount,
    locallyDurable: base.locallyDurable,
    ...(base.blockedReason === undefined ? {} : { blockedReason: base.blockedReason }),
  };
}
