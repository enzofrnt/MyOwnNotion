/**
 * Editor owner for a v2 page that has never received a shared operational
 * checkpoint. It persists semantic transactions only; device-local bootstrap
 * bytes are intentionally never sent as if they belonged to shared history.
 *
 * Once the branch converts (plan §6), the session upgrades itself in place:
 * the conversion task runs on the same serial queue as gestures, so every
 * keystroke either joins the converted journal or executes against the
 * resumed active session. The editor never remounts and no gesture is lost.
 */

import type { BlockDocument, BlockDocumentV3, Uuid } from "@myownnotion/domain";
import { generateUuidV7 } from "@myownnotion/domain";
import {
  appendLegacySemanticTransaction,
  createLegacyOfflineBranch,
  type LegacyOfflineBranch,
  legacySemanticCommandsFromTransaction,
  OperationalPageDocument,
  type PageCommand,
  type PageTransactionResult,
  PageUndoManager,
} from "@myownnotion/page-state";
import { LocalIntegrityError, LocalKeyLockedError, LocalKeyLostError } from "../security/index.ts";
import type {
  EncryptedPageOperationLog,
  LegacyOfflineBranchRecord,
} from "./encrypted-update-log.ts";
import {
  type CommitLegacyPageBranchInput,
  ConcurrentLegacyPageBranchError,
  type LegacyPageBranchCommitter,
} from "./legacy-page-state.ts";
import type { LocalPageTransactionCommitter } from "./page-editing-session.ts";
import { PageEditingSession } from "./page-editing-session.ts";
import {
  derivePageSyncState,
  type PageSyncBlockedReason,
  type PageSyncState,
} from "./page-sync-state.ts";

export interface LegacyPageEditingRecoveryBuffer {
  readonly pageId: Uuid;
  /**
   * Null once the session has upgraded to the active operational protocol;
   * recovery then belongs to the active session's update journal.
   */
  readonly branchId: Uuid | null;
  readonly document: BlockDocumentV3;
  readonly reason: PageSyncBlockedReason;
  readonly failedAt: string;
}

export interface DurableLegacyPageEditResult {
  readonly changed: true;
  readonly transactionId: Uuid;
  readonly transaction: PageTransactionResult;
  /** Null once the session has upgraded to the active operational protocol. */
  readonly committed: LegacyOfflineBranchRecord | null;
  readonly document: BlockDocumentV3;
}

export interface UnchangedLegacyPageEditResult {
  readonly changed: false;
  readonly document: BlockDocumentV3;
}

export type LegacyPageCommitResult = DurableLegacyPageEditResult | UnchangedLegacyPageEditResult;

export interface LegacyPageSessionChange {
  readonly origin: "local" | "remote" | "status" | "recovery";
  readonly document: BlockDocumentV3;
  readonly sync: PageSyncState;
  readonly transaction?: PageTransactionResult;
  readonly transactionId?: Uuid;
}

export interface OpenLegacyPageEditingSessionOptions {
  readonly pageId: Uuid;
  readonly baseRevisionId: Uuid;
  readonly baseDocument: BlockDocument;
  readonly log: EncryptedPageOperationLog;
  readonly store: LegacyPageBranchCommitter;
  /**
   * Store backing the resumed active session after conversion. Without it the
   * page stays on the branch protocol forever.
   */
  readonly activeStore?: LocalPageTransactionCommitter;
  /** Publishes durable operational updates produced after the upgrade. */
  readonly publishDurableUpdate?: (updateId: Uuid, updateBytes: Uint8Array) => void;
  /**
   * Drives branch conversion (plan §6). Resolves "converted" once the server
   * accepted the journal and an active checkpoint is installed locally.
   */
  readonly requestConversion?: () => Promise<"converted" | "unavailable">;
  readonly online?: boolean;
  readonly now?: () => Date;
  readonly createBranchId?: () => Uuid;
  readonly createTransactionId?: () => Uuid;
  readonly publishDurableBranch?: (branchId: Uuid) => void;
  readonly onBackgroundError?: (error: unknown) => void;
}

interface FailedLegacyCommit {
  readonly input: CommitLegacyPageBranchInput;
  readonly transaction: PageTransactionResult;
  readonly transactionId: Uuid;
}

