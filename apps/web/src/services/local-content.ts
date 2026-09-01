/**
 * Offline-first content service (T045, US6).
 *
 * All reads come from the durable Dexie projection; all writes are applied
 * optimistically with a durable outbox entry, then reconciled with the
 * server when reachable. The interface never claims server durability for
 * local-only work: the observable sync state distinguishes offline, pending,
 * syncing, synced, conflict, and quota-failure (nothing was saved at all).
 */
import {
  applyLocalMutation,
  type DurablePageUpdateNotice,
  EncryptedPageOperationLog,
  installPageCheckpoint,
  LegacyConflictRecovery,
  LegacyPageEditingSession,
  LegacyPageStateStore,
  LocalCipher,
  type LocalDatabase,
  type LocalDatabaseEntryRow,
  LocalDatabaseRepository,
  type LocalDatabaseRow,
  LocalKeyManager,
  LocalPageStateStore,
  LocalRecordCodec,
  LocalRepository,
  Outbox,
  openBrowserPageTabChannel,
  openLocalDatabase,
  PageAuthorityRetiredError,
  PageEditingSession,
  type PageFileRequirement,
  type PageReconcileOutcome,
  PageReconciler,
  type PageTabChannel,
  PendingFileTransferStore,
  type ProjectedItem,
  type ReconcileTransport,
  reconcile,
  resealPlaintextProjection,
  resolveConflictLocally,
  resolveDatabaseDefinitionConflictLocally,
  resolveDatabaseEntryConflictLocally,
} from "@myownnotion/client-core";
import type {
  CreateDatabaseRequestDto,
  CreateEntryRequestDto,
  ItemDto,
  ReplaceDefinitionRequestDto,
  ReplaceEntryValuesRequestDto,
  RevisionDto,
} from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  type DatabaseImpactConfirmation,
  type DefinitionImpact,
  documentDigestV3,
  type EntryValues,
  generateUuidV7,
  migrateStoredPageDocumentToV3,
  type PageDocument,
  previewDefinitionImpact,
  type RelationTargets,
  readDocumentBody,
  type SafeError,
  type Uuid,
  upgradeLegacyBody,
} from "@myownnotion/domain";
import type { RawGraphNode, RawGraphSource } from "@myownnotion/graph";
import { ContentApi } from "./content-api.ts";
import { IndexedDbKeyStorage, subscribeLocalKeyStorageCleared } from "./local-key-storage.ts";
import { PageOperationsApi } from "./page-operations-api.ts";
import {
  type RealtimePageAdvance,
  RealtimePageSyncTransport,
  type RealtimePageSyncTransportOptions,
} from "./realtime-page-sync-transport.ts";
import { requestPersistentStorage } from "./storage-manager.ts";

/**
 * `quota-failure` means local persistence itself failed: the change was NOT
 * saved anywhere. It is distinct from `offline`, where the change is durable
 * locally and merely awaiting the server (FR-043).
 */
export type SyncState = "offline" | "pending" | "syncing" | "synced" | "conflict" | "quota-failure";

export type FileTransferStatusKind =
  | "queued"
  | "uploading"
  | "verifying"
  | "synchronized"
  | "blocked";

export interface FileTransferStatusSource {
  subscribe(
    listener: (states: ReadonlyMap<Uuid, { readonly kind: FileTransferStatusKind }>) => void,
  ): () => void;
}

