/**
 * Durable, idempotent reconciliation for one operational page.
 *
 * HTTP success is never the durability boundary. A response is first verified,
 * imported into a page reconstructed from encrypted IndexedDB state, projected,
 * checkpointed and committed atomically with the server cursor. Only then may
 * the caller update an open editor or announce synchronization.
 */

import {
  type ActivePageSyncRequestDto,
  type ActivePageSyncResponseDto,
  type LegacyOfflineBranchSyncRequestDto,
  type LegacySemanticCommandDto,
  MAX_PAGE_UPDATE_BATCH_BYTES,
  MAX_PAGE_UPDATES_PER_SYNC,
  type PageCheckpointResponseDto,
  type PageOperationProblemDto,
  type PageSyncRequestDto,
  type PageSyncResponseDto,
} from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  OperationalPageDocument,
  sha256Hex,
  versionVectorDominates,
} from "@myownnotion/page-state";
import type {
  EncryptedPageOperationLog,
  LegacyOfflineBranchRecord,
  PageOperationStateRecord,
  PageOperationUpdateRecord,
} from "./encrypted-update-log.ts";
import { decodePageOperationBytes, encodePageOperationBytes } from "./encrypted-update-log.ts";
import { withPageStateWrite } from "./page-write-coordinator.ts";

export interface PageUpdateBatchCandidate {
  readonly updateBytes: Uint8Array;
}

export interface PageUpdateBatchLimits {
  readonly maxCount: number;
  readonly maxBytes: number;
}

export class OversizedPageUpdateError extends Error {
  constructor() {
    super("one durable page update exceeds the synchronization request limit");
    this.name = "OversizedPageUpdateError";
  }
}

/** Selects a prefix: skipping a large earlier update would violate causal order. */
export function selectPageUpdateBatch<T extends PageUpdateBatchCandidate>(
  updates: readonly T[],
  limits: PageUpdateBatchLimits = {
    maxCount: MAX_PAGE_UPDATES_PER_SYNC,
    maxBytes: MAX_PAGE_UPDATE_BATCH_BYTES,
  },
): T[] {
  if (!Number.isInteger(limits.maxCount) || limits.maxCount < 1 || limits.maxBytes < 1) {
    throw new TypeError("page update batch limits must be positive");
  }
  const selected: T[] = [];
  let bytes = 0;
  for (const update of updates) {
    if (update.updateBytes.byteLength > limits.maxBytes && selected.length === 0) {
      throw new OversizedPageUpdateError();
    }
    if (
      selected.length >= limits.maxCount ||
      bytes + update.updateBytes.byteLength > limits.maxBytes
    ) {
      break;
    }
    selected.push(update);
    bytes += update.updateBytes.byteLength;
  }
  return selected;
}

export type PageSyncTransportResult =
  | { readonly ok: true; readonly value: PageSyncResponseDto }
  | {
      readonly ok: false;
      readonly offline: boolean;
      readonly problem:
        | Pick<PageOperationProblemDto, "code" | "message">
        | {
            readonly code: string;
            readonly message: string;
          };
    };

export interface PageSyncTransport {
  sync(pageId: Uuid, request: PageSyncRequestDto): Promise<PageSyncTransportResult>;
  convertLegacyBranch(
    pageId: Uuid,
    request: LegacyOfflineBranchSyncRequestDto,
  ): Promise<PageSyncTransportResult>;
}

export type PageFileRequirement = ActivePageSyncResponseDto["fileRequirements"][number];

export interface PageReconcileOutcome {
  readonly kind: "synced" | "pending" | "offline" | "blocked";
  readonly exchanges: number;
  readonly latestPageSequence: number;
  readonly fileRequirements: readonly PageFileRequirement[];
  readonly problemCode?: string;
}

