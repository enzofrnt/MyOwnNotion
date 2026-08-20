/**
 * Atomic local durability for an editor transaction.
 *
 * Crypto is completed before Dexie opens the write transaction. The update
 * row and the state row are then committed together, guarded by the state
 * record version so two tabs cannot silently overwrite one another's
 * checkpoint. Only a successful return means the transaction is durable on
 * this device.
 */

import type { Uuid } from "@myownnotion/domain";
import {
  OPERATIONAL_FORMAT_VERSION,
  type OperationalPageDocument,
  operationalFrontiersEqual,
  type PageTransactionResult,
  sha256Hex,
  versionVectorBytesEqual,
  versionVectorDominates,
} from "@myownnotion/page-state";
import type {
  EncryptedPageOperationLog,
  PageOperationStateRecord,
  PageOperationUpdateRecord,
} from "./encrypted-update-log.ts";

export type LocalPageCommitPhase =
  | "before-encryption"
  | "after-encryption"
  | "after-update-write"
  | "after-state-write"
  | "after-commit";

export interface LocalPageCommitHooks {
  /** Synchronous by design: asynchronous work inside a Dexie transaction can close it early. */
  readonly at?: (phase: LocalPageCommitPhase) => void;
}

export interface CommitLocalPageTransactionInput {
  readonly page: OperationalPageDocument;
  readonly transaction: PageTransactionResult;
  readonly updateId: Uuid;
  readonly enqueueOrder: number;
  readonly createdAt?: string;
  readonly latestServerPageSequence?: number;
  readonly serverVersionVector?: Uint8Array | null;
  /** Force a fresh snapshot; ordinary edits retain the last verified checkpoint. */
  readonly forceCheckpoint?: boolean;
}

export interface CommittedLocalPageTransaction {
  readonly state: PageOperationStateRecord;
  readonly update: PageOperationUpdateRecord;
}

export class ConcurrentLocalPageStateError extends Error {
  constructor() {
    super("the local page state advanced in another tab before this transaction committed");
    this.name = "ConcurrentLocalPageStateError";
  }
}

export class DuplicatePageUpdateIdError extends Error {
  constructor(updateId: Uuid) {
    super(`page operation update id already exists: ${updateId}`);
    this.name = "DuplicatePageUpdateIdError";
  }
}

function assertTransactionMatchesPage(
  transaction: PageTransactionResult,
  pageVersionVector: Uint8Array,
  checkpointVersionVector: Uint8Array,
  checkpointFrontiers: Uint8Array,
  projectionFrontiers: Uint8Array,
): void {
  if (!transaction.changed || transaction.updateBytes.byteLength === 0) {
    throw new TypeError("an unchanged page transaction has no durable update to commit");
  }
  if (!versionVectorBytesEqual(transaction.resultVersionVector, pageVersionVector)) {
    throw new TypeError("page transaction and in-memory version vectors differ");
  }
  if (!versionVectorDominates(transaction.resultVersionVector, checkpointVersionVector)) {
    throw new TypeError("page transaction does not descend from its checkpoint");
  }
  if (!operationalFrontiersEqual(transaction.resultFrontiers, projectionFrontiers)) {
    throw new TypeError("page transaction and projection frontiers differ");
  }
  if (
    versionVectorBytesEqual(transaction.resultVersionVector, checkpointVersionVector) &&
    !operationalFrontiersEqual(transaction.resultFrontiers, checkpointFrontiers)
  ) {
    throw new TypeError("page transaction and current checkpoint frontiers differ");
  }
}

export class LocalPageStateStore {
  readonly #log: EncryptedPageOperationLog;
  readonly #hooks: LocalPageCommitHooks;

  constructor(log: EncryptedPageOperationLog, hooks: LocalPageCommitHooks = {}) {
    this.#log = log;
    this.#hooks = hooks;
  }

