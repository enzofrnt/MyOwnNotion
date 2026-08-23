/**
 * Editor-facing owner of one operational page session.
 *
 * The session serializes gestures, commits their exact Loro update and
 * canonical projection atomically, and only then acknowledges them to the UI
 * or other tabs. A failed local commit leaves the visible result recoverable
 * and blocks later gestures instead of allowing an undurable edit chain to
 * masquerade as saved work.
 */

import type { BlockDocumentV3, Uuid } from "@myownnotion/domain";
import { generateUuidV7 } from "@myownnotion/domain";
import {
  OperationalPageDocument,
  type PageCommand,
  type PageTransactionResult,
  PageUndoManager,
  versionVectorBytesEqual,
  versionVectorDominates,
} from "@myownnotion/page-state";
import { LocalIntegrityError, LocalKeyLockedError, LocalKeyLostError } from "../security/index.ts";
import type {
  EncryptedPageOperationLog,
  PageAmbiguityRecord,
  PageOperationStateRecord,
  PageOperationUpdateRecord,
} from "./encrypted-update-log.ts";
import type {
  CommitLocalPageTransactionInput,
  CommittedLocalPageTransaction,
} from "./local-page-state.ts";
import {
  derivePageSyncState,
  type PageSyncBlockedReason,
  type PageSyncState,
} from "./page-sync-state.ts";

export interface LocalPageTransactionCommitter {
  commitLocalTransaction(
    input: CommitLocalPageTransactionInput,
  ): Promise<CommittedLocalPageTransaction>;
}

export interface StablePagePosition {
  readonly blockId: Uuid;
  readonly cursor: Uint8Array;
}

export interface ResolvedPagePosition {
  readonly blockId: Uuid;
  readonly offset: number;
  readonly side: -1 | 0 | 1;
}

export interface PageEditingRecoveryBuffer {
  readonly pageId: Uuid;
  readonly updateId: Uuid;
  readonly document: BlockDocumentV3;
  readonly reason: PageSyncBlockedReason;
  readonly failedAt: string;
}

export interface DurablePageEditResult {
  readonly changed: true;
  readonly updateId: Uuid;
  readonly transaction: PageTransactionResult;
  readonly committed: CommittedLocalPageTransaction;
  readonly document: BlockDocumentV3;
}

export interface UnchangedPageEditResult {
  readonly changed: false;
  readonly document: BlockDocumentV3;
}

export type LocalCommitResult = DurablePageEditResult | UnchangedPageEditResult;

export interface PageSessionChange {
  readonly origin: "local" | "remote" | "status" | "recovery";
  readonly document: BlockDocumentV3;
  readonly sync: PageSyncState;
  readonly transaction?: PageTransactionResult;
  readonly updateId?: Uuid;
}

export interface OpenPageEditingSessionOptions {
  readonly page: OperationalPageDocument;
  readonly log: EncryptedPageOperationLog;
  readonly store: LocalPageTransactionCommitter;
  readonly online?: boolean;
  readonly now?: () => Date;
  readonly createUpdateId?: () => Uuid;
  /** Called only after the same immutable update is proven durable in IndexedDB. */
  readonly publishDurableUpdate?: (updateId: Uuid, updateBytes: Uint8Array) => void;
  readonly onBackgroundError?: (error: unknown) => void;
}

export interface ResumePageEditingSessionOptions
  extends Omit<OpenPageEditingSessionOptions, "page"> {
  readonly pageId: Uuid;
}

interface FailedCommitContext {
  readonly input: CommitLocalPageTransactionInput;
  readonly transaction: PageTransactionResult;
}

export class PageEditingSessionBlockedError extends Error {
  constructor() {
    super("the page editor is blocked until its visible recovery buffer is made durable");
    this.name = "PageEditingSessionBlockedError";
  }
}

function copyDocument(document: BlockDocumentV3): BlockDocumentV3 {
  return structuredClone(document);
}

function blockedReason(error: unknown): PageSyncBlockedReason {
  if (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: string }).name === "QuotaExceededError" ||
      (error as { inner?: { name?: string } }).inner?.name === "QuotaExceededError")
  ) {
    return "quota";
  }
  if (error instanceof LocalKeyLockedError || error instanceof LocalKeyLostError) return "key";
  if (error instanceof LocalIntegrityError) return "integrity";
  const name =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name.toLowerCase()
      : "";
  if (name.includes("protocol")) return "protocol";
  if (name.includes("validation") || name.includes("schema")) return "validation";
  return "storage";
}