export interface PageReconcilerOptions {
  readonly pageId: Uuid;
  readonly log: EncryptedPageOperationLog;
  readonly transport: PageSyncTransport;
  readonly createRequestId?: () => Uuid;
  readonly now?: () => Date;
  readonly maxRemoteBytes?: number;
  readonly maxExchanges?: number;
  readonly onFileRequirements?: (requirements: readonly PageFileRequirement[]) => void;
  /** Runs only after the exact merged checkpoint is durable. */
  readonly onDurablePage?: (state: PageOperationStateRecord) => void | Promise<void>;
  /** UI propagation failures cannot roll back a response already durable in IndexedDB. */
  readonly onBackgroundError?: (error: unknown) => void;
}

class ConcurrentPageReconciliationError extends Error {
  constructor() {
    super("local page state advanced while a synchronization response was being committed");
    this.name = "ConcurrentPageReconciliationError";
  }
}

class InvalidPageSyncResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPageSyncResponseError";
  }
}

/**
 * Installs a server-created genesis/checkpoint without ever inventing a second
 * local CRDT history for the same legacy JSON document.
 */
export async function installPageCheckpoint(
  log: EncryptedPageOperationLog,
  response: PageCheckpointResponseDto,
  now: Date = new Date(),
): Promise<PageOperationStateRecord> {
  return await withPageStateWrite(
    log.db,
    response.pageId as Uuid,
    async () => await installPageCheckpointInsideWrite(log, response, now),
  );
}

async function installPageCheckpointInsideWrite(
  log: EncryptedPageOperationLog,
  response: PageCheckpointResponseDto,
  now: Date,
): Promise<PageOperationStateRecord> {
  const pageId = response.pageId as Uuid;
  const existing = await log.getState(pageId);
  if (existing !== null) return existing;
  const page = await OperationalPageDocument.fromSnapshotTransport({
    pageId,
    snapshotBytes: decodePageOperationBytes(response.checkpointBytes),
    snapshotDigest: response.checkpointDigest,
    versionVector: decodePageOperationBytes(response.versionVector),
  });
  const checkpointProjection = await page.project();
  if (checkpointProjection.canonicalDigest !== response.canonicalDigest) {
    throw new InvalidPageSyncResponseError("the checkpoint canonical projection has a bad digest");
  }
  let appliedPageSequence = response.throughPageSequence;
  for (const remote of response.followingUpdates) {
    const bytes = decodePageOperationBytes(remote.updateBytes);
    if ((await sha256Hex(bytes)) !== remote.updateDigest) {
      throw new InvalidPageSyncResponseError("a checkpoint update failed its digest check");
    }
    const imported = page.importUpdate(bytes);
    if (imported.pending) {
      throw new InvalidPageSyncResponseError("a checkpoint update has missing dependencies");
    }
    appliedPageSequence = remote.pageSequence;
  }
  const [checkpoint, projection] = await Promise.all([page.checkpoint(), page.project()]);
  const state: PageOperationStateRecord = {
    pageId,
    status: "active",
    operationalVersion: response.operationalVersion,
    canonicalFormatVersion: 3,
    latestServerPageSequence: appliedPageSequence,
    localAvailability: "present",
    lastAccessedAt: now.toISOString(),
    recordVersion: 1,
    checkpoint,
    projection,
    versionVector: checkpoint.versionVector,
    frontiers: checkpoint.frontiers,
    serverVersionVector: response.hasMore ? null : checkpoint.versionVector,
  };
  const sealed = await log.codec.sealState(state);
  await log.db.transaction("rw", log.db.pageOperationStates, async () => {
    if ((await log.db.pageOperationStates.get(pageId)) !== undefined) {
      throw new ConcurrentPageReconciliationError();
    }
    await log.db.pageOperationStates.add(sealed);
  });
  return state;
}

const BLOCKING_PROBLEMS = new Set([
  "page-operations.protocol-read-only",
  "page-operations.update-id-reused",
  "page-operations.digest-mismatch",
  "page-operations.projection-invalid",
  "page-operations.device-revoked",
  "page-operations.quota",
  "page-operations.schema-unsupported",
]);

