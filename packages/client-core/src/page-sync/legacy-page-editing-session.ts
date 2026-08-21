/**
 * Editor owner for a v2 page that has never received a shared operational
 * checkpoint. It persists semantic transactions only; device-local bootstrap
 * bytes are intentionally never sent as if they belonged to shared history.
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
import type {
  CommitLegacyPageBranchInput,
  LegacyPageBranchCommitter,
} from "./legacy-page-state.ts";
import {
  derivePageSyncState,
  type PageSyncBlockedReason,
  type PageSyncState,
} from "./page-sync-state.ts";

export interface LegacyPageEditingRecoveryBuffer {
  readonly pageId: Uuid;
  readonly branchId: Uuid;
  readonly document: BlockDocumentV3;
  readonly reason: PageSyncBlockedReason;
  readonly failedAt: string;
}

export interface DurableLegacyPageEditResult {
  readonly changed: true;
  readonly transactionId: Uuid;
  readonly transaction: PageTransactionResult;
  readonly committed: LegacyOfflineBranchRecord;
  readonly document: BlockDocumentV3;
}

export interface UnchangedLegacyPageEditResult {
  readonly changed: false;
  readonly document: BlockDocumentV3;
}

export type LegacyPageCommitResult = DurableLegacyPageEditResult | UnchangedLegacyPageEditResult;

export interface LegacyPageSessionChange {
  readonly origin: "local" | "status" | "recovery";
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
  readonly #now: () => Date;
  readonly #createTransactionId: () => Uuid;
  readonly #publishDurableBranch: ((branchId: Uuid) => void) | undefined;
  readonly #onBackgroundError: ((error: unknown) => void) | undefined;
  readonly #listeners = new Set<(change: LegacyPageSessionChange) => void>();
  readonly #page: OperationalPageDocument;
  readonly #history: PageUndoManager;
  #branch: LegacyOfflineBranch;
  #record: LegacyOfflineBranchRecord | null;
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
    return new LegacyPageEditingSession(options, branch, existing, page);
  }

  get pageId(): Uuid {
    return this.#page.pageId;
  }

  get branchId(): Uuid {
    return this.#branch.branchId;
  }

  get sync(): PageSyncState {
    return this.#sync;
  }

  get recoveryBuffer(): LegacyPageEditingRecoveryBuffer | null {
    return this.#recoveryBuffer === null
      ? null
      : { ...this.#recoveryBuffer, document: copyDocument(this.#recoveryBuffer.document) };
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

  subscribe(listener: (change: LegacyPageSessionChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  transact(command: PageCommand | readonly PageCommand[]): Promise<LegacyPageCommitResult> {
    const commands = Array.isArray(command) ? [...command] : [command as PageCommand];
    return this.#enqueue(() => this.#history.execute(commands));
  }

  undo(): Promise<LegacyPageCommitResult> {
    return this.#enqueue(() => this.#history.undo());
  }

  redo(): Promise<LegacyPageCommitResult> {
    return this.#enqueue(() => this.#history.redo());
  }

  setOnline(online: boolean): void {
    if (this.#online === online) return;
    this.#online = online;
    this.#refreshSync("status");
  }

  async retryBlockedCommit(): Promise<LegacyPageCommitResult> {
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

  #enqueue(transact: () => PageTransactionResult | null): Promise<LegacyPageCommitResult> {
    if (this.#localCommit === "blocked" || this.#branch.status !== "editing") {
      return Promise.reject(new LegacyPageEditingSessionBlockedError());
    }
    this.#queuedTransactions += 1;
    this.#localCommit = "saving";
    this.#refreshSync("status");

    const result = this.#tail.then(async () => {
      if (this.#localCommit === "blocked") throw new LegacyPageEditingSessionBlockedError();
      const beforeDocument = this.#page.snapshot();
      const transaction = transact();
      if (transaction === null || !transaction.changed) {
        return { changed: false, document: this.read() } satisfies UnchangedLegacyPageEditResult;
      }
      const transactionId = this.#createTransactionId();
      let failed: FailedLegacyCommit | null = null;
      try {
        const commands = legacySemanticCommandsFromTransaction({
          pageId: this.pageId,
          beforeDocument,
          transaction,
        });
        const branch = await appendLegacySemanticTransaction(this.#branch, {
          transactionId,
          sequence: this.#branch.semanticTransactions.length + 1,
          commands,
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
        this.#blockAfterLocalFailure(error, failed);
        throw error;
      }
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