function sameIds(left: ReadonlySet<Uuid>, right: ReadonlySet<Uuid>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/** Combines server proof and local transfer state without treating either as sufficient alone. */
export class FileSynchronizationStatus {
  readonly #requiredByPage = new Map<Uuid, ReadonlySet<Uuid>>();
  #transferPending = new Set<Uuid>();

  recordRequirements(pageId: Uuid, requirements: readonly PageFileRequirement[]): boolean {
    const next = new Set<Uuid>(
      requirements
        .filter(({ state }) => state === "upload-required")
        .map(({ fileId }) => fileId as Uuid),
    );
    const previous = this.#requiredByPage.get(pageId) ?? new Set<Uuid>();
    if (next.size === 0) this.#requiredByPage.delete(pageId);
    else this.#requiredByPage.set(pageId, next);
    return !sameIds(previous, next);
  }

  recordTransfers(states: ReadonlyMap<Uuid, { readonly kind: FileTransferStatusKind }>): {
    readonly changed: boolean;
    readonly completed: readonly Uuid[];
  } {
    const next = new Set<Uuid>();
    for (const [fileId, state] of states) {
      if (state.kind !== "synchronized") next.add(fileId);
    }
    const completed = [...this.#transferPending].filter((fileId) => !next.has(fileId));
    const changed = !sameIds(this.#transferPending, next);
    this.#transferPending = next;
    return { changed, completed };
  }

  get pendingIds(): ReadonlySet<Uuid> {
    const pending = new Set(this.#transferPending);
    for (const required of this.#requiredByPage.values()) {
      for (const fileId of required) pending.add(fileId);
    }
    return pending;
  }

  get hasServerRequirements(): boolean {
    return this.#requiredByPage.size > 0;
  }
}

// A reconnect after a long absence may discover many edited pages. Four
// independent exchanges keep progress moving without turning one browser tab
// into an unbounded burst against a small self-hosted server.
const PAGE_OPERATION_SYNC_CONCURRENCY = 4;

export interface LocalContentSnapshot {
  readonly syncState: SyncState;
  readonly pendingCount: number;
  readonly filePendingCount: number;
  readonly conflictCount: number;
  readonly attentionCount: number;
  readonly recoveryPendingCount: number;
  readonly quarantinedRecoveryCount: number;
  readonly storagePersisted: boolean | null;
}

export type OpenOperationalPageResult =
  | {
      readonly ok: true;
      /** `active`: shared operational state. `legacy-branch`: offline-first branch. */
      readonly mode: "active" | "legacy-branch";
      readonly session: PageEditingSession | LegacyPageEditingSession;
      readonly reconciler: PageReconciler;
      readonly close: () => void;
    }
  | {
      readonly ok: false;
      readonly offline: boolean;
      readonly code: string;
      readonly message: string;
    };

type SharedOpenedOperationalPage = Omit<
  Extract<OpenOperationalPageResult, { ok: true }>,
  "close"
> & {
  /** One mounted editor lease; releasing the last one closes its tab channel. */
  readonly acquire: () => () => void;
};
type OpenOperationalPageFailure = Extract<OpenOperationalPageResult, { ok: false }>;

function channelLease(channel: PageTabChannel): () => () => void {
  let leases = 0;
  let disposed = false;
  let disposalQueued = false;
  return () => {
    if (disposed) return () => undefined;
    leases += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      leases -= 1;
      if (leases !== 0 || disposalQueued) return;
      disposalQueued = true;
      queueMicrotask(() => {
        disposalQueued = false;
        if (leases !== 0 || disposed) return;
        disposed = true;
        channel.close();
      });
    };
  };
}

type OnlinePageActivationResult =
  | { readonly kind: "active" }
  | { readonly kind: "local-branch" }
  | {
      readonly kind: "failed";
      readonly offline: boolean;
      readonly code: string;
      readonly message: string;
    };

type WorkspacePageJournalState =
  | { readonly kind: "ready" }
  | {
      readonly kind: "pending";
      readonly offline: boolean;
      readonly problemCode: string;
    };

type Listener = () => void;
export type LocalProjectionChange =
  | { readonly kind: "upsert"; readonly itemIds: readonly Uuid[] }
  | { readonly kind: "rebuild" }
  | { readonly kind: "clear" };
type ProjectionListener = (change: LocalProjectionChange) => void | Promise<void>;

export interface LocalContentServiceOptions {
  readonly realtime?: Omit<RealtimePageSyncTransportOptions, "csrfToken" | "fallback">;
}

export class LocalContentService {
  readonly db: LocalDatabase;
  readonly repository: LocalRepository;
  readonly databases: LocalDatabaseRepository;
  readonly outbox: Outbox;
  readonly api: ContentApi;
  readonly pageOperationLog: EncryptedPageOperationLog;
  readonly pageStateStore: LocalPageStateStore;
  readonly pageOperationsApi: PageOperationsApi;
  readonly realtimePageSync: RealtimePageSyncTransport;
  readonly legacyConflictRecovery: LegacyConflictRecovery;
  readonly pendingFileTransfers: PendingFileTransferStore;
  #syncState: SyncState = "pending";
  #pendingCount = 0;
  #filePendingCount = 0;
  #conflictCount = 0;
  #attentionCount = 0;
  #recoveryPendingCount = 0;
  #quarantinedRecoveryCount = 0;
  #storagePersisted: boolean | null = null;
  #listeners = new Set<Listener>();
  #projectionListeners = new Set<ProjectionListener>();
  /** The complete reconciliation drain currently running, if any. See `synchronize`. */
  #inFlightSync: Promise<SyncState> | null = null;
  /** Set when a caller arrives mid-pass; triggers exactly one follow-up pass. */
  #resyncRequested = false;
  /** The complete operational-page drain currently running, if any. */
  #inFlightOperationalSync: Promise<boolean> | null = null;
  /** Coalesces every wake received while that operational drain is running. */
  #operationalResyncRequested = false;
  #snapshot: LocalContentSnapshot;
  readonly #keys: LocalKeyManager;
  readonly #codec: LocalRecordCodec;
  readonly #pageReconcilers = new Map<Uuid, PageReconciler>();
  readonly #fileSynchronization = new FileSynchronizationStatus();
  #fileTransferSource: FileTransferStatusSource | null = null;
  #unsubscribeFileTransfers: (() => void) | null = null;
  /** Mounted legacy editors own their conversion queue until they close. */
  readonly #legacyPageSessionLeases = new Map<Uuid, number>();
  readonly #openingPages = new Map<
    Uuid,
    Promise<SharedOpenedOperationalPage | OpenOperationalPageFailure>
  >();
  #pageCsrfToken: () => string | null = () => null;
  #unlocked: Promise<void> | null = null;
  #initialization: Promise<void> | null = null;

  constructor(
    api: ContentApi = new ContentApi(),
    databaseName = "myownnotion-local",
    options: LocalContentServiceOptions = {},
  ) {
    this.api = api;
    this.db = openLocalDatabase(databaseName);
    // The projection is sealed under a device key that never leaves this
    // origin. Established lazily on first use rather than in the constructor:
    // minting a key is asynchronous, and a constructor that cannot await would
    // have to hand out a codec that is not ready yet.
    this.#keys = new LocalKeyManager(new IndexedDbKeyStorage());
    const cipher = new LocalCipher(this.#keys);
    const operationContext = {
      installationId: databaseName,
      workspaceId: databaseName,
    };
    this.#codec = new LocalRecordCodec(cipher, operationContext);
    this.pageOperationLog = new EncryptedPageOperationLog(this.db, cipher, operationContext);
    this.pendingFileTransfers = new PendingFileTransferStore(this.db, cipher, operationContext);
    this.pageStateStore = new LocalPageStateStore(this.pageOperationLog, {
      requireCurrentPage: true,
    });
    this.pageOperationsApi = new PageOperationsApi({ csrfToken: () => this.#pageCsrfToken() });
    this.realtimePageSync = new RealtimePageSyncTransport({
      ...options.realtime,
      csrfToken: () => this.#pageCsrfToken(),
      fallback: this.pageOperationsApi,
    });
    this.repository = new LocalRepository(this.db, this.#codec);
    this.databases = new LocalDatabaseRepository(this.db, this.#codec);
    this.outbox = new Outbox(this.db, this.#codec);
    this.legacyConflictRecovery = new LegacyConflictRecovery({
      db: this.db,
      codec: this.#codec,
      log: this.pageOperationLog,
      loadRevision: async (revisionId) => {
        const result = await this.api.getRevision(revisionId);
        return result.ok
          ? { ok: true, value: result.value as unknown as RevisionDto }
          : { ok: false, offline: result.offline, code: result.problem.code };
      },
    });
    this.#snapshot = {
      syncState: "pending",
      pendingCount: 0,
      filePendingCount: 0,
      conflictCount: 0,
      attentionCount: 0,
      recoveryPendingCount: 0,
      quarantinedRecoveryCount: 0,
      storagePersisted: null,
    };
    subscribeLocalKeyStorageCleared(async () => {
      this.#keys.lock();
      await this.#emitProjection({ kind: "clear" });
    });
  }

  configurePageOperationAuthorization(csrfToken: () => string | null): void {
    this.#pageCsrfToken = csrfToken;
  }

  /** Proves whether a ready local file staging still has an editorial owner. */
  async isFileReferencedByPage(pageId: Uuid, fileItemId: Uuid): Promise<boolean> {
    await this.#unlock();
    const [state, branch] = await Promise.all([
      this.pageOperationLog.getState(pageId),
      this.pageOperationLog.getLegacyBranch(pageId),
    ]);
    return (
      state?.projection?.fileUsageIds.includes(fileItemId) === true ||
      branch?.requiredFileIds.includes(fileItemId) === true
    );
  }

  connectFileTransferStatus(source: FileTransferStatusSource): void {
    if (this.#fileTransferSource === source) return;
    this.#unsubscribeFileTransfers?.();
    this.#fileTransferSource = source;
    this.#unsubscribeFileTransfers = source.subscribe((states) => {
      const update = this.#fileSynchronization.recordTransfers(states);
      if (update.changed) void this.#notify();
      if (update.completed.length > 0) {
        // The byte 201 is local knowledge. Poll the affected open page states
        // so their next response can replace upload-required with server proof.
        queueMicrotask(() => void this.synchronizeOperationalPages());
      }
    });
  }

  pageReconciler(pageId: Uuid): PageReconciler {
    let reconciler = this.#pageReconcilers.get(pageId);
    if (reconciler === undefined) {
      reconciler = new PageReconciler({
        pageId,
        log: this.pageOperationLog,
        transport: this.realtimePageSync,
        // Search, backlinks and every projection consumer must observe the
        // same verified operational document as the editor. A server response
        // updates the encrypted page state independently from the workspace
        // outbox, so it needs its own projection notification.
        onDurablePage: async () => {
          await this.#emitProjection({ kind: "upsert", itemIds: [pageId] });
          // Accepting page operations also records a workspace change carrying
          // the new canonical revision head. Import it before the page exchange
          // may call itself synchronized: otherwise history/settings can still
          // hold the previous item revision for a few seconds and manufacture
          // a stale-base refusal immediately after this device's own edit.
          //
          // `synchronize()` is serialized and coalesced, so a simultaneous SSE
          // wake-up joins this exact catch-up instead of racing another outbox
          // pass. Its notifier also keeps unrelated workspace/page work visible
          // as pending and preserves offline/conflict truth.
          await this.synchronize();
        },
        onFileRequirements: (requirements) => {
          if (this.#fileSynchronization.recordRequirements(pageId, requirements)) {
            void this.#notify();
          }
        },
      });
      this.#pageReconcilers.set(pageId, reconciler);
    }
    return reconciler;
  }

  /**
   * Treats a live announcement as a wake-up, never as page content.
   *
   * The encrypted local frontier decides whether any work is needed. Repeated
   * or out-of-order announcements therefore remain harmless, and a closed page
   * with no local operational state is left lazy until the owner opens it.
   */
  async reconcileRealtimePageAdvance(event: RealtimePageAdvance): Promise<boolean> {
    await this.#unlock();
    const state = await this.pageOperationLog.getState(event.pageId);
    if (state === null || state.latestServerPageSequence >= event.latestPageSequence) {
      return true;
    }
    const outcome = await this.pageReconciler(event.pageId).synchronize();
    await this.#notify(
      outcome.kind === "offline"
        ? "offline"
        : outcome.kind === "blocked"
          ? "conflict"
          : outcome.kind === "pending"
            ? "pending"
            : "synced",
    );
    return outcome.kind === "synced";
  }

  /**
   * Establishes the device key once, and reseals a plaintext projection.
   *
   * Idempotent by the stored promise rather than by a boolean: two callers
   * arriving together must not both mint a key, and the second must wait for
   * the first rather than proceed against a codec that cannot seal yet.
   */
  async #unlock(): Promise<void> {
    this.#unlocked ??= (async () => {
      await this.#keys.establish();
      await resealPlaintextProjection(this.db, this.#codec);
    })();
    await this.#unlocked;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): LocalContentSnapshot => this.#snapshot;

  subscribeProjection = (listener: ProjectionListener): (() => void) => {
    this.#projectionListeners.add(listener);
    return () => this.#projectionListeners.delete(listener);
  };

  async #emitProjection(change: LocalProjectionChange): Promise<void> {
    await Promise.all(
      [...this.#projectionListeners].map(async (listener) => await listener(change)),
    );
  }

  async #notify(state?: SyncState): Promise<void> {
    if (state !== undefined) {
      this.#syncState = state;
    }
    const [
      workspaceRows,
      workspaceConflicts,
      pageUpdates,
      legacyBranches,
      recoveries,
      pageAmbiguities,
    ] = await Promise.all([
      this.outbox.all(),
      this.outbox.activeConflicts(),
      this.pageOperationLog.countUpdates(["pending", "sending", "blocked"]),
      this.db.legacyOfflineBranches
        .where("status")
        .anyOf("editing", "sending", "blocked")
        .toArray(),
      this.db.legacySyncRecoveries.toArray(),
      this.db.pageAmbiguities.where("status").equals("open").count(),
    ]);
    this.#recoveryPendingCount = recoveries.filter(({ status }) =>
      ["pending", "converting"].includes(status),
    ).length;
    this.#quarantinedRecoveryCount = recoveries.filter(
      ({ status }) => status === "quarantined",
    ).length;
    // A recovery owns the same encrypted legacy branch, so count the logical
    // draft once. A quarantined branch is attention, not active work: keeping
    // it in “pending” would recreate the endless retry symptom it just left.
    const recoveryBranchIds = new Set(
      recoveries
        .filter(
          ({ status, branchId }) =>
            ["converting", "quarantined"].includes(status) && branchId !== null,
        )
        .map(({ branchId }) => branchId),
    );
    const independentLegacyBranches = legacyBranches.filter(
      ({ branchId }) => !recoveryBranchIds.has(branchId),
    ).length;
    const workspaceWork = workspaceRows.filter(({ status }) =>
      ["pending", "sending", "blocked"].includes(status),
    );
    this.#filePendingCount = this.#fileSynchronization.pendingIds.size;
    this.#pendingCount =
      workspaceWork.length +
      pageUpdates +
      independentLegacyBranches +
      this.#recoveryPendingCount +
      this.#filePendingCount;
    this.#conflictCount = workspaceConflicts.length + pageAmbiguities;
    this.#attentionCount = this.#conflictCount + this.#quarantinedRecoveryCount;
    if (this.#pendingCount > 0 && this.#syncState === "synced") {
      this.#syncState = "pending";
    }
    if (
      this.#attentionCount > 0 &&
      this.#syncState !== "offline" &&
      // A failed local save is the more urgent truth: never mask it.
      this.#syncState !== "quota-failure"
    ) {
      this.#syncState = "conflict";
    }
    const next: LocalContentSnapshot = {
      syncState: this.#syncState,
      pendingCount: this.#pendingCount,
      filePendingCount: this.#filePendingCount,
      conflictCount: this.#conflictCount,
      attentionCount: this.#attentionCount,
      recoveryPendingCount: this.#recoveryPendingCount,
      quarantinedRecoveryCount: this.#quarantinedRecoveryCount,
      storagePersisted: this.#storagePersisted,
    };
    // Replaced only when something actually differs, and this is not an
    // optimisation. `useSyncExternalStore` compares snapshots by reference, so
    // handing out a fresh object for an unchanged state re-renders every
    // subscriber — including the whole content tree.
    //
    // That was survivable while notifications were rare: a device only ever
    // notified itself, when it wrote. Live synchronization made every change
    // anywhere in the workspace produce one, and a tree that re-renders under
    // somebody's cursor is a click that never lands — Playwright reported it as
    // `element was detached from the DOM, retrying`, forever, until the test
    // gave up after a minute.
    if (
      next.syncState !== this.#snapshot.syncState ||
      next.pendingCount !== this.#snapshot.pendingCount ||
      next.filePendingCount !== this.#snapshot.filePendingCount ||
      next.conflictCount !== this.#snapshot.conflictCount ||
      next.attentionCount !== this.#snapshot.attentionCount ||
      next.recoveryPendingCount !== this.#snapshot.recoveryPendingCount ||
      next.quarantinedRecoveryCount !== this.#snapshot.quarantinedRecoveryCount ||
      next.storagePersisted !== this.#snapshot.storagePersisted
    ) {
      this.#snapshot = next;
    }
    // Listeners are told regardless, because they are not all watching the
    // snapshot: the content tree uses this signal to re-read its items, and a
    // change arriving from another device moves items without moving any of the
    // four fields above. Suppressing the call would leave the tree stale, which
    // is the one thing live synchronization exists to prevent.
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #transport(): ReconcileTransport {
    return {
      submitMutationBatch: async (mutations) => {
        const result = await this.api.submitMutationBatch(mutations);
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, offline: result.offline };
      },
      listChanges: async (after, limit) => {
        const result = await this.api.listChanges(after, limit);
        if (result.ok) {
          return { ok: true, value: result.value };
        }
        return {
          ok: false,
          offline: result.offline,
          compacted: result.problem.code === "cursor.compacted",
        };
      },
      currentSnapshot: async () => {
        const result = await this.api.currentSnapshot();
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, offline: result.offline };
      },
      // Only the automatic merge uses this, and only when an edit was refused.
      // A revision whose snapshot has passed its retention window comes back as
      // a failure here, which the merge reads as "cannot be merged safely" and
      // turns into a conflict the owner decides — never into a guess.
      getRevision: async (revisionId) => {
        const result = await this.api.getRevision(revisionId);
        return result.ok
          ? { ok: true, value: result.value as unknown as RevisionDto }
          : { ok: false, offline: result.offline };
      },
    };
  }

  /** Opens local storage and reconciles once; concurrent boot callers coalesce. */
  async initialize(): Promise<void> {
    const initialization =
      this.#initialization ??
      (async () => {
        await this.db.open();
        await this.#unlock();
        // Classify before the first aggregate status. Otherwise an old
        // whole-document refusal flashes as a current collaboration conflict
        // even though v3 owns the page and recovery can proceed automatically.
        await this.legacyConflictRecovery.classify();
        await this.synchronize();
        await this.synchronizeOperationalPages();
        // Persistence is an eviction hint, not a content-readiness gate. Some
        // Firefox profiles leave this browser permission unsettled; update the
        // diagnostic when it answers without keeping the workspace behind it.
        void requestPersistentStorage()
          .then(async (persisted) => {
            this.#storagePersisted = persisted;
            await this.#notify();
          })
          .catch(() => {
            // The helper already maps browser failures to `null`; this catch is
            // for a later notification failure and cannot invalidate the sync
            // that made the workspace ready.
          });
      })();
    this.#initialization = initialization;
    try {
      await initialization;
    } catch (error) {
      // A transient storage/key failure must remain retryable by a later boot
      // attempt, while successful initialization stays a one-time boundary.
      if (this.#initialization === initialization) this.#initialization = null;
      throw error;
    }
  }

  /**
   * Drains operational page queues independently from mounted editors.
   *
   * Open pages are included so a change-feed announcement imports their
   * remote deltas. More importantly, the status-first local index discovers
   * pages with durable pending work after a reload: their reconciler map is
   * empty at that point, and requiring the owner to reopen each document would
   * turn crash recovery into a manual synchronization protocol (FR-073).
   */
  async synchronizeOperationalPages(): Promise<boolean> {
    if (this.#inFlightOperationalSync !== null) {
      this.#operationalResyncRequested = true;
      return await this.#inFlightOperationalSync;
    }
    let shared!: Promise<boolean>;
    shared = this.#drainOperationalPageSynchronization().finally(() => {
      if (this.#inFlightOperationalSync === shared) this.#inFlightOperationalSync = null;
    });
    this.#inFlightOperationalSync = shared;
    return await shared;
  }

  async #drainOperationalPageSynchronization(): Promise<boolean> {
    let settled = false;
    do {
      this.#operationalResyncRequested = false;
      settled = await this.#runOperationalPageSynchronization();
    } while (this.#operationalResyncRequested);
    return settled;
  }

  async #runOperationalPageSynchronization(): Promise<boolean> {
    await this.#unlock();
    const historicalPageConflicts = await this.db.conflicts
      .filter(({ commandType }) => commandType === "page.document.replace")
      .count();
    // One pass can finish one historical row per page. The extra pass proves
    // that no pending/converting recovery remains; the bound comes from the
    // durable source rows, never from an open-ended retry loop.
    const maxPasses = Math.max(1, historicalPageConflicts + 1);
    for (let attempt = 0; attempt < maxPasses; attempt += 1) {
      const recovery = await this.legacyConflictRecovery.recoverAvailable();
      if (recovery.offline) {
        await this.#notify("offline");
        return false;
      }
      const settled = await this.#synchronizeOperationalPagePass();
      const recoveryWorkRemaining = await this.db.legacySyncRecoveries
        .where("status")
        .anyOf("pending", "converting")
        .count();
      if (recoveryWorkRemaining === 0) return settled;
      if (!settled) return false;
    }
    await this.#notify("pending");
    return false;
  }

  async #synchronizeOperationalPagePass(): Promise<boolean> {
    const [queuedPageIds, legacyPageIds] = await Promise.all([
      this.pageOperationLog.listPageIdsWithUpdates(),
      this.pageOperationLog.listPageIdsWithLegacyBranches(),
    ]);
    const legacyPages = new Set(legacyPageIds);
    const pageIds = [
      ...new Set<Uuid>([...this.#pageReconcilers.keys(), ...queuedPageIds, ...legacyPageIds]),
    ].sort();
    if (pageIds.length === 0) {
      await this.#notify();
      return true;
    }

    await this.#notify("syncing");
    let settled = true;
    let offline = false;
    for (let offset = 0; offset < pageIds.length; offset += PAGE_OPERATION_SYNC_CONCURRENCY) {
      const batch = pageIds.slice(offset, offset + PAGE_OPERATION_SYNC_CONCURRENCY);
      const outcomes = await Promise.all(
        batch.map(async (pageId) => {
          try {
            const reconciler = this.pageReconciler(pageId);
            if (legacyPages.has(pageId)) {
              const branch = await this.pageOperationLog.getLegacyBranch(pageId);
              if (branch !== null && branch.status !== "converted") {
                // A mounted legacy editor serializes conversion with gestures.
                // Once it closes there are no gestures left to race, so the
                // durable branch itself becomes the resume token and the
                // service may convert it headlessly on boot/reconnection.
                if ((this.#legacyPageSessionLeases.get(pageId) ?? 0) > 0) {
                  return "delegated" as const;
                }
                return (await this.#convertLegacyBranchAfterWorkspace(pageId, reconciler)).kind;
              }
            }
            return (await reconciler.synchronize()).kind;
          } catch {
            return "pending" as const;
          }
        }),
      );
      if (outcomes.some((outcome) => outcome === "offline")) {
        offline = true;
        settled = false;
        // One offline batch is enough evidence. Do not fan the same unavailable
        // transport out over every remaining page on this reconnect attempt.
        break;
      }
      if (
        outcomes.some(
          (outcome) => outcome !== "synced" && outcome !== "blocked" && outcome !== "delegated",
        )
      ) {
        settled = false;
      }
    }

    const [stillQueued, stillLegacyBranches, recoveries] = await Promise.all([
      this.pageOperationLog.countUpdates(["pending", "sending"]),
      this.db.legacyOfflineBranches
        .where("status")
        .anyOf("editing", "sending", "blocked")
        .toArray(),
      this.db.legacySyncRecoveries.toArray(),
    ]);
    const recoveryBranchIds = new Set(
      recoveries
        .filter(
          ({ status, branchId }) =>
            ["converting", "quarantined"].includes(status) && branchId !== null,
        )
        .map(({ branchId }) => branchId),
    );
    const durableWorkRemaining =
      stillQueued +
      stillLegacyBranches.filter(({ branchId }) => !recoveryBranchIds.has(branchId)).length;
    await this.#notify(
      offline ? "offline" : settled && durableWorkRemaining === 0 ? "synced" : "pending",
    );
    return !offline && settled && durableWorkRemaining === 0;
  }

  /**
   * Drains workspace writes that define the page body before v3 takes over.
   *
   * A new page and a historical full-document write do not exist in the
   * operational journal yet. Activating before those rows are accepted would
   * seed the CRDT from an older server projection and leave two authorities
   * for the same content. A retained conflict is also a hard boundary: the
   * local body remains recoverable and must not be hidden by activation.
   */
  async #settleWorkspacePageJournal(pageId: Uuid): Promise<WorkspacePageJournalState> {
    const belongsToPage = (row: {
      readonly commandType: string;
      readonly payload: Record<string, unknown>;
    }): boolean =>
      (row.commandType === "item.create" && row.payload["id"] === pageId) ||
      (["page.document.replace", "document.resolve-conflict", "item.convert"].includes(
        row.commandType,
      ) &&
        row.payload["itemId"] === pageId);
    let [workspaceRows, workspaceConflicts] = await Promise.all([
      this.outbox.all(),
      this.outbox.activeConflicts(),
    ]);
    if (workspaceRows.some(belongsToPage)) {
      const workspaceState = await this.synchronize();
      if (workspaceState === "offline" || workspaceState === "quota-failure") {
        return {
          kind: "pending",
          offline: workspaceState === "offline",
          problemCode: `workspace.${workspaceState}`,
        };
      }
      [workspaceRows, workspaceConflicts] = await Promise.all([
        this.outbox.all(),
        this.outbox.activeConflicts(),
      ]);
    }
    if (workspaceRows.some(belongsToPage) || workspaceConflicts.some(belongsToPage)) {
      return {
        kind: "pending",
        offline: false,
        problemCode: "page-operations.workspace-base-pending",
      };
    }
    return { kind: "ready" };
  }

  /**
   * Crosses the v2 workspace journal before converting a v3 semantic branch.
   *
   * Newly created pages and upgraded whole-document edits can still have a
   * workspace mutation in flight. The semantic branch is based on the result
   * of that mutation, so it may cross the protocol boundary only after the
   * relevant row has either been accepted or retained visibly as a conflict.
   * The same barrier serves a mounted editor and a closed-page resume pass.
   */
  async #convertLegacyBranchAfterWorkspace(
    pageId: Uuid,
    reconciler: PageReconciler,
  ): Promise<PageReconcileOutcome> {
    const journal = await this.#settleWorkspacePageJournal(pageId);
    if (journal.kind === "pending") {
      return {
        kind: journal.offline ? "offline" : "pending",
        exchanges: 0,
        latestPageSequence: 0,
        fileRequirements: [],
        problemCode: journal.problemCode,
      };
    }
    return await reconciler.convertLegacyBranch();
  }

  /**
   * Full reconciliation pass; resolves to the resulting sync state.
   *
   * Passes are serialized and coalesced. Two concurrent passes used to be
   * possible — `mutate()` fires one per mutation and does not await it — and
   * they corrupt each other: `reconcile()` starts with
   * `outbox.recoverInterrupted()`, which resets every `sending` row to
   * `pending`, and it cannot tell "interrupted by a reload" from "in flight
   * right now in the other pass". A row could therefore be handed to a pass
   * that had already drained past it and be left `pending` with nobody to
   * resubmit it — the workspace then sits on "1 pending" indefinitely.
   *
   * While a pass is running, callers join the complete drain. A caller that
   * arrives during a pass also sets `#resyncRequested`, so exactly one
   * follow-up pass runs afterwards and drains anything enqueued in the
   * meantime. Every joined caller waits for that follow-up, which matters to
   * activation barriers that must prove a page creation has reached the server
   * before seeding operational history. One extra pass is enough regardless of
   * how many callers arrived, because the follow-up observes the queue as it
   * stands when it starts.
   */
  async synchronize(): Promise<SyncState> {
    if (this.#inFlightSync !== null) {
      this.#resyncRequested = true;
      return await this.#inFlightSync;
    }
    let shared!: Promise<SyncState>;
    shared = this.#drainSynchronization().finally(() => {
      if (this.#inFlightSync === shared) this.#inFlightSync = null;
    });
    this.#inFlightSync = shared;
    return await shared;
  }

  async #drainSynchronization(): Promise<SyncState> {
    let state: SyncState = "pending";
    do {
      this.#resyncRequested = false;
      state = await this.#runSynchronize();
    } while (this.#resyncRequested);
    return state;
  }

  async #runSynchronize(): Promise<SyncState> {
    // The outbox is sealed too. Restore the persisted device key before the
    // first notification reads queue counts; doing this in the opposite order
    // worked only while outbox payloads were plaintext and left every reload
    // stuck on the loading screen once they became protected.
    await this.#unlock();
    await this.#notify("syncing");
    const outcome = await reconcile(this.db, this.#transport(), this.#codec);
    const historical = await this.legacyConflictRecovery.classify();
    if (historical.classified > 0) {
      // Do not await from inside the serialized workspace drain: converting a
      // legacy branch first verifies that this very drain has settled. The
      // microtask starts after the owner promise unwinds and therefore cannot
      // deadlock on itself.
      queueMicrotask(() => void this.synchronizeOperationalPages());
    }
    if (!outcome.offline && this.#fileSynchronization.hasServerRequirements) {
      // A workspace change may be the missing file arriving from another
      // device. Page bodies use their own channel, so explicitly re-check the
      // outstanding server requirements after that metadata catch-up.
      queueMicrotask(() => void this.synchronizeOperationalPages());
    }
    await this.#emitProjection({ kind: "rebuild" });
    const state: SyncState = outcome.offline
      ? "offline"
      : (await this.outbox.activeConflicts()).length > 0
        ? "conflict"
        : outcome.retained > 0
          ? "pending"
          : "synced";
    await this.#notify(state);
    return state;
  }

  async listActiveItems(): Promise<ProjectedItem[]> {
    return this.repository.listItems("active");
  }

  async getKnowledgeGraphTopology(): Promise<RawGraphSource> {
    await this.#unlock();
    return await this.repository.readKnowledgeGraphTopology();
  }

  async hydrateKnowledgeGraphNodes(itemIds: readonly Uuid[]): Promise<RawGraphNode[]> {
    await this.#unlock();
    return await this.repository.hydrateKnowledgeGraphNodes(itemIds);
  }

  async listTrashedItems(): Promise<ProjectedItem[]> {
    return this.repository.listItems("trashed");
  }

  async getItem(itemId: Uuid): Promise<ProjectedItem | null> {
    return this.repository.getItem(itemId);
  }

  /**
   * Finishes the page protocol handover before retiring its page authority.
   *
   * A newly opened page can still be activating or submitting its bootstrap
   * paragraph while the owner chooses "convert to folder" from the tree. The
   * conversion itself is atomic, but allowing its workspace mutation to race
   * that final page exchange makes the client observe two legitimate server
   * changes in the opposite local order and retain a false conflict. Waiting
   * here keeps the destructive boundary linear: everything already durable in
   * the page journal is reconciled and its canonical workspace head is pulled
   * before the conversion snapshots and retires that journal.
   *
   * Offline remains supported. Both drains return their honest offline state;
   * the following local conversion still commits atomically and synchronizes
   * when connectivity returns.
   */
  async #settlePageBeforeFolderConversion(itemId: Uuid): Promise<void> {
    const opening = this.#openingPages.get(itemId);
    if (opening !== undefined) await opening;

    const reconciler = this.#pageReconcilers.get(itemId);
    if (reconciler !== undefined) await reconciler.synchronize();

    // A successful page exchange records its canonical revision through the
    // workspace feed. This also joins any callback/SSE catch-up already in
    // flight, so the conversion starts from one fully observed frontier.
    await this.synchronize();

    // The operational journal remains the freshest authority while offline.
    // Cache its exact projection into the item row before local conversion so
    // the shared destructive-content predicate can still demand confirmation
    // for text that has not reached the server yet.
    const state = await this.pageOperationLog.getState(itemId);
    if (state?.projection !== null && state?.projection !== undefined) {
      await this.repository.cacheOperationalPageProjection(itemId, state.projection.document);
    }
  }

  /**
   * Opens (activating if needed) the durable editing session for one page.
   *
   * Concurrent callers for the same page share one in-flight open. React
   * strict effects and a double click both land here, and two parallel opens
   * would each seed an empty page with its own first paragraph — two blocks
   * where one belongs, merged permanently by the CRDT. The durable-page
   * subscription stays per caller: each mounted editor subscribes and
   * unsubscribes on its own, so one surface closing never blinds another.
   */
  async openOperationalPage(itemId: Uuid): Promise<OpenOperationalPageResult> {
    const inFlight = this.#openingPages.get(itemId);
    if (inFlight !== undefined) {
      const shared = await inFlight;
      if (!shared.ok) return shared;
      return this.#attachToOpenedPage(shared);
    }
    const opened: Promise<SharedOpenedOperationalPage | OpenOperationalPageFailure> =
      this.#openOperationalPageOnce(itemId).finally(() => {
        this.#openingPages.delete(itemId);
      });
    this.#openingPages.set(itemId, opened);
    const shared = await opened;
    if (!shared.ok) return shared;
    return this.#attachToOpenedPage(shared);
  }

  #attachToOpenedPage(
    shared: SharedOpenedOperationalPage,
  ): Extract<OpenOperationalPageResult, { ok: true }> {
    const { session, reconciler, mode } = shared;
    const releaseShared = shared.acquire();
    if (mode === "legacy-branch") {
      this.#legacyPageSessionLeases.set(
        session.pageId,
        (this.#legacyPageSessionLeases.get(session.pageId) ?? 0) + 1,
      );
    }
    const unsubscribe = reconciler.subscribeDurablePage(async (durableState) => {
      if (durableState.status !== "active") return;
      // Both session kinds upgrade in place: an active session merges remote
      // checkpoints, and a legacy session hands over to its resumed active
      // successor on the same serial queue as gestures (plan §6, FR-064).
      if ("adoptDurablePage" in session) await session.adoptDurablePage();
    });
    // A legacy branch manages its own conversion at queue drain points; an
    // out-of-band synchronize here could convert behind the session's back.
    if (mode === "active") void reconciler.synchronize();
    let closed = false;
    return {
      ok: true,
      mode,
      session,
      reconciler,
      close: () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        releaseShared();
        if (mode === "legacy-branch") {
          const leases = this.#legacyPageSessionLeases.get(session.pageId) ?? 0;
          if (leases <= 1) this.#legacyPageSessionLeases.delete(session.pageId);
          else this.#legacyPageSessionLeases.set(session.pageId, leases - 1);
        }
      },
    };
  }

  #openPageTabChannel(
    itemId: Uuid,
    session: PageEditingSession | LegacyPageEditingSession,
    reconciler: PageReconciler,
  ): PageTabChannel {
    return openBrowserPageTabChannel({
      workspaceId: this.db.name,
      pageId: itemId,
      peerId: session.peerId,
      persistIncoming: async (notice) => {
        // BroadcastChannel is only a wake-up path. The session verifies the
        // encrypted IndexedDB row/frontier and adopts that authority instead
        // of importing message bytes directly.
        await session.adoptDurableUpdate(notice);
        await this.#emitProjection({ kind: "upsert", itemIds: [itemId] });
        await this.#notify();
        // If the sender owned the page transport this waits on its Web Lock;
        // closing/crashing that tab releases the lock and this owner retries
        // the same immutable update id immediately.
        void reconciler.synchronize();
      },
    });
  }

  async #openOperationalPageOnce(
    itemId: Uuid,
  ): Promise<SharedOpenedOperationalPage | OpenOperationalPageFailure> {
    await this.#unlock();
    let state = await this.pageOperationLog.getState(itemId);
    const retainedLegacyBranch = await this.pageOperationLog.getLegacyBranch(itemId);
    if (retainedLegacyBranch !== null && retainedLegacyBranch.status !== "converted") {
      // The durable branch is this device's unsynchronized authority. Opening
      // an already-active server checkpoint in parallel with its conversion
      // can install the remote-only projection first and let the editor claim
      // it is synchronized before the retained local words are visible. Route
      // through the branch before any remote read; tryOpen handles the narrow
      // case where a background reconciler finishes conversion meanwhile.
      return await this.#openLegacyBranchSession(
        itemId,
        retainedLegacyBranch.branch.baseDocumentV2,
      );
    }
    const online = typeof navigator === "undefined" ? true : navigator.onLine;
    // A page can exist optimistically before the workspace mutation that
    // creates or converts it has committed on the server. Crossing into the
    // operational API before that mutation settles produces a legitimate
    // `page-operations.not-active`; a following item read can then import the
    // older server folder over the optimistic page. Drain that page's workspace
    // journal before *any* remote page read, not only immediately before
    // activation. Offline or blocked work keeps using the durable local branch.
    const workspaceJournal =
      state === null
        ? await this.#settleWorkspacePageJournal(itemId)
        : ({ kind: "ready" } as const);
    const operationalTransportReady = online && workspaceJournal.kind === "ready";
    if (state === null && operationalTransportReady) {
      const checkpoint = await this.pageOperationsApi.checkpoint(itemId, generateUuidV7());
      if (checkpoint.ok) {
        state = await this.#installOperationalCheckpoint(itemId, checkpoint.value);
        if (state === null) {
          return {
            ok: false,
            offline: false,
            code: "item.not-found",
            message: "This item is no longer an editable page.",
          };
        }
      } else if (!checkpoint.offline && checkpoint.problem.code !== "page-operations.not-active") {
        return {
          ok: false,
          offline: false,
          code: checkpoint.problem.code,
          message: checkpoint.problem.message,
        };
      }
    }
    if (state === null) {
      let item = await this.repository.getItem(itemId);
      if (item === null || item.kind !== "page") {
        return {
          ok: false,
          offline: false,
          code: "item.not-found",
          message: "This page is not available on this device.",
        };
      }
      if (item.localAvailability !== "present" || item.pageDocument === null) {
        if (operationalTransportReady) {
          const remote = await this.api.getItem(itemId);
          if (remote.ok) {
            await this.repository.applyServerItems([remote.value]);
            item = await this.repository.getItem(itemId);
          } else {
            return {
              ok: false,
              offline: remote.offline,
              code: remote.problem.code,
              message: remote.problem.detail ?? remote.problem.title,
            };
          }
        }
        if (
          item === null ||
          item.kind !== "page" ||
          item.localAvailability !== "present" ||
          item.pageDocument === null
        ) {
          return {
            ok: false,
            offline: !online,
            code: "content.not-available-locally",
            message:
              item?.localAvailability === "offloaded"
                ? "This page was released from this device and needs a connection to download again."
                : "This page has not been downloaded to this device yet.",
          };
        }
      }
      const stored = item.pageDocument ?? {
        format: "myownnotion.document+json" as const,
        formatVersion: 2,
        body: {},
      };
      const migrated = migrateStoredPageDocumentToV3(stored);
      if (!migrated.ok) {
        return {
          ok: false,
          offline: false,
          code: "page-operations.projection-invalid",
          message: "This page cannot be activated without reducing its content.",
        };
      }
      if (operationalTransportReady) {
        const activation = await this.#activateOnlinePage(itemId);
        if (activation.kind === "active") {
          return await this.#openActivePageSession(itemId, true);
        }
        if (activation.kind === "failed") {
          return {
            ok: false,
            offline: activation.offline,
            code: activation.code,
            message: activation.message,
          };
        }
      }
      // A genuinely disconnected page remains fully editable. Its semantic
      // branch is durable and later converts into the shared CRDT history; it
      // is no longer the normal online bridge for every historical page.
      return await this.#openLegacyBranchSession(itemId, stored.body);
    }

    return await this.#openActivePageSession(itemId, online);
  }

  async #installOperationalCheckpoint(
    itemId: Uuid,
    checkpoint: Parameters<typeof installPageCheckpoint>[1],
  ) {
    const state = await installPageCheckpoint(this.pageOperationLog, checkpoint);
    if (state === null) return null;
    if (state.projection !== null) {
      const cached = await this.repository.cacheOperationalPageProjection(
        itemId,
        state.projection.document,
      );
      if (!cached) return null;
    }
    await this.#emitProjection({ kind: "upsert", itemIds: [itemId] });
    return state;
  }

  /**
   * Activates a connected page from the server's current canonical head.
   *
   * The direct item read is intentional. Workspace metadata can be optimistic
   * while the page body is already canonical, and its local revision id is not
   * proof of the server head. Activating from that stale id would manufacture
   * an avoidable compatibility branch. A bounded stale retry covers the one
   * remaining race: a legacy client changing the canonical page between the
   * read and the atomic activation transaction.
   */
  async #activateOnlinePage(itemId: Uuid): Promise<OnlinePageActivationResult> {
    const journal = await this.#settleWorkspacePageJournal(itemId);
    if (journal.kind === "pending") return { kind: "local-branch" };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remote = await this.api.getItem(itemId);
      if (!remote.ok) {
        if (remote.offline) return { kind: "local-branch" };
        return {
          kind: "failed",
          offline: false,
          code: remote.problem.code,
          message: remote.problem.detail ?? remote.problem.title,
        };
      }
      if (remote.value.kind !== "page" || remote.value.pageDocument == null) {
        return {
          kind: "failed",
          offline: false,
          code: "item.not-found",
          message: "This item is no longer an editable page.",
        };
      }
      const migrated = migrateStoredPageDocumentToV3(remote.value.pageDocument);
      if (!migrated.ok) {
        return {
          kind: "failed",
          offline: false,
          code: "page-operations.projection-invalid",
          message: "This page cannot be activated without reducing its content.",
        };
      }
      const activation = await this.pageOperationsApi.activate(itemId, {
        requestId: generateUuidV7(),
        expectedRevisionId: remote.value.currentRevisionId as Uuid,
        expectedCanonicalDigest: await documentDigestV3(migrated.document),
      });
      if (activation.ok) {
        const installed = await this.#installOperationalCheckpoint(itemId, activation.value);
        if (installed === null) {
          return {
            kind: "failed",
            offline: false,
            code: "item.not-found",
            message: "This item is no longer an editable page.",
          };
        }
        return { kind: "active" };
      }
      if (activation.offline) return { kind: "local-branch" };
      if (activation.problem.code === "page-operations.activation-stale") continue;
      return {
        kind: "failed",
        offline: false,
        code: activation.problem.code,
        message: activation.problem.message,
      };
    }
    // The server is reachable, so manufacturing an offline branch here would
    // recreate the compatibility path this activation removes. Keep the
    // failure explicit; a later open can retry after the competing writer has
    // stopped without accepting gestures against a head we could not verify.
    return {
      kind: "failed",
      offline: false,
      code: "page-operations.activation-stale",
      message: "The page kept changing while operational synchronization was activated.",
    };
  }

  /**
   * Resumes the durable operational owner after activation or branch
   * conversion. The state is deliberately re-read here: conversion can finish
   * between the routing reads in `#openOperationalPageOnce` and the final
   * editor open, especially while a background synchronization pass is
   * running on a slow device.
   */
  async #openActivePageSession(
    itemId: Uuid,
    online: boolean,
  ): Promise<SharedOpenedOperationalPage | OpenOperationalPageFailure> {
    const state = await this.pageOperationLog.getState(itemId);
    const reconciler = this.pageReconciler(itemId);
    let tabChannel: PageTabChannel | null = null;
    const session = await PageEditingSession.resume({
      pageId: itemId,
      log: this.pageOperationLog,
      store: this.pageStateStore,
      online,
      publishDurableUpdate: (notice: DurablePageUpdateNotice) => {
        tabChannel?.publishUpdate(notice);
        void this.#emitProjection({ kind: "upsert", itemIds: [itemId] });
        // Derive pending from the durable queues. This callback is deliberately
        // fire-and-forget; forcing the state before its IndexedDB reads finish
        // can otherwise overwrite a newer server-confirmed `synced` state.
        void this.#notify();
        void reconciler.synchronize();
      },
    });
    if (state === null || session === null) {
      return {
        ok: false,
        offline: false,
        code: "page-operations.local-state-missing",
        message: "The local operational checkpoint is unavailable.",
      };
    }
    tabChannel = this.#openPageTabChannel(itemId, session, reconciler);
    // An active page with no blocks cannot mount in BlockNote. The first
    // paragraph is seeded as a real committed transaction — not faked in the
    // editor — so its identity lives in the operational state and every
    // device converges on it. This is only reachable when the empty state came
    // from elsewhere (another device's conversion); a locally pristine page
    // opens on the legacy branch above and seeds nothing durable.
    if (state.status === "active" && session.read().blocks.length === 0) {
      try {
        await session.transact({
          type: "insert-block",
          block: { type: "paragraph", id: generateUuidV7(), content: [] },
          parentBlockId: null,
          beforeBlockId: null,
        });
      } catch (error) {
        if (error instanceof PageAuthorityRetiredError) {
          return {
            ok: false,
            offline: false,
            code: "item.not-found",
            message: "This item is no longer an editable page.",
          };
        }
        throw error;
      }
    }
    return {
      ok: true,
      mode: "active",
      session,
      reconciler,
      acquire: channelLease(tabChannel),
    };
  }

  /**
   * Opens a never-activated page for offline editing.
   *
   * The branch records semantic transactions against the local projection's
   * revision; the reconciler converts it to shared history on the first
   * online pass. Nothing here can reach the server, so nothing here pretends
   * to have (FR-027): the status line says the work is on this device only.
   */
  async #openLegacyBranchSession(
    itemId: Uuid,
    storedBody: unknown,
  ): Promise<SharedOpenedOperationalPage | OpenOperationalPageFailure> {
    const item = await this.repository.getItem(itemId);
    if (item === null || item.kind !== "page") {
      return {
        ok: false,
        offline: false,
        code: "item.not-found",
        message: "This page is not available on this device.",
      };
    }
    const read = readDocumentBody(storedBody);
    const baseDocument =
      read.kind === "blocks"
        ? read.result.ok
          ? read.result.document
          : null
        : upgradeLegacyBody(read.body);
    if (baseDocument === null) {
      return {
        ok: false,
        offline: false,
        code: "page-operations.projection-invalid",
        message: "This page cannot be opened without reducing its content.",
      };
    }
    const online = typeof navigator === "undefined" ? true : navigator.onLine;
    const existing = await this.pageOperationLog.getLegacyBranch(itemId);
    if (existing?.branch.status === "converted") {
      return await this.#openActivePageSession(itemId, online);
    }
    const reconciler = this.pageReconciler(itemId);
    let tabChannel: PageTabChannel | null = null;
    const session = await LegacyPageEditingSession.tryOpen({
      pageId: itemId,
      baseRevisionId: item.currentRevisionId,
      baseDocument,
      log: this.pageOperationLog,
      store: new LegacyPageStateStore(this.pageOperationLog),
      // Backing for the in-place upgrade once the branch converts.
      activeStore: this.pageStateStore,
      online,
      publishDurableUpdate: (notice: DurablePageUpdateNotice) => {
        tabChannel?.publishUpdate(notice);
        void this.#emitProjection({ kind: "upsert", itemIds: [itemId] });
        void this.#notify();
        void reconciler.synchronize();
      },
      publishDurableBranch: () => {
        void this.#emitProjection({ kind: "upsert", itemIds: [itemId] });
        void this.#notify();
      },
      requestConversion: async () => {
        // A browser upgraded with a historical whole-document write already
        // in its workspace outbox has two durable journals for one logical
        // editing session: the v2 replacement first, then this semantic
        // branch. They must cross the protocol boundary in that order. Merely
        // relying on the window's `online` listeners is a race — the page
        // listener can activate v3 milliseconds before the workspace listener
        // submits the replacement, after which the server correctly refuses
        // the blind write and the branch can never resolve its local revision
        // alias.
        //
        // Keep this barrier inside the session-owned conversion callback. The
        // session already invokes it only at a serial gesture boundary, so the
        // workspace drain cannot race a new local editor transaction. A retry
        // is requested while the exact page replacement is still pending,
        // sending, blocked, or retained as a conflict; acknowledgement removes
        // it and installs its local -> canonical revision alias atomically.
        const outcome = await this.#convertLegacyBranchAfterWorkspace(itemId, reconciler);
        if (outcome.kind === "synced") return "converted";
        return outcome.kind === "blocked" && outcome.problemCode === "item.not-found"
          ? "retained"
          : "unavailable";
      },
    });
    if (session === null) {
      // A reconciler converted the branch after the routing read above. The
      // accepted checkpoint is now the durable owner, so continue opening it
      // instead of surfacing a transient protocol error to the editor.
      return await this.#openActivePageSession(itemId, online);
    }
    tabChannel = this.#openPageTabChannel(itemId, session, reconciler);
    return {
      ok: true,
      mode: "legacy-branch",
      session,
      reconciler,
      acquire: channelLease(tabChannel),
    };
  }

  async getDatabase(databaseId: Uuid): Promise<LocalDatabaseRow | null> {
    await this.#unlock();
    return this.databases.getDatabase(databaseId);
  }

  async listDatabaseEntries(databaseId: Uuid): Promise<LocalDatabaseEntryRow[]> {
    await this.#unlock();
    return this.databases.listEntries(databaseId);
  }

  async getDatabaseEntry(entryId: Uuid): Promise<LocalDatabaseEntryRow | null> {
    await this.#unlock();
    return this.databases.getEntry(entryId);
  }

  async previewTrashImpact(
    itemId: Uuid,
  ): Promise<{ readonly isDatabase: boolean; readonly activeEntryCount: number }> {
    await this.#unlock();
    const database = await this.db.databases.get(itemId);
    if (database === undefined) return { isDatabase: false, activeEntryCount: 0 };
    const memberships = await this.db.databaseEntries.where("databaseId").equals(itemId).toArray();
    const members = await this.db.items.bulkGet(memberships.map(({ entryItemId }) => entryItemId));
    return {
      isDatabase: true,
      activeEntryCount: members.filter((item) => item?.lifecycle === "active").length,
    };
  }

  async getDatabaseEntryRelationTargets(databaseId: Uuid, entryId: Uuid) {
    await this.#unlock();
    return this.databases.getRelationTargets(databaseId, entryId);
  }

  async previewDatabaseDefinitionImpact(
    databaseId: Uuid,
    baseRevisionId: Uuid,
    candidate: DatabaseDefinition,
  ): Promise<DefinitionImpact | null> {
    await this.#unlock();
    const [database, entries] = await Promise.all([
      this.databases.getDatabase(databaseId),
      this.databases.listEntries(databaseId),
    ]);
    return database === null || entries.some(({ availability }) => availability !== "present")
      ? null
      : await previewDefinitionImpact({
          baseRevisionId,
          current: database.definition,
          candidate,
          entries: entries.map((entry) => entry.values),
        });
  }

  async createDatabase(body: CreateDatabaseRequestDto) {
    return this.mutate("database.create", body as Record<string, unknown>);
  }

  async replaceDatabaseDefinition(databaseId: Uuid, body: ReplaceDefinitionRequestDto) {
    return this.mutate(
      "database.definition.replace",
      { databaseId, ...body } as Record<string, unknown>,
      [body.baseRevisionId as Uuid],
    );
  }

  async createDatabaseEntry(databaseId: Uuid, body: CreateEntryRequestDto) {
    return this.mutate("database.entry.create", {
      databaseId,
      ...body,
    } as Record<string, unknown>);
  }

  async replaceDatabaseEntryValues(
    databaseId: Uuid,
    entryId: Uuid,
    body: ReplaceEntryValuesRequestDto,
  ) {
    return this.mutate(
      "database.entry.values.replace",
      { databaseId, entryId, ...body } as Record<string, unknown>,
      [body.baseRevisionId as Uuid],
    );
  }

  /**
   * Applies one command locally (atomic projection + outbox), then attempts
   * synchronization. Local success is reported only after durability
   * (FR-038); server durability is reflected by the sync state only.
   */
  async mutate(
    commandType: string,
    payload: Record<string, unknown>,
    baseRevisionIds: Uuid[] = [],
  ): Promise<{ ok: true } | { ok: false; error: SafeError }> {
    await this.#unlock();
    if (
      commandType === "item.convert" &&
      payload["targetKind"] === "folder" &&
      typeof payload["itemId"] === "string"
    ) {
      await this.#settlePageBeforeFolderConversion(payload["itemId"] as Uuid);
    }
    const result = await applyLocalMutation(
      this.db,
      {
        mutationId: generateUuidV7(),
        commandType,
        payload,
        baseRevisionIds,
      },
      () => new Date(),
      this.#codec,
    );
    if (!result.ok) {
      // A storage failure means nothing was saved: surface it explicitly
      // rather than leaving a stale "pending" that implies durability.
      const storageFailed =
        result.error.code === "storage.quota-exceeded" ||
        result.error.code === "storage.unavailable";
      await this.#notify(storageFailed ? "quota-failure" : undefined);
      return { ok: false, error: result.error };
    }
    const headers = await this.db.revisionHeaders.bulkGet([...result.value.localRevisionIds]);
    const itemIds = [
      ...new Set(headers.flatMap((header) => (header === undefined ? [] : [header.itemId]))),
    ];
    if (itemIds.length > 0) {
      await this.#emitProjection({ kind: "upsert", itemIds });
    }
    if (
      commandType === "item.convert" &&
      payload["targetKind"] === "folder" &&
      typeof payload["itemId"] === "string"
    ) {
      // The projection transaction retired every local page-operation row.
      // Stop routing background pulls through the now-invalid page authority;
      // any already-held editor reference will observe the same missing state
      // and cannot recreate the destroyed journal.
      this.#pageReconcilers.delete(payload["itemId"] as Uuid);
    }
    await this.#notify("pending");
    void this.synchronize();
    return { ok: true };
  }

  /**
   * Commits the owner's resolution of a conflict (feature 006, FR-016).
   *
   * A method of its own rather than a `mutate` call, because the ordering rule it
   * carries is not something a caller should have to know: the resolution is
   * written durably *before* the conflict record is cleared, so a crash between
   * the two leaves a queued resolution rather than neither.
   */
  async resolveConflict(input: {
    readonly conflictMutationId: Uuid;
    readonly itemId: Uuid;
    readonly localRevisionId: Uuid;
    readonly remoteRevisionId: Uuid;
    readonly document: PageDocument;
    readonly pageLinkTargetIds?: readonly Uuid[];
  }): Promise<{ ok: true } | { ok: false; error: SafeError }> {
    await this.#unlock();
    const outcome = await resolveConflictLocally(this.db, this.#codec, {
      mutationId: generateUuidV7(),
      ...input,
    });
    if (!outcome.ok) {
      await this.#notify(undefined);
      return { ok: false, error: { code: outcome.code, title: outcome.title } as SafeError };
    }
    await this.#emitProjection({ kind: "upsert", itemIds: [input.itemId] });
    await this.#notify("pending");
    void this.synchronize();
    return { ok: true };
  }

  async resolveDatabaseDefinitionConflict(input: {
    readonly conflictMutationId: Uuid;
    readonly databaseId: Uuid;
    readonly localRevisionId: Uuid;
    readonly remoteRevisionId: Uuid;
    readonly definition: DatabaseDefinition;
    readonly impactConfirmation?: DatabaseImpactConfirmation;
  }): Promise<{ ok: true } | { ok: false; error: SafeError }> {
    await this.#unlock();
    const outcome = await resolveDatabaseDefinitionConflictLocally(this.db, this.#codec, {
      mutationId: generateUuidV7(),
      ...input,
    });
    if (!outcome.ok) {
      await this.#notify(undefined);
      return { ok: false, error: { code: outcome.code, title: outcome.title } as SafeError };
    }
    await this.#emitProjection({ kind: "upsert", itemIds: [input.databaseId] });
    await this.#notify("pending");
    void this.synchronize();
    return { ok: true };
  }

  async resolveDatabaseEntryConflict(input: {
    readonly conflictMutationId: Uuid;
    readonly databaseId: Uuid;
    readonly entryId: Uuid;
    readonly localRevisionId: Uuid;
    readonly remoteRevisionId: Uuid;
    readonly entryValues: EntryValues;
    readonly relationTargets: RelationTargets;
  }): Promise<{ ok: true } | { ok: false; error: SafeError }> {
    await this.#unlock();
    const outcome = await resolveDatabaseEntryConflictLocally(this.db, this.#codec, {
      mutationId: generateUuidV7(),
      ...input,
    });
    if (!outcome.ok) {
      await this.#notify(undefined);
      return { ok: false, error: { code: outcome.code, title: outcome.title } as SafeError };
    }
    await this.#emitProjection({ kind: "upsert", itemIds: [input.entryId] });
    await this.#notify("pending");
    void this.synchronize();
    return { ok: true };
  }

  /** Seeds the projection from the server when reachable (initial load). */
  async seedFromServer(): Promise<boolean> {
    const snapshot = await this.api.currentSnapshot();
    if (!snapshot.ok) {
      return false;
    }
    await this.repository.replaceFromSnapshot({
      workspaceId: snapshot.value.workspaceId as Uuid,
      schemaVersion: snapshot.value.schemaVersion,
      cursor: snapshot.value.cursor,
      items: snapshot.value.items as ItemDto[],
      relationships: snapshot.value.relationships,
      ...(snapshot.value.databases === undefined ? {} : { databases: snapshot.value.databases }),
      ...(snapshot.value.databaseEntries === undefined
        ? {}
        : { databaseEntries: snapshot.value.databaseEntries }),
    });
    await this.#emitProjection({ kind: "rebuild" });
    await this.#notify("synced");
    return true;
  }

  /** Locks decrypted local data and drops every transient search token. */
  async lockLocalData(): Promise<void> {
    this.#keys.lock();
    await this.#emitProjection({ kind: "clear" });
  }
}

let singleton: LocalContentService | null = null;

export function localContent(): LocalContentService {
  if (singleton === null) {
    singleton = new LocalContentService();
  }
  return singleton;
}