function pageUpdateRequest(update: PageOperationUpdateRecord) {
  return {
    updateId: update.updateId,
    baseVersionVector: encodePageOperationBytes(update.baseVersionVector),
    updateBytes: encodePageOperationBytes(update.updateBytes),
    updateDigest: update.updateDigest,
    createdAt: update.createdAt,
  };
}

async function reconstructPage(
  pageId: Uuid,
  state: PageOperationStateRecord,
  updates: readonly PageOperationUpdateRecord[],
): Promise<OperationalPageDocument> {
  if (state.status !== "active" || state.checkpoint === null) {
    throw new InvalidPageSyncResponseError("the local page has no active verified checkpoint");
  }
  const page = await OperationalPageDocument.fromCheckpoint({
    pageId,
    checkpoint: state.checkpoint,
  });
  for (const update of updates) {
    const imported = page.importUpdate(update.updateBytes);
    if (imported.pending) {
      throw new InvalidPageSyncResponseError(
        "the encrypted local page log has missing dependencies",
      );
    }
  }
  if (!versionVectorDominates(page.versionVectorBytes(), state.versionVector)) {
    throw new InvalidPageSyncResponseError(
      "the encrypted local page frontier cannot be reconstructed",
    );
  }
  return page;
}

export class PageReconciler {
  readonly #pageId: Uuid;
  readonly #log: EncryptedPageOperationLog;
  readonly #transport: PageSyncTransport;
  readonly #createRequestId: () => Uuid;
  readonly #now: () => Date;
  readonly #maxRemoteBytes: number;
  readonly #maxExchanges: number;
  readonly #onFileRequirements: PageReconcilerOptions["onFileRequirements"];
  readonly #onDurablePage: PageReconcilerOptions["onDurablePage"];
  readonly #onBackgroundError: PageReconcilerOptions["onBackgroundError"];
  readonly #durablePageListeners = new Set<
    (state: PageOperationStateRecord) => void | Promise<void>
  >();
  #inFlight: Promise<PageReconcileOutcome> | null = null;
  #anotherPassRequested = false;
  #legacyBranchConversionRequested = false;

  constructor(options: PageReconcilerOptions) {
    this.#pageId = options.pageId;
    this.#log = options.log;
    this.#transport = options.transport;
    this.#createRequestId = options.createRequestId ?? generateUuidV7;
    this.#now = options.now ?? (() => new Date());
    this.#maxRemoteBytes = options.maxRemoteBytes ?? MAX_PAGE_UPDATE_BATCH_BYTES;
    this.#maxExchanges = options.maxExchanges ?? 256;
    this.#onFileRequirements = options.onFileRequirements;
    this.#onDurablePage = options.onDurablePage;
    this.#onBackgroundError = options.onBackgroundError;
  }

  synchronize(): Promise<PageReconcileOutcome> {
    return this.#requestSynchronization(false);
  }

  /**
   * Converts a pre-activation branch only when its editing session has reached
   * a serial queue boundary. Background pulls must never call this method:
   * converting an in-flight branch can install a checkpoint that predates
   * already acknowledged local gestures.
   */
  convertLegacyBranch(): Promise<PageReconcileOutcome> {
    return this.#requestSynchronization(true);
  }

