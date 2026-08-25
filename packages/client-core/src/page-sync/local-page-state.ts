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
  OperationalPageDocument,
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
import { withPageStateWrite } from "./page-write-coordinator.ts";

export type LocalPageCommitPhase =
  | "before-encryption"
  | "after-encryption"
  | "after-update-write"
  | "after-state-write"
  | "after-commit";

export interface LocalPageCommitHooks {
  /** Synchronous by design: asynchronous work inside a Dexie transaction can close it early. */
  readonly at?: (phase: LocalPageCommitPhase) => void;
  /** Refuse a late editor write after the workspace item stopped being a page. */
  readonly requireCurrentPage?: boolean;
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

export class PageAuthorityRetiredError extends Error {
  constructor(pageId: Uuid) {
    super(`page operation authority is retired: ${pageId}`);
    this.name = "PageAuthorityRetiredError";
  }
}

function assertTransactionMatchesPage(
  transaction: PageTransactionResult,
  pageVersionVector: Uint8Array,
  pageFrontiers: Uint8Array,
  checkpointVersionVector: Uint8Array,
  checkpointFrontiers: Uint8Array,
  projectionFrontiers: Uint8Array,
  requireExactTransactionResult: boolean,
): void {
  if (!transaction.changed || transaction.updateBytes.byteLength === 0) {
    throw new TypeError("an unchanged page transaction has no durable update to commit");
  }
  if (
    requireExactTransactionResult &&
    !versionVectorBytesEqual(transaction.resultVersionVector, pageVersionVector)
  ) {
    throw new TypeError("page transaction and in-memory version vectors differ");
  }
  if (!versionVectorDominates(pageVersionVector, transaction.resultVersionVector)) {
    throw new TypeError("durable page state does not include the local transaction");
  }
  if (!versionVectorDominates(pageVersionVector, checkpointVersionVector)) {
    throw new TypeError("page transaction does not descend from its checkpoint");
  }
  if (!operationalFrontiersEqual(pageFrontiers, projectionFrontiers)) {
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
  readonly #requireCurrentPage: boolean;

  constructor(log: EncryptedPageOperationLog, hooks: LocalPageCommitHooks = {}) {
    this.#log = log;
    this.#hooks = hooks;
    this.#requireCurrentPage = hooks.requireCurrentPage ?? false;
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
    return await withPageStateWrite(
      this.#log.db,
      input.page.pageId,
      async () => await this.#commitLocalTransaction(input),
    );
  }

  async #commitLocalTransaction(
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

    // The session serialises local gestures, so the common case starts from
    // the exact frontier already committed in the state row. Its in-memory
    // page is then the proof document for this transaction; rebuilding the
    // same 500-block checkpoint and replaying the whole pending journal on
    // every key only delays paint. A different frontier still takes the full
    // reconstruction path so a write made by another tab is merged (or
    // rejected as causally incomplete) before the atomic record-version gate.
    const startsAtDurableFrontier =
      previous === null ||
      versionVectorBytesEqual(previous.versionVector, input.transaction.baseVersionVector);
    let durablePage = input.page;
    if (
      !startsAtDurableFrontier &&
      previous?.checkpoint !== null &&
      previous?.checkpoint !== undefined
    ) {
      durablePage = await OperationalPageDocument.fromCheckpoint({
        pageId: input.page.pageId,
        checkpoint: previous.checkpoint,
      });
      const durableUpdates = await this.#log.listUpdates(input.page.pageId);
      if (durablePage.importUpdates(durableUpdates.map(({ updateBytes }) => updateBytes)).pending) {
        throw new ConcurrentLocalPageStateError();
      }
      if (!versionVectorBytesEqual(durablePage.versionVectorBytes(), previous.versionVector)) {
        throw new ConcurrentLocalPageStateError();
      }
      if (durablePage.importUpdate(input.transaction.updateBytes).pending) {
        throw new ConcurrentLocalPageStateError();
      }
    }

    const checkpointPromise =
      input.forceCheckpoint === true || previous?.checkpoint == null
        ? durablePage.checkpoint()
        : Promise.resolve(previous.checkpoint);
    const [checkpoint, projection, updateDigest] = await Promise.all([
      checkpointPromise,
      durablePage.project(),
      sha256Hex(input.transaction.updateBytes),
    ]);
    const durableVersionVector = durablePage.versionVectorBytes();
    assertTransactionMatchesPage(
      input.transaction,
      durableVersionVector,
      projection.operationalFrontier,
      checkpoint.versionVector,
      checkpoint.frontiers,
      projection.operationalFrontier,
      startsAtDurableFrontier,
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
      versionVector: durableVersionVector,
      frontiers: projection.operationalFrontier,
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
      [this.#log.db.items, this.#log.db.pageOperationStates, this.#log.db.pageOperationUpdates],
      async () => {
        if (this.#requireCurrentPage) {
          const item = await this.#log.db.items.get(input.page.pageId);
          if (item?.kind !== "page") throw new PageAuthorityRetiredError(input.page.pageId);
        }
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