type GestureKind = "transact" | "undo" | "redo";

export class LegacyPageEditingSessionBlockedError extends Error {
  constructor() {
    super("the legacy page editor is blocked until its visible recovery buffer is durable");
    this.name = "LegacyPageEditingSessionBlockedError";
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

function sameDurableBranch(
  record: LegacyOfflineBranchRecord | null,
  expected: CommitLegacyPageBranchInput,
): record is LegacyOfflineBranchRecord {
  return (
    record !== null &&
    record.recordVersion === expected.expectedRecordVersion + 1 &&
    record.branchId === expected.branch.branchId &&
    record.branch.localDocumentDigest === expected.branch.localDocumentDigest &&
    JSON.stringify(record.branch.semanticTransactions) ===
      JSON.stringify(expected.branch.semanticTransactions)
  );
}

function branchTransportStatus(
  branch: LegacyOfflineBranchRecord | null,
): "pending" | "sending" | "accepted" | "blocked" | null {
  if (branch === null) return null;
  switch (branch.status) {
    case "editing":
      return "pending";
    case "sending":
      return "sending";
    case "converted":
      return "accepted";
    case "blocked":
      return "blocked";
  }
}

export class LegacyPageEditingSession {
  readonly #log: EncryptedPageOperationLog;
  readonly #store: LegacyPageBranchCommitter;
  readonly #activeStore: LocalPageTransactionCommitter | undefined;
  readonly #publishDurableUpdate: ((updateId: Uuid, updateBytes: Uint8Array) => void) | undefined;
  readonly #requestConversion: (() => Promise<"converted" | "unavailable">) | undefined;
  readonly #now: () => Date;
  readonly #createTransactionId: () => Uuid;
  readonly #publishDurableBranch: ((branchId: Uuid) => void) | undefined;
  readonly #onBackgroundError: ((error: unknown) => void) | undefined;
  readonly #listeners = new Set<(change: LegacyPageSessionChange) => void>();
  readonly #page: OperationalPageDocument;
  readonly #history: PageUndoManager;
  #branch: LegacyOfflineBranch;
  #record: LegacyOfflineBranchRecord | null;
  #successor: PageEditingSession | null = null;
  #handoverProjectionPending = false;
  #converting = false;
  #upgrade: Promise<void> | null = null;
  #online: boolean;
  #localCommit: "idle" | "saving" | "blocked" = "idle";
  #localBlockedReason: PageSyncBlockedReason | undefined;
  #sync: PageSyncState;
  #tail: Promise<void> = Promise.resolve();
  #queuedTransactions = 0;
  #recoveryBuffer: LegacyPageEditingRecoveryBuffer | null = null;
  #failedCommit: FailedLegacyCommit | null = null;

  private constructor(
    options: OpenLegacyPageEditingSessionOptions,
    branch: LegacyOfflineBranch,
    record: LegacyOfflineBranchRecord | null,
    page: OperationalPageDocument,
  ) {
    this.#log = options.log;
    this.#store = options.store;
    this.#activeStore = options.activeStore;
    this.#publishDurableUpdate = options.publishDurableUpdate;
    this.#requestConversion = options.requestConversion;
    this.#now = options.now ?? (() => new Date());
    this.#createTransactionId = options.createTransactionId ?? generateUuidV7;
    this.#publishDurableBranch = options.publishDurableBranch;
    this.#onBackgroundError = options.onBackgroundError;
    this.#branch = branch;
    this.#record = record;
    this.#page = page;
    this.#history = new PageUndoManager(page);
    this.#online = options.online ?? true;
    this.#sync = this.#deriveSync();
  }

  static async open(
    options: OpenLegacyPageEditingSessionOptions,
  ): Promise<LegacyPageEditingSession> {
    const existing = await options.log.getLegacyBranch(options.pageId);
    const branch =
      existing?.branch ??
      (await createLegacyOfflineBranch({
        branchId: (options.createBranchId ?? generateUuidV7)(),
        pageId: options.pageId,
        baseRevisionId: options.baseRevisionId,
        baseDocument: options.baseDocument,
        createdAt: (options.now ?? (() => new Date()))().toISOString(),
      }));
    if (branch.status === "converted") {
      throw new TypeError("a converted legacy branch must be opened as an active page");
    }
    const page = OperationalPageDocument.create({
      pageId: options.pageId,
      document: branch.localDocument,
    });
    const session = new LegacyPageEditingSession(options, branch, existing, page);
    await session.#ensureEditableBootstrap();
    // Returning to a page that holds unconverted offline work converges it
    // right away: waiting for a gesture or an online *transition* would leave
    // the owner staring at « à synchroniser » until they typed something,
    // even though the device is online and the queue is idle (FR-064).
    session.#scheduleConversion();
    return session;
  }

  /**
   * Gives a freshly opened empty page one paragraph so BlockNote has something
   * to mount and type into.
   *
   * The bootstrap is a real journal transaction — the server replays semantic
   * commands from the base document, so an unjournaled paragraph would fail
   * conversion verification — but it stays in memory until the owner actually
   * writes. A page that was only looked at persists nothing, moves no revision,
   * and activates nothing (plan §6); reopening re-seeds deterministically.
   */
  async #ensureEditableBootstrap(): Promise<void> {
    if (this.#branch.bootstrapTransactionId !== undefined) return;
    if (this.#branch.semanticTransactions.length > 0) return;
    const beforeDocument = this.read();
    if (beforeDocument.blocks.length > 0) return;
    const transaction = this.#page.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: generateUuidV7(), content: [] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    if (!transaction.changed) return;
    const transactionId = this.#createTransactionId();
    const withTransaction = await appendLegacySemanticTransaction(this.#branch, {
      transactionId,
      sequence: 1,
      commands: legacySemanticCommandsFromTransaction({
        pageId: this.pageId,
        beforeDocument,
        transaction,
      }),
    });
    this.#branch = { ...withTransaction, bootstrapTransactionId: transactionId };
  }

  get pageId(): Uuid {
    return this.#page.pageId;
  }

  get branchId(): Uuid {
    return this.#branch.branchId;
  }

  get sync(): PageSyncState {
    return this.#successor?.sync ?? this.#sync;
  }

  get recoveryBuffer(): LegacyPageEditingRecoveryBuffer | null {
    const successor = this.#successor;
    if (successor !== null) {
      const buffer = successor.recoveryBuffer;
      return buffer === null
        ? null
        : {
            pageId: buffer.pageId,
            branchId: null,
            document: copyDocument(buffer.document),
            reason: buffer.reason,
            failedAt: buffer.failedAt,
          };
    }
    return this.#recoveryBuffer === null
      ? null
      : { ...this.#recoveryBuffer, document: copyDocument(this.#recoveryBuffer.document) };
  }

  get canUndo(): boolean {
    return this.#successor?.canUndo ?? this.#history.canUndo;
  }

  get canRedo(): boolean {
    return this.#successor?.canRedo ?? this.#history.canRedo;
  }

  read(): BlockDocumentV3 {
    return this.#successor?.read() ?? this.#page.snapshot();
  }

  canonicalBlockIdForIdentity(blockId: Uuid): Uuid | null {
    return (
      this.#successor?.canonicalBlockIdForIdentity(blockId) ??
      this.#page.canonicalBlockIdForIdentity(blockId)
    );
  }

  subscribe(listener: (change: LegacyPageSessionChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  transact(command: PageCommand | readonly PageCommand[]): Promise<LegacyPageCommitResult> {
    const commands = Array.isArray(command) ? [...command] : [command as PageCommand];
    return this.#enqueue("transact", commands);
  }

  undo(): Promise<LegacyPageCommitResult> {
    return this.#enqueue("undo");
  }

  redo(): Promise<LegacyPageCommitResult> {
    return this.#enqueue("redo");
  }

  setOnline(online: boolean): void {
    if (this.#online === online) return;
    this.#online = online;
    if (this.#successor !== null) {
      this.#successor.setOnline(online);
    } else if (online) {
      // Reconnecting flushes offline edits by converting the branch.
      this.#scheduleConversion();
    }
    this.#refreshSync("status");
  }

  /**
   * Adopts durable operational state for this page.
   *
   * After the in-place upgrade this delegates to the active session. Before
   * it, a converted checkpoint means another driver activated the page behind
   * our back; upgrading (serialized behind pending gestures) keeps local edits
   * alive instead of letting them hit a dead branch.
   *
   * The upgrade is chained onto the gesture queue but not awaited: the
   * durable-page notification that triggers this call is itself awaited by a
   * conversion task running inside that queue, and awaiting the queue here
   * would deadlock the very task that unblocks it.
   */
  async adoptDurablePage(): Promise<void> {
    const successor = this.#successor;
    if (successor !== null) return await successor.adoptDurablePage();
    const state = await this.#log.getState(this.pageId);
    if (state?.status !== "active") return;
    this.#tail = this.#tail.then(() =>
      this.#upgradeToActiveSession().catch((error) => {
        this.#onBackgroundError?.(error);
      }),
    );
  }

  async retryBlockedCommit(): Promise<LegacyPageCommitResult> {
    const successor = this.#successor;
    if (successor !== null) {
      const result = await successor.retryBlockedCommit();
      if (!result.changed) {
        return { changed: false, document: this.read() } satisfies UnchangedLegacyPageEditResult;
      }
      return {
        changed: true,
        transactionId: result.updateId,
        transaction: result.transaction,
        committed: null,
        document: this.read(),
      } satisfies DurableLegacyPageEditResult;
    }
    const failed = this.#failedCommit;
    if (failed === null) throw new LegacyPageEditingSessionBlockedError();
    this.#localCommit = "saving";
    this.#localBlockedReason = undefined;
    this.#refreshSync("recovery");
    try {
      const committed = await this.#commitOrRecover(failed.input);
      this.#recordDurableCommit(committed);
      this.#failedCommit = null;
      this.#recoveryBuffer = null;
      this.#localCommit = "idle";
      this.#refreshSync("recovery", failed.transaction, failed.transactionId);
      return {
        changed: true,
        transactionId: failed.transactionId,
        transaction: failed.transaction,
        committed,
        document: this.read(),
      };
    } catch (error) {
      this.#blockAfterLocalFailure(error, failed);
      throw error;
    }
  }

  #enqueue(
    kind: GestureKind,
    commands: readonly PageCommand[] = [],
  ): Promise<LegacyPageCommitResult> {
    if (this.#localCommit === "blocked") {
      return Promise.reject(new LegacyPageEditingSessionBlockedError());
    }
    if (this.#successor !== null && this.#successor.sync.kind === "blocked") {
      return Promise.reject(new LegacyPageEditingSessionBlockedError());
    }
    if (this.#successor === null && this.#branch.status !== "editing") {
      return Promise.reject(new LegacyPageEditingSessionBlockedError());
    }
    this.#queuedTransactions += 1;
    this.#localCommit = "saving";
    this.#refreshSync("status");

    const result = this.#tail.then(async () => {
      if (this.#localCommit === "blocked") throw new LegacyPageEditingSessionBlockedError();
      if (this.#successor !== null) return await this.#execOnSuccessor(kind, commands);
      return await this.#execOnBranch(kind, commands);
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
      if (!this.#publishHandoverProjectionIfIdle()) this.#refreshSync("status");
      this.#scheduleConversion();
    });
  }

  async #execOnSuccessor(
    kind: GestureKind,
    commands: readonly PageCommand[],
  ): Promise<LegacyPageCommitResult> {
    const successor = this.#successor;
    if (successor === null) throw new LegacyPageEditingSessionBlockedError();
    const result =
      kind === "transact"
        ? await successor.transact(commands)
        : kind === "undo"
          ? await successor.undo()
          : await successor.redo();
    if (!result.changed) {
      return { changed: false, document: this.read() } satisfies UnchangedLegacyPageEditResult;
    }
    return {
      changed: true,
      transactionId: result.updateId,
      transaction: result.transaction,
      committed: null,
      document: this.read(),
    } satisfies DurableLegacyPageEditResult;
  }

  async #execOnBranch(
    kind: GestureKind,
    commands: readonly PageCommand[],
  ): Promise<LegacyPageCommitResult> {
    const beforeDocument = this.#page.snapshot();
    const transaction =
      kind === "transact"
        ? this.#history.execute(commands)
        : kind === "undo"
          ? this.#history.undo()
          : this.#history.redo();
    if (transaction === null || !transaction.changed) {
      return { changed: false, document: this.read() } satisfies UnchangedLegacyPageEditResult;
    }
    const transactionId = this.#createTransactionId();
    let failed: FailedLegacyCommit | null = null;
    try {
      const semanticCommands = legacySemanticCommandsFromTransaction({
        pageId: this.pageId,
        beforeDocument,
        transaction,
      });
      const branch = await appendLegacySemanticTransaction(this.#branch, {
        transactionId,
        sequence: this.#branch.semanticTransactions.length + 1,
        commands: semanticCommands,
      });
      const projection = await this.#page.project();
      const input: CommitLegacyPageBranchInput = {
        branch,
        requiredFileIds: projection.fileUsageIds,
        expectedRecordVersion: this.#record?.recordVersion ?? 0,
      };
      failed = { input, transaction, transactionId };
      const committed = await this.#commitOrRecover(input);
      this.#recordDurableCommit(committed);
      this.#refreshSync("local", transaction, transactionId);
      return {
        changed: true,
        transactionId,
        transaction,
        committed,
        document: this.read(),
      } satisfies DurableLegacyPageEditResult;
    } catch (error) {
      if (
        error instanceof ConcurrentLegacyPageBranchError &&
        (await this.#tryUpgradeAfterExternalConversion())
      ) {
        // Another driver converted the branch behind our back; replay the
        // gesture against the resumed active session instead of blocking.
        return await this.#execOnSuccessor(kind, commands);
      }
      this.#blockAfterLocalFailure(error, failed);
      throw error;
    }
  }

  async #commitOrRecover(input: CommitLegacyPageBranchInput): Promise<LegacyOfflineBranchRecord> {
    try {
      return await this.#store.commitLegacyBranch(input);
    } catch (error) {
      try {
        const durable = await this.#log.getLegacyBranch(this.pageId);
        if (sameDurableBranch(durable, input)) return durable;
      } catch (verificationError) {
        this.#onBackgroundError?.(verificationError);
      }
      throw error;
    }
  }

