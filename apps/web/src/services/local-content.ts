/**
 * Offline-first content service (T045, US6).
 *
 * All reads come from the durable Dexie projection; all writes are applied
 * optimistically with a durable outbox entry, then reconciled with the
 * server when reachable. The interface never claims server durability for
 * local-only work: the observable sync state distinguishes offline,
 * pending, syncing, synced, and conflict.
 */
import {
  applyLocalMutation,
  type LocalDatabase,
  LocalRepository,
  Outbox,
  openLocalDatabase,
  type ProjectedItem,
  type ReconcileTransport,
  reconcile,
} from "@myownnotion/client-core";
import type { ItemDto } from "@myownnotion/contracts";
import {
  buildKnowledgeGraph,
  buildTaskProjections,
  countEditorTaskItems,
  EDITOR_DOCUMENT_VERSION,
  type EditorDocument,
  generateUuidV7,
  type KnowledgeGraphModel,
  normalizePageDocumentForEditor,
  type PageKnowledgeSummary,
  type SafeError,
  summarizePageKnowledge,
  type TaskProjection,
  toPageDocument,
  type Uuid,
} from "@myownnotion/domain";
import { ContentApi } from "./content-api.ts";
import { requestPersistentStorage } from "./storage-manager.ts";

export type SyncState = "offline" | "pending" | "syncing" | "synced" | "conflict";

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
  #snapshot: LocalContentSnapshot;
  #synchronization: Promise<SyncState> | null = null;
  #synchronizeAgain = false;

  constructor(api: ContentApi = new ContentApi(), databaseName = "myownnotion-local") {
    this.api = api;
    this.db = openLocalDatabase(databaseName);
    this.repository = new LocalRepository(this.db);
    this.outbox = new Outbox(this.db);
    this.#snapshot = {
      syncState: "pending",
      pendingCount: 0,
      conflictCount: 0,
      storagePersisted: null,
    };
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
    if (this.#conflictCount > 0 && this.#syncState !== "offline") {
      this.#syncState = "conflict";
    }
    this.#snapshot = {
      syncState: this.#syncState,
      pendingCount: this.#pendingCount,
      conflictCount: this.#conflictCount,
      storagePersisted: this.#storagePersisted,
    };
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
    };
  }

  /** Opens local storage and reconciles once; safe to call on every boot. */
  async initialize(): Promise<void> {
    await this.db.open();
    this.#storagePersisted = await requestPersistentStorage();
    await this.synchronize();
  }

  /** Full reconciliation pass; resolves to the resulting sync state. */
  synchronize(): Promise<SyncState> {
    if (this.#synchronization !== null) {
      this.#synchronizeAgain = true;
      return this.#synchronization;
    }
    const operation = this.#synchronizeUntilCurrent();
    this.#synchronization = operation;
    void operation.then(
      () => {
        if (this.#synchronization === operation) {
          this.#synchronization = null;
        }
      },
      () => {
        if (this.#synchronization === operation) {
          this.#synchronization = null;
        }
      },
    );
    return operation;
  }

  async #synchronizeUntilCurrent(): Promise<SyncState> {
    let state: SyncState;
    do {
      this.#synchronizeAgain = false;
      state = await this.#synchronizeOnce();
    } while (this.#synchronizeAgain);
    return state;
  }

  async #synchronizeOnce(): Promise<SyncState> {
    await this.#notify("syncing");
    const outcome = await reconcile(this.db, this.#transport());
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

  async getPageKnowledge(itemId: Uuid): Promise<PageKnowledgeSummary> {
    const data = await this.repository.readKnowledgeData();
    return summarizePageKnowledge(data.items, data.relationships, itemId);
  }

  async getKnowledgeGraph(
    mode: "local" | "global",
    selectedItemId: Uuid | null,
    query = "",
  ): Promise<KnowledgeGraphModel> {
    const data = await this.repository.readKnowledgeData();
    return buildKnowledgeGraph(data.items, data.relationships, {
      mode,
      selectedItemId,
      query,
    });
  }

  async getTaskWorkspaceData(): Promise<{
    readonly tasks: TaskProjection[];
    readonly legacyPageCount: number;
  }> {
    const items = await this.repository.listItems();
    const pages = items.filter((item) => item.kind === "page");
    const tasks = buildTaskProjections(
      pages.map((item) => ({
        id: item.id,
        name: item.name,
        lifecycle: item.lifecycle,
        pageDocument: item.pageDocument,
      })),
    );
    let legacyPageCount = 0;
    for (const page of pages) {
      if (
        page.lifecycle !== "active" ||
        page.pageDocument === null ||
        page.pageDocument.formatVersion >= EDITOR_DOCUMENT_VERSION
      ) {
        continue;
      }
      const normalized = normalizePageDocumentForEditor(page.pageDocument);
      if (normalized.ok && countEditorTaskItems(normalized.value) > 0) {
        legacyPageCount += 1;
      }
    }
    return { tasks, legacyPageCount };
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
    const result = await applyLocalMutation(this.db, {
      mutationId: generateUuidV7(),
      commandType,
      payload,
      baseRevisionIds,
    });
    if (!result.ok) {
      await this.#notify();
      return { ok: false, error: result.error };
    }
    await this.#notify("pending");
    void this.synchronize();
    return { ok: true };
  }

  /** Saves rich page content against the latest durable local revision head. */
  async replacePageDocument(
    itemId: Uuid,
    document: EditorDocument,
  ): Promise<{ ok: true } | { ok: false; error: SafeError }> {
    const item = await this.getItem(itemId);
    if (item === null || item.kind !== "page") {
      return {
        ok: false,
        error: { code: "item.not-found", title: "Page is not available locally" },
      };
    }
    return this.mutate(
      "page.document.replace",
      {
        itemId,
        baseRevisionId: item.currentRevisionId,
        document: toPageDocument(document),
      },
      [item.currentRevisionId],
    );
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