function sameDurableUpdate(
  stored: PageOperationUpdateRecord | null,
  transaction: PageTransactionResult,
): stored is PageOperationUpdateRecord {
  return (
    stored !== null &&
    stored.updateBytes.byteLength === transaction.updateBytes.byteLength &&
    stored.updateBytes.every((byte, index) => byte === transaction.updateBytes[index]) &&
    versionVectorBytesEqual(stored.resultVersionVector, transaction.resultVersionVector)
  );
}

export class PageEditingSession {
  readonly #log: EncryptedPageOperationLog;
  readonly #store: LocalPageTransactionCommitter;
  readonly #now: () => Date;
  readonly #createUpdateId: () => Uuid;
  readonly #publishDurableUpdate: ((updateId: Uuid, updateBytes: Uint8Array) => void) | undefined;
  readonly #onBackgroundError: ((error: unknown) => void) | undefined;
  readonly #listeners = new Set<(change: PageSessionChange) => void>();
  #page: OperationalPageDocument;
  #history: PageUndoManager;
  #operationState: PageOperationStateRecord | null;
  #updates: PageOperationUpdateRecord[];
  #ambiguities: PageAmbiguityRecord[];
  #online: boolean;
  #importingRemote = false;
  #localCommit: "idle" | "saving" | "blocked" = "idle";
  #localBlockedReason: PageSyncBlockedReason | undefined;
  #sync: PageSyncState;
  #nextEnqueueOrder: number;
  #tail: Promise<void> = Promise.resolve();
  #queuedTransactions = 0;
  #recoveryBuffer: PageEditingRecoveryBuffer | null = null;
  #failedCommit: FailedCommitContext | null = null;
  #remoteAdoptionErrorType: string | null = null;
  /**
   * Last document attached to a semantic session event.
   *
   * Status-only transitions are deliberately allowed to reuse this immutable
   * projection. Materialising a 500-block Loro tree just to change
   * "saving" into "pending" puts persistence work on the keystroke's paint
   * path even though status consumers never read the document.
   */
  #publishedDocument: BlockDocumentV3;

  private constructor(
    options: OpenPageEditingSessionOptions,
    operationState: PageOperationStateRecord | null,
    updates: PageOperationUpdateRecord[],
    ambiguities: PageAmbiguityRecord[],
  ) {
    this.#page = options.page;
    this.#history = new PageUndoManager(options.page);
    this.#log = options.log;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
    this.#createUpdateId = options.createUpdateId ?? generateUuidV7;
    this.#publishDurableUpdate = options.publishDurableUpdate;
    this.#onBackgroundError = options.onBackgroundError;
    this.#operationState = operationState;
    this.#updates = updates;
    this.#ambiguities = ambiguities;
    this.#online = options.online ?? true;
    this.#nextEnqueueOrder = Math.max(0, ...updates.map(({ enqueueOrder }) => enqueueOrder)) + 1;
    this.#sync = this.#deriveSync();
    this.#publishedDocument = options.page.snapshot();
  }

  static async open(options: OpenPageEditingSessionOptions): Promise<PageEditingSession> {
    const {
      state: operationState,
      updates,
      ambiguities,
    } = await options.log.readPageSnapshot(options.page.pageId);
    return new PageEditingSession(options, operationState, updates, ambiguities);
  }

  static async resume(
    options: ResumePageEditingSessionOptions,
  ): Promise<PageEditingSession | null> {
    const {
      state: operationState,
      updates,
      ambiguities,
    } = await options.log.readPageSnapshot(options.pageId);
    if (operationState?.checkpoint === null || operationState?.checkpoint === undefined) {
      return null;
    }
    const page = await OperationalPageDocument.fromCheckpoint({
      pageId: options.pageId,
      checkpoint: operationState.checkpoint,
    });
    for (const update of updates) page.importUpdate(update.updateBytes);
    if (!versionVectorBytesEqual(page.versionVectorBytes(), operationState.versionVector)) {
      throw new Error("persisted page updates do not reconstruct the durable local frontier");
    }
    return new PageEditingSession({ ...options, page }, operationState, updates, ambiguities);
  }