  #recordDurableCommit(committed: LegacyOfflineBranchRecord): void {
    this.#branch = committed.branch;
    this.#record = committed;
    try {
      this.#publishDurableBranch?.(committed.branchId);
    } catch (error) {
      this.#onBackgroundError?.(error);
    }
  }

  /**
   * Converts the branch at a queue drain point (plan §6).
   *
   * Running inside the serial queue makes the transition atomic for editing:
   * gestures enqueued before the task are part of the converted journal, and
   * gestures enqueued after it dispatch to the upgraded active session.
   */
  #scheduleConversion(): void {
    if (
      this.#requestConversion === undefined ||
      this.#activeStore === undefined ||
      this.#converting ||
      this.#successor !== null ||
      !this.#online
    ) {
      return;
    }
    if (!this.#hasUserEdits()) return; // Looking at a page migrates nothing.
    const requestConversion = this.#requestConversion;
    if (requestConversion === undefined) return;
    this.#converting = true;
    this.#refreshSync("status");
    const task = this.#tail.then(async () => {
      try {
        if (this.#successor === null) {
          const outcome = await requestConversion();
          if (outcome === "converted") {
            // Not awaited: the upgrade resumes from durable state
            // concurrently with the queue, and any gesture that still reaches
            // the converted branch is caught by the concurrency net and
            // replayed on the successor. Awaiting it here would let the
            // durable-page listener's own queued upgrade block this task.
            this.#upgradeToActiveSession().catch((error) => {
              this.#onBackgroundError?.(error);
            });
          }
        }
      } catch (error) {
        this.#onBackgroundError?.(error);
      } finally {
        this.#converting = false;
        this.#refreshSync("status");
      }
    });
    this.#tail = task.then(
      () => undefined,
      () => undefined,
    );
  }

  #hasUserEdits(): boolean {
    const bootstrapCount = this.#branch.bootstrapTransactionId === undefined ? 0 : 1;
    return this.#branch.semanticTransactions.length > bootstrapCount;
  }

  async #tryUpgradeAfterExternalConversion(): Promise<boolean> {
    try {
      await this.#upgradeToActiveSession();
      return true;
    } catch (upgradeError) {
      this.#onBackgroundError?.(upgradeError);
      return false;
    }
  }

  #upgradeToActiveSession(): Promise<void> {
    this.#upgrade ??= this.#doUpgrade().catch((error) => {
      this.#upgrade = null;
      throw error;
    });
    return this.#upgrade;
  }

  async #doUpgrade(): Promise<void> {
    const activeStore = this.#activeStore;
    if (activeStore === undefined) {
      throw new Error("the legacy page cannot upgrade without an active store");
    }
    const resumed = await PageEditingSession.resume({
      pageId: this.pageId,
      log: this.#log,
      store: activeStore,
      online: this.#online,
      ...(this.#publishDurableUpdate === undefined
        ? {}
        : { publishDurableUpdate: this.#publishDurableUpdate }),
      ...(this.#onBackgroundError === undefined
        ? {}
        : { onBackgroundError: this.#onBackgroundError }),
    });
    if (resumed === null) throw new Error("the converted page has no usable active checkpoint");
    resumed.subscribe((change) => {
      for (const listener of this.#listeners) {
        listener({
          origin: change.origin,
          document: change.document,
          sync: change.sync,
          ...(change.transaction === undefined ? {} : { transaction: change.transaction }),
          ...(change.updateId === undefined ? {} : { transactionId: change.updateId }),
        });
      }
    });
    this.#successor = resumed;
    // The checkpoint can contain edits made on other devices while this
    // legacy branch was offline. Publishing only a status transition leaves
    // the mounted editor on the branch projection even though `read()` now
    // points at the merged active document. Besides hiding remote work, a
    // later editor change can then translate that stale projection back into
    // local operations. The event must nevertheless wait for gestures already
    // visible in BlockNote to finish replaying onto the successor; applying an
    // earlier checkpoint in the middle of that queue would erase their visual
    // projection. The last queued transaction publishes the final merged
    // document, or this does so immediately when the queue is already idle.
    this.#handoverProjectionPending = true;
    if (!this.#publishHandoverProjectionIfIdle()) this.#refreshSync("status");
  }

  #publishHandoverProjectionIfIdle(): boolean {
    if (!this.#handoverProjectionPending || this.#queuedTransactions !== 0) return false;
    this.#handoverProjectionPending = false;
    this.#refreshSync("remote");
    return true;
  }

  #blockAfterLocalFailure(error: unknown, failed: FailedLegacyCommit | null): void {
    const reason = blockedReason(error);
    this.#localCommit = "blocked";
    this.#localBlockedReason = reason;
    this.#failedCommit = failed;
    this.#recoveryBuffer = {
      pageId: this.pageId,
      branchId: failed?.input.branch.branchId ?? this.#branch.branchId,
      document: copyDocument(this.read()),
      reason,
      failedAt: this.#now().toISOString(),
    };
    this.#refreshSync("recovery", failed?.transaction, failed?.transactionId);
  }

  #deriveSync(): PageSyncState {
    const successor = this.#successor;
    if (successor !== null) return successor.sync;
    const status = branchTransportStatus(this.#record);
    return derivePageSyncState({
      localCommit: this.#localCommit,
      ...(this.#localBlockedReason === undefined
        ? {}
        : { localBlockedReason: this.#localBlockedReason }),
      online: this.#online,
      operationState: null,
      updates: status === null ? [] : [{ status }],
      ambiguities: [],
      importingRemote: this.#converting,
    });
  }

  #refreshSync(
    origin: LegacyPageSessionChange["origin"],
    transaction?: PageTransactionResult,
    transactionId?: Uuid,
  ): void {
    this.#sync = this.#deriveSync();
    const change: LegacyPageSessionChange = {
      origin,
      document: this.read(),
      sync: this.#sync,
      ...(transaction === undefined ? {} : { transaction }),
      ...(transactionId === undefined ? {} : { transactionId }),
    };
    for (const listener of this.#listeners) listener(change);
  }
}
