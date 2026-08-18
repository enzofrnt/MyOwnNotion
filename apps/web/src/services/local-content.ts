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
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalRecordCodec,
  LocalRepository,
  Outbox,
  openLocalDatabase,
  type ProjectedItem,
  type ReconcileTransport,
  reconcile,
  resealPlaintextProjection,
  resolveConflictLocally,
} from "@myownnotion/client-core";
import type { ItemDto, RevisionDto } from "@myownnotion/contracts";
import { generateUuidV7, type PageDocument, type SafeError, type Uuid } from "@myownnotion/domain";
import { ContentApi } from "./content-api.ts";
import { IndexedDbKeyStorage } from "./local-key-storage.ts";
import { requestPersistentStorage } from "./storage-manager.ts";

/**
 * `quota-failure` means local persistence itself failed: the change was NOT
 * saved anywhere. It is distinct from `offline`, where the change is durable
 * locally and merely awaiting the server (FR-043).
 */
export type SyncState = "offline" | "pending" | "syncing" | "synced" | "conflict" | "quota-failure";

export interface LocalContentSnapshot {
  readonly syncState: SyncState;
  readonly pendingCount: number;
  readonly conflictCount: number;
  readonly storagePersisted: boolean | null;
}

type Listener = () => void;

export class LocalContentService {
  readonly db: LocalDatabase;
  readonly repository: LocalRepository;
  readonly outbox: Outbox;
  readonly api: ContentApi;
  #syncState: SyncState = "pending";
  #pendingCount = 0;
  #conflictCount = 0;
  #storagePersisted: boolean | null = null;
  #listeners = new Set<Listener>();
  /** The reconciliation pass currently running, if any. See `synchronize`. */
  #inFlightSync: Promise<SyncState> | null = null;
  /** Set when a caller arrives mid-pass; triggers exactly one follow-up pass. */
  #resyncRequested = false;
  #snapshot: LocalContentSnapshot;
  readonly #keys: LocalKeyManager;
  readonly #codec: LocalRecordCodec;
  #unlocked: Promise<void> | null = null;

  constructor(api: ContentApi = new ContentApi(), databaseName = "myownnotion-local") {
    this.api = api;
    this.db = openLocalDatabase(databaseName);
    // The projection is sealed under a device key that never leaves this
    // origin. Established lazily on first use rather than in the constructor:
    // minting a key is asynchronous, and a constructor that cannot await would
    // have to hand out a codec that is not ready yet.
    this.#keys = new LocalKeyManager(new IndexedDbKeyStorage());
    this.#codec = new LocalRecordCodec(new LocalCipher(this.#keys), {
      installationId: databaseName,
      workspaceId: databaseName,
    });
    this.repository = new LocalRepository(this.db, this.#codec);
    this.outbox = new Outbox(this.db);
    this.#snapshot = {
      syncState: "pending",
      pendingCount: 0,
      conflictCount: 0,
      storagePersisted: null,
    };
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

  async #notify(state?: SyncState): Promise<void> {
    if (state !== undefined) {
      this.#syncState = state;
    }
    this.#pendingCount = (await this.outbox.pending()).length;
    this.#conflictCount = (await this.outbox.conflicts()).length;
    if (
      this.#conflictCount > 0 &&
      this.#syncState !== "offline" &&
      // A failed local save is the more urgent truth: never mask it.
      this.#syncState !== "quota-failure"
    ) {
      this.#syncState = "conflict";
    }
    const next: LocalContentSnapshot = {
      syncState: this.#syncState,
      pendingCount: this.#pendingCount,
      conflictCount: this.#conflictCount,
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
      next.conflictCount !== this.#snapshot.conflictCount ||
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

  /** Opens local storage and reconciles once; safe to call on every boot. */
  async initialize(): Promise<void> {
    await this.db.open();
    this.#storagePersisted = await requestPersistentStorage();
    await this.synchronize();
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
   * While a pass is running, callers join it. A caller that arrives during a
   * pass also sets `#resyncRequested`, so exactly one follow-up pass runs
   * afterwards and drains anything enqueued in the meantime. One extra pass is
   * enough regardless of how many callers arrived, because the follow-up
   * observes the queue as it stands when it starts.
   */
  async synchronize(): Promise<SyncState> {
    if (this.#inFlightSync !== null) {
      this.#resyncRequested = true;
      return this.#inFlightSync;
    }
    const pass = this.#runSynchronize().finally(() => {
      this.#inFlightSync = null;
    });
    this.#inFlightSync = pass;

    let state = await pass;
    while (this.#resyncRequested) {
      this.#resyncRequested = false;
      state = await this.synchronize();
    }
    return state;
  }

  async #runSynchronize(): Promise<SyncState> {
    await this.#notify("syncing");
    await this.#unlock();
    const outcome = await reconcile(this.db, this.#transport(), this.#codec);
    const state: SyncState = outcome.offline
      ? "offline"
      : outcome.conflicts > 0 || (await this.outbox.conflicts()).length > 0
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

  async listTrashedItems(): Promise<ProjectedItem[]> {
    return this.repository.listItems("trashed");
  }

  async getItem(itemId: Uuid): Promise<ProjectedItem | null> {
    return this.repository.getItem(itemId);
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
    });
    await this.#notify("synced");
    return true;
  }
}

let singleton: LocalContentService | null = null;

export function localContent(): LocalContentService {
  if (singleton === null) {
    singleton = new LocalContentService();
  }
  return singleton;
}