  get pageId(): Uuid {
    return this.#page.pageId;
  }

  get sync(): PageSyncState {
    return this.#sync;
  }

  get recoveryBuffer(): PageEditingRecoveryBuffer | null {
    if (this.#recoveryBuffer === null) return null;
    return {
      ...this.#recoveryBuffer,
      document: copyDocument(this.#recoveryBuffer.document),
    };
  }

  /** Redacted support diagnostic; never contains document text or a stack. */
  get remoteAdoptionErrorType(): string | null {
    return this.#remoteAdoptionErrorType;
  }

  get importingRemote(): boolean {
    return this.#importingRemote;
  }

  get canUndo(): boolean {
    return this.#history.canUndo;
  }

  get canRedo(): boolean {
    return this.#history.canRedo;
  }

  read(): BlockDocumentV3 {
    return this.#page.snapshot();
  }

  canonicalBlockIdForIdentity(blockId: Uuid): Uuid | null {
    return this.#page.canonicalBlockIdForIdentity(blockId);
  }

  subscribe(listener: (change: PageSessionChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  transact(command: PageCommand | readonly PageCommand[]): Promise<LocalCommitResult> {
    const commands = Array.isArray(command) ? [...command] : [command as PageCommand];
    return this.#enqueue(() => this.#history.execute(commands));
  }

  undo(): Promise<LocalCommitResult> {
    return this.#enqueue(() => this.#history.undo());
  }

  redo(): Promise<LocalCommitResult> {
    return this.#enqueue(() => this.#history.redo());
  }

  captureRelativePosition(
    blockId: Uuid,
    utf16Offset: number,
    side: -1 | 0 | 1 = 0,
  ): StablePagePosition {
    return {
      blockId,
      cursor: this.#page.createRelativeTextPosition(blockId, utf16Offset, side),
    };
  }

  resolveRelativePosition(position: StablePagePosition): ResolvedPagePosition | null {
    const resolved = this.#page.resolveRelativeTextPosition(position.cursor);
    return resolved === undefined
      ? null
      : { blockId: position.blockId, offset: resolved.offset, side: resolved.side };
  }

  setOnline(online: boolean): void {
    if (this.#online === online) return;
    this.#online = online;
    this.#refreshSync("status");
  }

  setImportingRemote(importing: boolean): void {
    if (this.#importingRemote === importing) return;
    this.#importingRemote = importing;
    this.#refreshSync("status");
  }

  async refreshFromDurableState(): Promise<void> {
    const {
      state: operationState,
      updates,
      ambiguities,
    } = await this.#log.readPageSnapshot(this.pageId);
    this.#operationState = operationState;
    this.#updates = updates;
    this.#ambiguities = ambiguities;
    this.#nextEnqueueOrder = Math.max(
      this.#nextEnqueueOrder,
      Math.max(0, ...updates.map(({ enqueueOrder }) => enqueueOrder)) + 1,
    );
    this.#refreshSync("status");
  }

  /** Imports a response only after the reconciler has committed it to IndexedDB. */
  adoptDurablePage(): Promise<void> {
    // Adoption is part of the same serial authority as local gestures. Merely
    // awaiting the current tail leaves a gap in which a new gesture can attach
    // to that resolved tail while this method is reading an older checkpoint.
    // The stale read then cannot dominate the now-visible editor and its
    // listener silently misses the acknowledgement, leaving already accepted
    // updates displayed as pending. Chaining first closes that gap: gestures
    // queued after the notification run against the adopted frontier.
    const adoption = this.#tail.then(async () => await this.#adoptDurablePage());
    this.#tail = adoption.then(
      () => undefined,
      () => undefined,
    );
    return adoption;
  }

  async #adoptDurablePage(): Promise<void> {
    this.#remoteAdoptionErrorType = null;
    this.setImportingRemote(true);
    try {
      const {
        state: operationState,
        updates,
        ambiguities,
      } = await this.#log.readPageSnapshot(this.pageId);
      if (operationState?.checkpoint === null || operationState?.checkpoint === undefined) {
        throw new Error("the durable operational page has no checkpoint");
      }
      const durable = await OperationalPageDocument.fromCheckpoint({
        pageId: this.pageId,
        checkpoint: operationState.checkpoint,
      });
      for (const update of updates) {
        if (durable.importUpdate(update.updateBytes).pending) {
          throw new Error("the durable operational page has missing dependencies");
        }
      }
      const currentVersion = this.#page.versionVectorBytes();
      if (!versionVectorDominates(durable.versionVectorBytes(), currentVersion)) {
        throw new Error("the durable operational page does not include the visible editor");
      }
      if (!versionVectorBytesEqual(durable.versionVectorBytes(), currentVersion)) {
        const imported = this.#history.importRemote(durable.exportUpdateFrom(currentVersion));
        if (imported.pending) {
          throw new Error("the visible editor could not import durable remote operations");
        }
      }
      this.#operationState = operationState;
      this.#updates = updates;
      this.#ambiguities = ambiguities;
      this.#nextEnqueueOrder = Math.max(
        this.#nextEnqueueOrder,
        Math.max(0, ...updates.map(({ enqueueOrder }) => enqueueOrder)) + 1,
      );
      this.#refreshSync("remote");
    } catch (error) {
      this.#remoteAdoptionErrorType =
        error instanceof Error && error.name !== "" ? error.name : "UnknownError";
      throw error;
    } finally {
      this.setImportingRemote(false);
    }
  }

  async retryBlockedCommit(): Promise<LocalCommitResult> {
    const failed = this.#failedCommit;
    if (failed === null) throw new PageEditingSessionBlockedError();
    this.#localCommit = "saving";
    this.#localBlockedReason = undefined;
    this.#refreshSync("recovery");
    try {
      const committed = await this.#commitOrRecover(failed.input, failed.transaction);
      const adoptedRemote = await this.#recordDurableCommit(committed);
      this.#failedCommit = null;
      this.#recoveryBuffer = null;
      this.#localCommit = "idle";
      this.#refreshSync(
        adoptedRemote ? "remote" : "recovery",
        failed.transaction,
        failed.input.updateId,
      );
      return {
        changed: true,
        updateId: failed.input.updateId,
        transaction: failed.transaction,
        committed,
        document: this.#publishedDocument,
      };
    } catch (error) {
      this.#blockAfterLocalFailure(error, failed);
      throw error;
    }
  }

  #enqueue(transact: () => PageTransactionResult | null): Promise<LocalCommitResult> {
    if (this.#localCommit === "blocked") {
      return Promise.reject(new PageEditingSessionBlockedError());
    }
    this.#queuedTransactions += 1;
    this.#localCommit = "saving";
    this.#refreshSync("status");

    const result = this.#tail.then(async () => {
      if (this.#localCommit === "blocked") throw new PageEditingSessionBlockedError();
      const transaction = transact();
      if (transaction === null || !transaction.changed) {
        return { changed: false, document: this.read() } satisfies UnchangedPageEditResult;
      }
      const updateId = this.#createUpdateId();
      const input: CommitLocalPageTransactionInput = {
        page: this.#page,
        transaction,
        updateId,
        enqueueOrder: this.#nextEnqueueOrder,
        createdAt: this.#now().toISOString(),
      };
      const failed: FailedCommitContext = { input, transaction };
      let committed: CommittedLocalPageTransaction;
      try {
        committed = await this.#commitOrRecover(input, transaction);
      } catch (error) {
        this.#blockAfterLocalFailure(error, failed);
        throw error;
      }
      const adoptedRemote = await this.#recordDurableCommit(committed);
      this.#refreshSync(adoptedRemote ? "remote" : "local", transaction, updateId);
      return {
        changed: true,
        updateId,
        transaction,
        committed,
        document: this.#publishedDocument,
      } satisfies DurablePageEditResult;
    });

    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.#queuedTransactions -= 1;
      if (this.#queuedTransactions === 0 && this.#localCommit !== "blocked") {
        this.#localCommit = "idle";
      }
      this.#refreshSync("status");
    });
  }

  async #commitOrRecover(
    input: CommitLocalPageTransactionInput,
    transaction: PageTransactionResult,
  ): Promise<CommittedLocalPageTransaction> {
    try {
      return await this.#store.commitLocalTransaction(input);
    } catch (error) {
      // The renderer can disappear or a callback can fail after IndexedDB has
      // committed. Re-read the immutable id before calling this an unsaved
      // edit: if both rows are present, the correct result is durable success.
      try {
        const [update, state] = await Promise.all([
          this.#log.getUpdate(input.updateId),
          this.#log.getState(this.pageId),
        ]);
        if (
          sameDurableUpdate(update, transaction) &&
          state !== null &&
          versionVectorBytesEqual(state.versionVector, this.#page.versionVectorBytes())
        ) {
          return { update, state };
        }
      } catch (verificationError) {
        this.#onBackgroundError?.(verificationError);
      }
      throw error;
    }
  }

  async #recordDurableCommit(committed: CommittedLocalPageTransaction): Promise<boolean> {
    const adoptedRemote = !versionVectorBytesEqual(
      committed.state.versionVector,
      this.#page.versionVectorBytes(),
    );
    if (adoptedRemote) {
      if (committed.state.checkpoint === null) {
        throw new Error("a committed active page has no local checkpoint");
      }
      const durable = await OperationalPageDocument.fromCheckpoint({
        pageId: this.pageId,
        checkpoint: committed.state.checkpoint,
      });
      for (const update of await this.#log.listUpdates(this.pageId)) {
        if (durable.importUpdate(update.updateBytes).pending) {
          throw new Error("the committed local page has missing causal dependencies");
        }
      }
      if (!versionVectorDominates(durable.versionVectorBytes(), this.#page.versionVectorBytes())) {
        throw new Error("the committed local page does not include the visible editor state");
      }
      const imported = this.#history.importRemote(
        durable.exportUpdateFrom(this.#page.versionVectorBytes()),
      );
      if (
        imported.pending ||
        !versionVectorBytesEqual(this.#page.versionVectorBytes(), committed.state.versionVector)
      ) {
        throw new Error("the visible editor could not adopt the durable merged page state");
      }
    }
    this.#operationState = committed.state;
    const existing = this.#updates.findIndex(
      ({ updateId }) => updateId === committed.update.updateId,
    );
    if (existing === -1) this.#updates.push(committed.update);
    else this.#updates[existing] = committed.update;
    this.#updates.sort((left, right) => left.enqueueOrder - right.enqueueOrder);
    this.#nextEnqueueOrder = Math.max(this.#nextEnqueueOrder, committed.update.enqueueOrder + 1);
    try {
      this.#publishDurableUpdate?.(committed.update.updateId, committed.update.updateBytes);
    } catch (error) {
      // Same-tab propagation is an accelerator. Its failure cannot undo or
      // downgrade a transaction already committed to the durable authority.
      this.#onBackgroundError?.(error);
    }
    return adoptedRemote;
  }

  #blockAfterLocalFailure(error: unknown, failed: FailedCommitContext): void {
    const reason = blockedReason(error);
    this.#localCommit = "blocked";
    this.#localBlockedReason = reason;
    this.#failedCommit = failed;
    this.#recoveryBuffer = {
      pageId: this.pageId,
      updateId: failed.input.updateId,
      document: copyDocument(this.read()),
      reason,
      failedAt: this.#now().toISOString(),
    };
    this.#refreshSync("recovery", failed.transaction, failed.input.updateId);
  }

  #deriveSync(): PageSyncState {
    return derivePageSyncState({
      localCommit: this.#localCommit,
      ...(this.#localBlockedReason === undefined
        ? {}
        : { localBlockedReason: this.#localBlockedReason }),
      online: this.#online,
      importingRemote: this.#importingRemote,
      operationState: this.#operationState,
      updates: this.#updates,
      ambiguities: this.#ambiguities,
    });
  }

  #refreshSync(
    origin: PageSessionChange["origin"],
    transaction?: PageTransactionResult,
    updateId?: Uuid,
  ): void {
    this.#sync = this.#deriveSync();
    if (origin !== "status") this.#publishedDocument = this.read();
    const change: PageSessionChange = {
      origin,
      document: this.#publishedDocument,
      sync: this.#sync,
      ...(transaction === undefined ? {} : { transaction }),
      ...(updateId === undefined ? {} : { updateId }),
    };
    for (const listener of this.#listeners) listener(change);
  }
}