  #requestSynchronization(convertLegacyBranch: boolean): Promise<PageReconcileOutcome> {
    if (convertLegacyBranch) this.#legacyBranchConversionRequested = true;
    if (this.#inFlight !== null) {
      this.#anotherPassRequested = true;
      return this.#inFlight;
    }
    this.#inFlight = this.#drain().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  subscribeDurablePage(
    listener: (state: PageOperationStateRecord) => void | Promise<void>,
  ): () => void {
    this.#durablePageListeners.add(listener);
    // A surface can subscribe while an exchange is committing or just after
    // it completed. Replaying the current durable state closes that window:
    // subscriptions behave like state observation, not edge-only events, so a
    // freshly mounted session cannot keep an obsolete `sending` snapshot
    // forever merely because it missed one notification.
    void this.#log
      .getState(this.#pageId)
      .then(async (state) => {
        if (state === null || !this.#durablePageListeners.has(listener)) return;
        try {
          await listener(state);
        } catch (error) {
          this.#onBackgroundError?.(error);
        }
      })
      .catch((error: unknown) => this.#onBackgroundError?.(error));
    return () => this.#durablePageListeners.delete(listener);
  }

  async #drain(): Promise<PageReconcileOutcome> {
    let outcome: PageReconcileOutcome;
    do {
      this.#anotherPassRequested = false;
      const convertLegacyBranch = this.#legacyBranchConversionRequested;
      this.#legacyBranchConversionRequested = false;
      outcome = await this.#run(convertLegacyBranch);
    } while (
      (this.#anotherPassRequested || this.#legacyBranchConversionRequested) &&
      outcome.kind !== "offline" &&
      outcome.kind !== "blocked"
    );
    return outcome;
  }

  /**
   * Converts one offline semantic branch, idempotently.
   *
   * The server locks on the branch id and replays at most once; a repeated
   * request with the same content returns the same checkpoint. Only after the
   * converted checkpoint is committed locally does the branch record flip to
   * `converted` — a crash between the two replays the request harmlessly.
   */
  async #convertBranch(branch: LegacyOfflineBranchRecord): Promise<PageReconcileOutcome> {
    // A branch can be opened from an optimistic item revision while the item
    // creation is still travelling through the workspace outbox. Once that
    // mutation is accepted, the revision header deliberately retains the
    // local -> canonical alias for stale in-memory callers. Resolve the alias
    // at transport time: the immutable branch journal still describes the
    // exact same base document, while the server receives the revision
    // identity it actually issued and can validate its lineage.
    const baseRevisionHeader = await this.#log.db.revisionHeaders.get(branch.branch.baseRevisionId);
    const baseRevisionId = baseRevisionHeader?.canonicalRevisionId ?? branch.branch.baseRevisionId;
    const request: LegacyOfflineBranchSyncRequestDto = {
      mode: "legacy-branch",
      requestId: this.#createRequestId(),
      branchId: branch.branchId,
      baseRevisionId,
      baseCanonicalDigest: branch.branch.baseCanonicalDigest,
      baseDocument: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: { blocks: structuredClone(branch.branch.baseDocumentV2.blocks) },
      },
      localDocument: {
        format: "myownnotion.document+json",
        formatVersion: 3,
        body: { blocks: structuredClone(branch.branch.localDocument.blocks) },
      },
      localDocumentDigest: branch.branch.localDocumentDigest,
      semanticTransactions: branch.branch.semanticTransactions.map((transaction) => ({
        transactionId: transaction.transactionId,
        sequence: transaction.sequence,
        commands: transaction.commands.map(
          (command) => structuredClone(command) as LegacySemanticCommandDto,
        ),
      })),
      createdAt: branch.createdAt,
    };
    const result = await this.#transport.convertLegacyBranch(this.#pageId, request);
    if (!result.ok) {
      return {
        kind: result.offline ? "offline" : "pending",
        exchanges: 0,
        latestPageSequence: 0,
        fileRequirements: [],
        problemCode: result.problem.code,
      };
    }
    if (result.value.mode !== "checkpoint") {
      throw new TypeError("legacy branch conversion returned an unexpected response mode");
    }
    await installPageCheckpoint(this.#log, result.value);
    await this.#log.putLegacyBranch({
      ...branch,
      status: "converted",
      recordVersion: branch.recordVersion + 1,
      branch: { ...branch.branch, status: "converted" },
    });
    const durableState = await this.#log.getState(this.#pageId);
    if (durableState !== null) {
      const listeners = [
        ...(this.#onDurablePage === undefined ? [] : [this.#onDurablePage]),
        ...this.#durablePageListeners,
      ];
      await Promise.all(
        listeners.map(async (listener) => {
          try {
            await listener(durableState);
          } catch (error) {
            this.#onBackgroundError?.(error);
          }
        }),
      );
    }
    return {
      kind: "synced",
      exchanges: 1,
      latestPageSequence: result.value.latestPageSequence,
      fileRequirements: [],
    };
  }

  async #run(convertLegacyBranch: boolean): Promise<PageReconcileOutcome> {
    let exchanges = 0;
    let latestRequirements: readonly PageFileRequirement[] = [];

    // A page first edited offline has no shared state yet — only a semantic
    // branch. Converting it is the page's first synchronization: the server
    // replays the transactions onto the current head and answers with the
    // active checkpoint, which installs exactly like any other.
    const branch = await this.#log.getLegacyBranch(this.#pageId);
    if (branch !== null && branch.status !== "converted") {
      const bootstrapOnly =
        branch.branch.bootstrapTransactionId !== undefined
          ? branch.branch.semanticTransactions.length === 1 &&
            branch.branch.semanticTransactions[0]?.transactionId ===
              branch.branch.bootstrapTransactionId
          : branch.branch.semanticTransactions.length === 0;
      if (!bootstrapOnly) {
        if (convertLegacyBranch) {
          const outcome = await this.#convertBranch(branch);
          if (outcome.kind === "synced") {
            // A device may already have installed an active checkpoint from
            // another replica before opening its retained offline branch. In
            // that case conversion commits on the server, but the existing
            // local checkpoint is intentionally not replaced. One active pass
            // must therefore pull the conversion update before this shared
            // promise can claim that the device itself has converged.
            this.#anotherPassRequested = true;
          }
          return outcome;
        }
        // Ordinary workspace reconciliation is allowed to pull active pages,
        // but only the legacy editing session owns this one-time handover.
        // Returning pending keeps the durable journal visible without racing
        // the editor queue or silently replacing it with an older checkpoint.
        return {
          kind: "pending",
          exchanges: 0,
          latestPageSequence: 0,
          fileRequirements: [],
          problemCode: "page-operations.legacy-conversion-deferred",
        };
      }
      const state = await this.#log.getState(this.#pageId);
      if (state === null || state.status !== "active") {
        // Opening a page migrates nothing (plan §6): a branch holding only the
        // empty-document bootstrap is a read, not a write, so there is nothing
        // to convert and nothing to push.
        return {
          kind: "synced",
          exchanges: 0,
          latestPageSequence: 0,
          fileRequirements: [],
        };
      }
      // Another device activated this page; fall through and pull normally.
    }

    while (exchanges < this.#maxExchanges) {
      const state = await this.#log.getState(this.#pageId);
      if (state === null || state.status !== "active" || state.checkpoint === null) {
        return {
          kind: "blocked",
          exchanges,
          latestPageSequence: state?.latestServerPageSequence ?? 0,
          fileRequirements: latestRequirements,
          problemCode: "page-operations.local-state-missing",
        };
      }
      const pending = await this.#log.listUpdates(this.#pageId, ["pending"]);
      let batch: PageOperationUpdateRecord[];
      try {
        batch = selectPageUpdateBatch(pending);
      } catch (error) {
        if (error instanceof OversizedPageUpdateError && pending[0] !== undefined) {
          await this.#log.transitionUpdate(pending[0].updateId, "blocked");
          return {
            kind: "blocked",
            exchanges,
            latestPageSequence: state.latestServerPageSequence,
            fileRequirements: latestRequirements,
            problemCode: "page-operations.quota",
          };
        }
        throw error;
      }

      for (const update of batch) await this.#log.transitionUpdate(update.updateId, "sending");
      const persistedVersionVector = batch.at(-1)?.resultVersionVector ?? state.versionVector;
      const request: ActivePageSyncRequestDto = {
        mode: "active",
        requestId: this.#createRequestId(),
        operationalVersion: 1,
        persistedVersionVector: encodePageOperationBytes(persistedVersionVector),
        knownServerPageSequence: state.latestServerPageSequence,
        updates: batch.map(pageUpdateRequest),
        maxRemoteBytes: this.#maxRemoteBytes,
      };
      const result = await this.#transport.sync(this.#pageId, request);
      exchanges += 1;
      if (!result.ok) {
        const blocking = !result.offline && BLOCKING_PROBLEMS.has(result.problem.code);
        for (const update of batch) {
          const current = await this.#log.getUpdate(update.updateId);
          if (current?.status === "sending") {
            await this.#log.transitionUpdate(update.updateId, blocking ? "blocked" : "pending");
          }
        }
        return {
          kind: result.offline ? "offline" : blocking ? "blocked" : "pending",
          exchanges,
          latestPageSequence: state.latestServerPageSequence,
          fileRequirements: latestRequirements,
          problemCode: result.problem.code,
        };
      }
      if (result.value.mode !== "active") {
        throw new InvalidPageSyncResponseError("an active page received a checkpoint response");
      }
      const response = result.value;
      if (response.requestId !== request.requestId || response.pageId !== this.#pageId) {
        throw new InvalidPageSyncResponseError(
          "the page synchronization response identity changed",
        );
      }
      let durableState: PageOperationStateRecord;
      try {
        durableState = await this.#commitResponse(
          response,
          batch.map(({ updateId }) => updateId),
        );
      } catch (error) {
        if (
          error instanceof InvalidPageSyncResponseError ||
          error instanceof ConcurrentPageReconciliationError
        ) {
          const blocked = error instanceof InvalidPageSyncResponseError;
          for (const update of batch) {
            const current = await this.#log.getUpdate(update.updateId);
            if (current?.status === "sending") {
              await this.#log.transitionUpdate(update.updateId, blocked ? "blocked" : "pending");
            }
          }
          return {
            kind: blocked ? "blocked" : "pending",
            exchanges,
            latestPageSequence: state.latestServerPageSequence,
            fileRequirements: latestRequirements,
            problemCode: blocked
              ? "page-operations.projection-invalid"
              : "page-operations.local-state-advanced",
          };
        }
        throw error;
      }
      latestRequirements = response.fileRequirements;
      try {
        this.#onFileRequirements?.(latestRequirements);
      } catch (error) {
        this.#onBackgroundError?.(error);
      }
      const listeners = [
        ...(this.#onDurablePage === undefined ? [] : [this.#onDurablePage]),
        ...this.#durablePageListeners,
      ];
      await Promise.all(
        listeners.map(async (listener) => {
          try {
            await listener(durableState);
          } catch (error) {
            this.#onBackgroundError?.(error);
          }
        }),
      );

      const remaining = await this.#log.listUpdates(this.#pageId, ["pending", "sending"]);
      const serverIncludesLocal =
        durableState.serverVersionVector !== null &&
        versionVectorDominates(durableState.serverVersionVector, durableState.versionVector);
      if (remaining.length === 0 && !response.hasMore && serverIncludesLocal) {
        return {
          kind: "synced",
          exchanges,
          latestPageSequence: durableState.latestServerPageSequence,
          fileRequirements: latestRequirements,
        };
      }
    }

    const state = await this.#log.getState(this.#pageId);
    return {
      kind: "pending",
      exchanges,
      latestPageSequence: state?.latestServerPageSequence ?? 0,
      fileRequirements: latestRequirements,
      problemCode: "page-operations.exchange-limit",
    };
  }

  async #commitResponse(
    response: ActivePageSyncResponseDto,
    sentUpdateIds: readonly Uuid[],
  ): Promise<PageOperationStateRecord> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await withPageStateWrite(
          this.#log.db,
          this.#pageId,
          async () => await this.#commitResponseOnce(response, sentUpdateIds),
        );
      } catch (error) {
        if (!(error instanceof ConcurrentPageReconciliationError)) throw error;
      }
    }
    throw new ConcurrentPageReconciliationError();
  }

  async #commitResponseOnce(
    response: ActivePageSyncResponseDto,
    sentUpdateIds: readonly Uuid[],
  ): Promise<PageOperationStateRecord> {
    const state = await this.#log.getState(this.#pageId);
    if (state === null) throw new ConcurrentPageReconciliationError();
    if (
      response.throughPageSequence < state.latestServerPageSequence ||
      response.throughPageSequence > response.latestPageSequence
    ) {
      throw new InvalidPageSyncResponseError("the server page cursor is not monotonic");
    }
    const updates = await this.#log.listUpdates(this.#pageId);
    const updateById = new Map(updates.map((update) => [update.updateId, update]));
    const acknowledged = [...response.accepted, ...response.repeated];
    const acknowledgedIds = new Set(acknowledged.map(({ updateId }) => updateId));
    if (
      acknowledgedIds.size !== sentUpdateIds.length ||
      sentUpdateIds.some((updateId) => !acknowledgedIds.has(updateId))
    ) {
      throw new InvalidPageSyncResponseError("the server did not acknowledge the submitted batch");
    }

    const serverVersionVector = decodePageOperationBytes(response.serverVersionVector);
    for (const result of acknowledged) {
      const update = updateById.get(result.updateId as Uuid);
      if (update === undefined || update.status !== "sending") {
        throw new ConcurrentPageReconciliationError();
      }
      const resultVersionVector = decodePageOperationBytes(result.resultVersionVector);
      if (
        !versionVectorDominates(resultVersionVector, update.resultVersionVector) ||
        !versionVectorDominates(serverVersionVector, resultVersionVector)
      ) {
        throw new InvalidPageSyncResponseError("an acknowledged update has an invalid frontier");
      }
    }

    const page = await reconstructPage(this.#pageId, state, updates);
    for (const remote of response.remoteUpdates) {
      const bytes = decodePageOperationBytes(remote.updateBytes);
      if ((await sha256Hex(bytes)) !== remote.updateDigest) {
        throw new InvalidPageSyncResponseError("a remote page update failed its digest check");
      }
      const local = updateById.get(remote.updateId as Uuid);
      if (local !== undefined && local.updateDigest !== remote.updateDigest) {
        throw new InvalidPageSyncResponseError("a remote page update reused a local identity");
      }
      const imported = page.importUpdate(bytes);
      if (imported.pending) {
        throw new InvalidPageSyncResponseError("a remote page update has missing dependencies");
      }
    }
    if (!versionVectorDominates(page.versionVectorBytes(), serverVersionVector)) {
      throw new InvalidPageSyncResponseError("the response omitted part of its announced frontier");
    }

    const [checkpoint, projection] = await Promise.all([page.checkpoint(), page.project()]);
    if (
      versionVectorDominates(serverVersionVector, page.versionVectorBytes()) &&
      projection.canonicalDigest !== response.canonical.digest
    ) {
      throw new InvalidPageSyncResponseError("the server and client canonical projections differ");
    }
    const nextState: PageOperationStateRecord = {
      ...state,
      latestServerPageSequence: response.throughPageSequence,
      lastAccessedAt: this.#now().toISOString(),
      recordVersion: state.recordVersion + 1,
      checkpoint,
      projection,
      versionVector: checkpoint.versionVector,
      frontiers: checkpoint.frontiers,
      serverVersionVector,
    };
    const sealedState = await this.#log.codec.sealState(nextState);

    await this.#log.db.transaction(
      "rw",
      [this.#log.db.pageOperationStates, this.#log.db.pageOperationUpdates],
      async () => {
        const currentState = await this.#log.db.pageOperationStates.get(this.#pageId);
        if (currentState?.recordVersion !== state.recordVersion) {
          throw new ConcurrentPageReconciliationError();
        }
        for (const updateId of sentUpdateIds) {
          const expected = updateById.get(updateId);
          const current = await this.#log.db.pageOperationUpdates.get(updateId);
          if (
            expected === undefined ||
            current?.recordVersion !== expected.recordVersion ||
            current.status !== "sending"
          ) {
            throw new ConcurrentPageReconciliationError();
          }
        }
        await this.#log.db.pageOperationStates.put(sealedState);
        await this.#log.db.pageOperationUpdates.bulkDelete([...sentUpdateIds]);
      },
    );
    return nextState;
  }
}