  /**
   * Persists one already-applied editor transaction.
   *
   * The in-memory page is intentionally an input: the editor owns its live
   * session, while this service proves that its exact resulting checkpoint and
   * projection reach IndexedDB together with the immutable update bytes.
   */
  async commitLocalTransaction(
    input: CommitLocalPageTransactionInput,
  ): Promise<CommittedLocalPageTransaction> {
    if (input.page.pageId === undefined) {
      throw new TypeError("an operational page id is required");
    }
    if (!Number.isInteger(input.enqueueOrder) || input.enqueueOrder < 0) {
      throw new TypeError("enqueueOrder must be a non-negative integer");
    }

    const previous = await this.#log.getState(input.page.pageId);
    const expectedStateRecordVersion = previous?.recordVersion ?? 0;
    this.#hooks.at?.("before-encryption");

    const checkpointPromise =
      input.forceCheckpoint === true || previous?.checkpoint == null
        ? input.page.checkpoint()
        : Promise.resolve(previous.checkpoint);
    const [checkpoint, projection, updateDigest] = await Promise.all([
      checkpointPromise,
      input.page.project(),
      sha256Hex(input.transaction.updateBytes),
    ]);
    assertTransactionMatchesPage(
      input.transaction,
      input.page.versionVectorBytes(),
      checkpoint.versionVector,
      checkpoint.frontiers,
      projection.operationalFrontier,
    );

    const createdAt = input.createdAt ?? new Date().toISOString();
    const state: PageOperationStateRecord = {
      pageId: input.page.pageId,
      status: "active",
      operationalVersion: OPERATIONAL_FORMAT_VERSION,
      canonicalFormatVersion: 3,
      latestServerPageSequence:
        input.latestServerPageSequence ?? previous?.latestServerPageSequence ?? 0,
      localAvailability: "present",
      lastAccessedAt: createdAt,
      recordVersion: expectedStateRecordVersion + 1,
      checkpoint,
      projection,
      versionVector: input.transaction.resultVersionVector,
      frontiers: input.transaction.resultFrontiers,
      serverVersionVector:
        input.serverVersionVector === undefined
          ? (previous?.serverVersionVector ?? null)
          : input.serverVersionVector,
    };
    const update: PageOperationUpdateRecord = {
      updateId: input.updateId,
      pageId: input.page.pageId,
      status: "pending",
      enqueueOrder: input.enqueueOrder,
      createdAt,
      recordVersion: 1,
      operationalVersion: OPERATIONAL_FORMAT_VERSION,
      baseVersionVector: input.transaction.baseVersionVector,
      resultVersionVector: input.transaction.resultVersionVector,
      resultFrontiers: input.transaction.resultFrontiers,
      updateBytes: input.transaction.updateBytes,
      updateDigest,
      semanticChanges: input.transaction.semanticChanges,
    };

    const [sealedState, sealedUpdate] = await Promise.all([
      this.#log.codec.sealState(state),
      this.#log.codec.sealUpdate(update),
    ]);
    this.#hooks.at?.("after-encryption");

    await this.#log.db.transaction(
      "rw",
      [this.#log.db.pageOperationStates, this.#log.db.pageOperationUpdates],
      async () => {
        const current = await this.#log.db.pageOperationStates.get(input.page.pageId);
        if ((current?.recordVersion ?? 0) !== expectedStateRecordVersion) {
          throw new ConcurrentLocalPageStateError();
        }
        if ((await this.#log.db.pageOperationUpdates.get(input.updateId)) !== undefined) {
          throw new DuplicatePageUpdateIdError(input.updateId);
        }
        await this.#log.db.pageOperationUpdates.add(sealedUpdate);
        this.#hooks.at?.("after-update-write");
        await this.#log.db.pageOperationStates.put(sealedState);
        this.#hooks.at?.("after-state-write");
      },
    );
    this.#hooks.at?.("after-commit");

    return { state, update };
  }
}
