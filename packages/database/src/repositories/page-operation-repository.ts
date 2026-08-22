/**
 * Transactional routing repository for convergent page operations.
 *
 * The repository owns row locks, monotonic page sequences and immutable update
 * identities. It deliberately does not open CRDT bytes or materialize a page;
 * those payload-bearing decisions stay in the API service while every row it
 * writes remains in the caller's PostgreSQL transaction.
 */

import type { Uuid } from "@myownnotion/domain";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Database, Transaction } from "../client.ts";
import {
  pageAmbiguities,
  pageDeviceFrontiers,
  pageLegacyBranchConversions,
  pageOperationCheckpoints,
  pageOperationStates,
  pageOperationUpdates,
  protectedEnvelopes,
} from "../schema/index.ts";

type Executor = Database | Transaction;

export type PageOperationStateRow = typeof pageOperationStates.$inferSelect;
export type PageOperationUpdateRow = typeof pageOperationUpdates.$inferSelect;
export type PageOperationCheckpointRow = typeof pageOperationCheckpoints.$inferSelect;
export type PageDeviceFrontierRow = typeof pageDeviceFrontiers.$inferSelect;
export type PageAmbiguityRow = typeof pageAmbiguities.$inferSelect;
export type PageLegacyBranchConversionRow = typeof pageLegacyBranchConversions.$inferSelect;

export type PageOperationRepositoryErrorCode =
  | "state-not-found"
  | "state-not-active"
  | "state-transition-refused"
  | "update-id-reused"
  | "state-advanced-concurrently";

export class PageOperationRepositoryError extends Error {
  readonly code: PageOperationRepositoryErrorCode;

  constructor(code: PageOperationRepositoryErrorCode, message: string) {
    super(message);
    this.name = "PageOperationRepositoryError";
    this.code = code;
  }
}

export async function readPageOperationState(
  executor: Executor,
  workspaceId: Uuid,
  pageId: Uuid,
): Promise<PageOperationStateRow | null> {
  const rows = await executor
    .select()
    .from(pageOperationStates)
    .where(
      and(eq(pageOperationStates.workspaceId, workspaceId), eq(pageOperationStates.pageId, pageId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Acquires the page's serialization lock for the remainder of `tx`. */
export async function lockPageOperationState(
  tx: Transaction,
  workspaceId: Uuid,
  pageId: Uuid,
): Promise<PageOperationStateRow> {
  const rows = await tx
    .select()
    .from(pageOperationStates)
    .where(
      and(eq(pageOperationStates.workspaceId, workspaceId), eq(pageOperationStates.pageId, pageId)),
    )
    .for("update")
    .limit(1);
  const state = rows[0];
  if (state === undefined) {
    throw new PageOperationRepositoryError(
      "state-not-found",
      "operational page state does not exist",
    );
  }
  return state;
}

/**
 * Removes the complete operational authority before a page stops being a
 * page. The row lock serializes this destructive transition with active sync;
 * a client that was already waiting will subsequently observe no state and be
 * blocked explicitly instead of reviving the destroyed content.
 */
export async function retirePageOperationState(
  tx: Transaction,
  workspaceId: Uuid,
  pageId: Uuid,
): Promise<void> {
  const states = await tx
    .select()
    .from(pageOperationStates)
    .where(
      and(eq(pageOperationStates.workspaceId, workspaceId), eq(pageOperationStates.pageId, pageId)),
    )
    .for("update")
    .limit(1);
  const state = states[0];
  if (state === undefined) return;

  // One PostgreSQL transaction owns one client. Keep its reads sequential;
  // cross-check concurrency belongs between transactions, not inside one.
  const updates = await tx
    .select({
      base: pageOperationUpdates.baseFrontierEnvelopeId,
      result: pageOperationUpdates.resultFrontierEnvelopeId,
      update: pageOperationUpdates.updateEnvelopeId,
    })
    .from(pageOperationUpdates)
    .where(eq(pageOperationUpdates.pageId, pageId));
  const checkpoints = await tx
    .select({
      frontier: pageOperationCheckpoints.frontierEnvelopeId,
      snapshot: pageOperationCheckpoints.snapshotEnvelopeId,
    })
    .from(pageOperationCheckpoints)
    .where(eq(pageOperationCheckpoints.pageId, pageId));
  const frontiers = await tx
    .select({ frontier: pageDeviceFrontiers.frontierEnvelopeId })
    .from(pageDeviceFrontiers)
    .where(eq(pageDeviceFrontiers.pageId, pageId));
  const ambiguities = await tx
    .select({ details: pageAmbiguities.detailsEnvelopeId })
    .from(pageAmbiguities)
    .where(eq(pageAmbiguities.pageId, pageId));
  const conversions = await tx
    .select({ response: pageLegacyBranchConversions.responseEnvelopeId })
    .from(pageLegacyBranchConversions)
    .where(eq(pageLegacyBranchConversions.pageId, pageId));
  const envelopeIds = new Set<Uuid>();
  const remember = (value: string | null): void => {
    if (value !== null) envelopeIds.add(value as Uuid);
  };
  remember(state.currentFrontierEnvelopeId);
  remember(state.revisionWindowFrontierEnvelopeId);
  for (const row of updates) {
    remember(row.base);
    remember(row.result);
    remember(row.update);
  }
  for (const row of checkpoints) {
    remember(row.frontier);
    remember(row.snapshot);
  }
  for (const row of frontiers) remember(row.frontier);
  for (const row of ambiguities) remember(row.details);
  for (const row of conversions) remember(row.response);

  // Clear the deferred checkpoint reference and active-state completeness
  // fields before deleting dependent rows in foreign-key order.
  await tx
    .update(pageOperationStates)
    .set({
      status: "initializing",
      currentCheckpointId: null,
      currentFrontierEnvelopeId: null,
      operationalDigest: null,
      revisionWindowStartedAt: null,
      revisionWindowLastUpdateAt: null,
      revisionWindowFrontierEnvelopeId: null,
      bootstrappedAt: null,
    })
    .where(
      and(eq(pageOperationStates.workspaceId, workspaceId), eq(pageOperationStates.pageId, pageId)),
    );
  await tx
    .delete(pageLegacyBranchConversions)
    .where(eq(pageLegacyBranchConversions.pageId, pageId));
  await tx.delete(pageAmbiguities).where(eq(pageAmbiguities.pageId, pageId));
  await tx.delete(pageDeviceFrontiers).where(eq(pageDeviceFrontiers.pageId, pageId));
  await tx.delete(pageOperationUpdates).where(eq(pageOperationUpdates.pageId, pageId));
  await tx.delete(pageOperationCheckpoints).where(eq(pageOperationCheckpoints.pageId, pageId));
  await tx
    .delete(pageOperationStates)
    .where(
      and(eq(pageOperationStates.workspaceId, workspaceId), eq(pageOperationStates.pageId, pageId)),
    );
  if (envelopeIds.size > 0) {
    await tx.delete(protectedEnvelopes).where(inArray(protectedEnvelopes.id, [...envelopeIds]));
  }
}

export interface InsertInitializingPageOperationStateInput {
  readonly pageId: Uuid;
  readonly workspaceId: Uuid;
  readonly canonicalDigest: string;
  readonly lastRevisionId: Uuid | null;
  readonly now: Date;
}

export async function insertInitializingPageOperationState(
  tx: Transaction,
  input: InsertInitializingPageOperationStateInput,
): Promise<PageOperationStateRow> {
  const inserted = await tx
    .insert(pageOperationStates)
    .values({
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      status: "initializing",
      operationalFormat: "myownnotion.page-operations+loro",
      operationalVersion: 1,
      currentCheckpointId: null,
      currentFrontierEnvelopeId: null,
      operationalDigest: null,
      canonicalDigest: input.canonicalDigest,
      canonicalFormatVersion: 3,
      lastUpdateSequence: 0,
      lastRevisionId: input.lastRevisionId,
      revisionWindowStartedAt: null,
      revisionWindowLastUpdateAt: null,
      revisionWindowFrontierEnvelopeId: null,
      bootstrappedAt: null,
      updatedAt: input.now,
    })
    .returning();
  const row = inserted[0];
  if (row === undefined) throw new Error("initializing page state was not inserted");
  return row;
}

export interface InsertPageOperationCheckpointInput {
  readonly checkpointId: Uuid;
  readonly pageId: Uuid;
  readonly workspaceId: Uuid;
  readonly throughPageSequence: number;
  readonly frontierEnvelopeId: Uuid;
  readonly snapshotEnvelopeId: Uuid;
  readonly snapshotDigest: string;
  readonly canonicalDigest: string;
  readonly revisionId: Uuid | null;
  readonly state: "candidate" | "verified" | "superseded" | "retained";
  readonly now: Date;
}

export async function insertPageOperationCheckpoint(
  tx: Transaction,
  input: InsertPageOperationCheckpointInput,
): Promise<PageOperationCheckpointRow> {
  const rows = await tx
    .insert(pageOperationCheckpoints)
    .values({
      id: input.checkpointId,
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      throughPageSequence: input.throughPageSequence,
      frontierEnvelopeId: input.frontierEnvelopeId,
      snapshotEnvelopeId: input.snapshotEnvelopeId,
      snapshotDigest: input.snapshotDigest,
      canonicalDigest: input.canonicalDigest,
      revisionId: input.revisionId,
      state: input.state,
      createdAt: input.now,
      verifiedAt: input.state === "candidate" ? null : input.now,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("page checkpoint was not inserted");
  return row;
}

export interface ActivatePageOperationStateInput {
  readonly pageId: Uuid;
  readonly workspaceId: Uuid;
  readonly checkpointId: Uuid;
  readonly frontierEnvelopeId: Uuid;
  readonly operationalDigest: string;
  readonly canonicalDigest: string;
  readonly lastRevisionId: Uuid | null;
  readonly now: Date;
}

export async function activatePageOperationState(
  tx: Transaction,
  input: ActivatePageOperationStateInput,
): Promise<PageOperationStateRow> {
  const rows = await tx
    .update(pageOperationStates)
    .set({
      status: "active",
      currentCheckpointId: input.checkpointId,
      currentFrontierEnvelopeId: input.frontierEnvelopeId,
      operationalDigest: input.operationalDigest,
      canonicalDigest: input.canonicalDigest,
      canonicalFormatVersion: 3,
      lastRevisionId: input.lastRevisionId,
      bootstrappedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(pageOperationStates.pageId, input.pageId),
        eq(pageOperationStates.workspaceId, input.workspaceId),
        eq(pageOperationStates.status, "initializing"),
      ),
    )
    .returning();
  const activated = rows[0];
  if (activated !== undefined) return activated;

  const existing = await lockPageOperationState(tx, input.workspaceId, input.pageId);
  if (
    existing.status === "active" &&
    existing.currentCheckpointId === input.checkpointId &&
    existing.currentFrontierEnvelopeId === input.frontierEnvelopeId &&
    existing.operationalDigest === input.operationalDigest &&
    existing.canonicalDigest === input.canonicalDigest
  ) {
    return existing;
  }
  throw new PageOperationRepositoryError(
    "state-transition-refused",
    "page operation state could not be promoted from initializing",
  );
}

export async function readPageOperationUpdate(
  executor: Executor,
  updateId: Uuid,
): Promise<PageOperationUpdateRow | null> {
  const rows = await executor
    .select()
    .from(pageOperationUpdates)
    .where(eq(pageOperationUpdates.id, updateId))
    .limit(1);
  return rows[0] ?? null;
}

export async function readPageOperationUpdates(
  executor: Executor,
  updateIds: readonly Uuid[],
): Promise<ReadonlyMap<Uuid, PageOperationUpdateRow>> {
  if (updateIds.length === 0) return new Map();
  const rows = await executor
    .select()
    .from(pageOperationUpdates)
    .where(inArray(pageOperationUpdates.id, [...updateIds]));
  return new Map(rows.map((row) => [row.id as Uuid, row]));
}

export async function readPageOperationCheckpoint(
  executor: Executor,
  input: { readonly workspaceId: Uuid; readonly pageId: Uuid; readonly checkpointId: Uuid },
): Promise<PageOperationCheckpointRow | null> {
  const rows = await executor
    .select()
    .from(pageOperationCheckpoints)
    .where(
      and(
        eq(pageOperationCheckpoints.workspaceId, input.workspaceId),
        eq(pageOperationCheckpoints.pageId, input.pageId),
        eq(pageOperationCheckpoints.id, input.checkpointId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface AppendAcceptedPageOperationUpdateInput {
  readonly updateId: Uuid;
  readonly pageId: Uuid;
  readonly workspaceId: Uuid;
  readonly authoredByDeviceId: Uuid;
  readonly baseFrontierEnvelopeId: Uuid;
  readonly resultFrontierEnvelopeId: Uuid;
  readonly updateEnvelopeId: Uuid;
  readonly updateDigest: string;
  readonly operationalDigest: string;
  readonly canonicalDigest: string;
  readonly acceptedAt: Date;
}

export type AppendPageOperationUpdateResult = {
  readonly kind: "accepted" | "repeated";
  readonly pageSequence: number;
  readonly update: PageOperationUpdateRow;
  readonly state: PageOperationStateRow;
};

function assertImmutableReplay(
  stored: PageOperationUpdateRow,
  input: AppendAcceptedPageOperationUpdateInput,
): void {
  if (
    stored.pageId !== input.pageId ||
    stored.workspaceId !== input.workspaceId ||
    stored.authoredByDeviceId !== input.authoredByDeviceId ||
    stored.updateDigest !== input.updateDigest
  ) {
    throw new PageOperationRepositoryError(
      "update-id-reused",
      "page operation update id was reused with different immutable metadata",
    );
  }
}

export async function appendAcceptedPageOperationUpdate(
  tx: Transaction,
  input: AppendAcceptedPageOperationUpdateInput,
): Promise<AppendPageOperationUpdateResult> {
  const locked = await lockPageOperationState(tx, input.workspaceId, input.pageId);
  if (locked.status !== "active") {
    throw new PageOperationRepositoryError(
      "state-not-active",
      "page operation update requires an active page state",
    );
  }

  const repeated = await readPageOperationUpdate(tx, input.updateId);
  if (repeated !== null) {
    assertImmutableReplay(repeated, input);
    return {
      kind: "repeated",
      pageSequence: repeated.pageSequence,
      update: repeated,
      state: locked,
    };
  }

  const pageSequence = locked.lastUpdateSequence + 1;
  const insertedRows = await tx
    .insert(pageOperationUpdates)
    .values({
      id: input.updateId,
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      pageSequence,
      authoredByDeviceId: input.authoredByDeviceId,
      baseFrontierEnvelopeId: input.baseFrontierEnvelopeId,
      resultFrontierEnvelopeId: input.resultFrontierEnvelopeId,
      updateEnvelopeId: input.updateEnvelopeId,
      updateDigest: input.updateDigest,
      status: "accepted",
      failureCode: null,
      acceptedAt: input.acceptedAt,
    })
    .returning();
  const update = insertedRows[0];
  if (update === undefined) throw new Error("page operation update was not inserted");

  const stateRows = await tx
    .update(pageOperationStates)
    .set({
      currentFrontierEnvelopeId: input.resultFrontierEnvelopeId,
      operationalDigest: input.operationalDigest,
      canonicalDigest: input.canonicalDigest,
      lastUpdateSequence: pageSequence,
      revisionWindowStartedAt: locked.revisionWindowStartedAt ?? input.acceptedAt,
      revisionWindowLastUpdateAt: input.acceptedAt,
      revisionWindowFrontierEnvelopeId: input.resultFrontierEnvelopeId,
      updatedAt: input.acceptedAt,
    })
    .where(
      and(
        eq(pageOperationStates.pageId, input.pageId),
        eq(pageOperationStates.workspaceId, input.workspaceId),
        eq(pageOperationStates.lastUpdateSequence, locked.lastUpdateSequence),
      ),
    )
    .returning();
  const state = stateRows[0];
  if (state === undefined) {
    throw new PageOperationRepositoryError(
      "state-advanced-concurrently",
      "page operation state advanced while its locked update was appended",
    );
  }
  return { kind: "accepted", pageSequence, update, state };
}

export interface AppendAcceptedPageOperationBatchInput {
  readonly pageId: Uuid;
  readonly workspaceId: Uuid;
  readonly updates: readonly Omit<
    AppendAcceptedPageOperationUpdateInput,
    "pageId" | "workspaceId" | "operationalDigest" | "canonicalDigest" | "acceptedAt"
  >[];
  readonly operationalDigest: string;
  readonly canonicalDigest: string;
  readonly acceptedAt: Date;
}

export interface AppendAcceptedPageOperationBatchResult {
  readonly updates: readonly PageOperationUpdateRow[];
  readonly state: PageOperationStateRow;
}

/**
 * Appends a causally verified request batch behind one page lock.
 *
 * The service has already rejected repeats and imported every update before it
 * reaches this boundary. PostgreSQL therefore only needs one immutable insert
 * and one final-state update; the transaction remains all-or-nothing and every
 * update keeps its own monotonic page sequence and encrypted frontier.
 */
export async function appendAcceptedPageOperationUpdates(
  tx: Transaction,
  input: AppendAcceptedPageOperationBatchInput,
): Promise<AppendAcceptedPageOperationBatchResult> {
  const locked = await lockPageOperationState(tx, input.workspaceId, input.pageId);
  if (locked.status !== "active") {
    throw new PageOperationRepositoryError(
      "state-not-active",
      "page operation update requires an active page state",
    );
  }
  if (input.updates.length === 0) return { updates: [], state: locked };

  const values = input.updates.map((update, index) => ({
    id: update.updateId,
    pageId: input.pageId,
    workspaceId: input.workspaceId,
    pageSequence: locked.lastUpdateSequence + index + 1,
    authoredByDeviceId: update.authoredByDeviceId,
    baseFrontierEnvelopeId: update.baseFrontierEnvelopeId,
    resultFrontierEnvelopeId: update.resultFrontierEnvelopeId,
    updateEnvelopeId: update.updateEnvelopeId,
    updateDigest: update.updateDigest,
    status: "accepted" as const,
    failureCode: null,
    acceptedAt: input.acceptedAt,
  }));
  const inserted = await tx.insert(pageOperationUpdates).values(values).returning();
  if (inserted.length !== values.length) {
    throw new Error("not every page operation update was inserted");
  }
  const byId = new Map(inserted.map((row) => [row.id, row]));
  const updates = values.map(({ id }) => {
    const row = byId.get(id);
    if (row === undefined) throw new Error("an inserted page operation update is missing");
    return row;
  });
  const last = input.updates.at(-1);
  if (last === undefined) throw new Error("the accepted page operation batch is empty");
  const lastUpdateSequence = locked.lastUpdateSequence + input.updates.length;
  const stateRows = await tx
    .update(pageOperationStates)
    .set({
      currentFrontierEnvelopeId: last.resultFrontierEnvelopeId,
      operationalDigest: input.operationalDigest,
      canonicalDigest: input.canonicalDigest,
      lastUpdateSequence,
      revisionWindowStartedAt: locked.revisionWindowStartedAt ?? input.acceptedAt,
      revisionWindowLastUpdateAt: input.acceptedAt,
      revisionWindowFrontierEnvelopeId: last.resultFrontierEnvelopeId,
      updatedAt: input.acceptedAt,
    })
    .where(
      and(
        eq(pageOperationStates.pageId, input.pageId),
        eq(pageOperationStates.workspaceId, input.workspaceId),
        eq(pageOperationStates.lastUpdateSequence, locked.lastUpdateSequence),
      ),
    )
    .returning();
  const state = stateRows[0];
  if (state === undefined) {
    throw new PageOperationRepositoryError(
      "state-advanced-concurrently",
      "page operation state advanced while its locked update batch was appended",
    );
  }
  return { updates, state };
}

export async function listPageOperationUpdatesAfter(
  executor: Executor,
  input: {
    readonly workspaceId: Uuid;
    readonly pageId: Uuid;
    readonly after: number;
    readonly limit: number;
  },
): Promise<PageOperationUpdateRow[]> {
  return await executor
    .select()
    .from(pageOperationUpdates)
    .where(
      and(
        eq(pageOperationUpdates.workspaceId, input.workspaceId),
        eq(pageOperationUpdates.pageId, input.pageId),
        gt(pageOperationUpdates.pageSequence, input.after),
      ),
    )
    .orderBy(asc(pageOperationUpdates.pageSequence))
    .limit(input.limit);
}

export async function readPageDeviceFrontier(
  executor: Executor,
  input: { readonly pageId: Uuid; readonly deviceId: Uuid },
): Promise<PageDeviceFrontierRow | null> {
  const rows = await executor
    .select()
    .from(pageDeviceFrontiers)
    .where(
      and(
        eq(pageDeviceFrontiers.pageId, input.pageId),
        eq(pageDeviceFrontiers.deviceId, input.deviceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function confirmPageDeviceFrontier(
  tx: Transaction,
  input: {
    readonly pageId: Uuid;
    readonly deviceId: Uuid;
    readonly workspaceId: Uuid;
    readonly frontierEnvelopeId: Uuid;
    readonly frontierDigest: string;
    readonly confirmedPageSequence: number;
    readonly now: Date;
  },
): Promise<PageDeviceFrontierRow> {
  const existingRows = await tx
    .select()
    .from(pageDeviceFrontiers)
    .where(
      and(
        eq(pageDeviceFrontiers.pageId, input.pageId),
        eq(pageDeviceFrontiers.deviceId, input.deviceId),
      ),
    )
    .for("update")
    .limit(1);
  const existing = existingRows[0];
  if (existing === undefined) {
    const rows = await tx
      .insert(pageDeviceFrontiers)
      .values({
        pageId: input.pageId,
        deviceId: input.deviceId,
        workspaceId: input.workspaceId,
        frontierEnvelopeId: input.frontierEnvelopeId,
        frontierDigest: input.frontierDigest,
        confirmedPageSequence: input.confirmedPageSequence,
        recordVersion: 1,
        lastConfirmedAt: input.now,
        deviceState: "authorized",
      })
      .returning();
    const inserted = rows[0];
    if (inserted === undefined) throw new Error("page device frontier was not inserted");
    return inserted;
  }
  if (input.confirmedPageSequence < existing.confirmedPageSequence) {
    throw new PageOperationRepositoryError(
      "state-advanced-concurrently",
      "page device frontier cannot retreat",
    );
  }
  if (
    input.confirmedPageSequence === existing.confirmedPageSequence &&
    input.frontierDigest === existing.frontierDigest
  ) {
    return existing;
  }
  const rows = await tx
    .update(pageDeviceFrontiers)
    .set({
      frontierEnvelopeId: input.frontierEnvelopeId,
      frontierDigest: input.frontierDigest,
      confirmedPageSequence: input.confirmedPageSequence,
      recordVersion: existing.recordVersion + 1,
      lastConfirmedAt: input.now,
      deviceState: "authorized",
    })
    .where(
      and(
        eq(pageDeviceFrontiers.pageId, input.pageId),
        eq(pageDeviceFrontiers.deviceId, input.deviceId),
        eq(pageDeviceFrontiers.recordVersion, existing.recordVersion),
      ),
    )
    .returning();
  const updated = rows[0];
  if (updated === undefined) {
    throw new PageOperationRepositoryError(
      "state-advanced-concurrently",
      "page device frontier advanced concurrently",
    );
  }
  return updated;
}

export async function lockLegacyBranchConversion(
  tx: Transaction,
  branchId: Uuid,
): Promise<PageLegacyBranchConversionRow | null> {
  const rows = await tx
    .select()
    .from(pageLegacyBranchConversions)
    .where(eq(pageLegacyBranchConversions.branchId, branchId))
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

export async function insertLegacyBranchConversion(
  tx: Transaction,
  input: {
    readonly branchId: Uuid;
    readonly pageId: Uuid;
    readonly workspaceId: Uuid;
    readonly requestDigest: string;
    readonly localDocumentDigest: string;
    readonly createdAt: Date;
  },
): Promise<PageLegacyBranchConversionRow> {
  const rows = await tx
    .insert(pageLegacyBranchConversions)
    .values({
      branchId: input.branchId,
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      requestDigest: input.requestDigest,
      status: "sending",
      responseEnvelopeId: null,
      checkpointId: null,
      conversionUpdateIds: [],
      localDocumentDigest: input.localDocumentDigest,
      createdAt: input.createdAt,
      convertedAt: null,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("legacy branch conversion was not inserted");
  return row;
}

export async function completeLegacyBranchConversion(
  tx: Transaction,
  input: {
    readonly branchId: Uuid;
    readonly requestDigest: string;
    readonly responseEnvelopeId: Uuid;
    readonly checkpointId: Uuid;
    readonly conversionUpdateIds: readonly Uuid[];
    readonly convertedAt: Date;
  },
): Promise<PageLegacyBranchConversionRow> {
  const rows = await tx
    .update(pageLegacyBranchConversions)
    .set({
      status: "converted",
      responseEnvelopeId: input.responseEnvelopeId,
      checkpointId: input.checkpointId,
      conversionUpdateIds: [...input.conversionUpdateIds],
      convertedAt: input.convertedAt,
    })
    .where(
      and(
        eq(pageLegacyBranchConversions.branchId, input.branchId),
        eq(pageLegacyBranchConversions.requestDigest, input.requestDigest),
        eq(pageLegacyBranchConversions.status, "sending"),
      ),
    )
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new PageOperationRepositoryError(
      "state-advanced-concurrently",
      "legacy branch conversion changed before completion",
    );
  }
  return row;
}

export async function insertPageAmbiguity(
  tx: Transaction,
  input: {
    readonly ambiguityId: Uuid;
    readonly pageId: Uuid;
    readonly workspaceId: Uuid;
    readonly logicalKey: string;
    readonly kind: PageAmbiguityRow["kind"];
    readonly detailsEnvelopeId: Uuid;
    readonly sourceUpdateIds: readonly Uuid[];
    readonly openedAt: Date;
  },
): Promise<PageAmbiguityRow> {
  const inserted = await tx
    .insert(pageAmbiguities)
    .values({
      id: input.ambiguityId,
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      logicalKey: input.logicalKey,
      kind: input.kind,
      status: "open",
      detailsEnvelopeId: input.detailsEnvelopeId,
      sourceUpdateIds: [...input.sourceUpdateIds],
      openedAt: input.openedAt,
      resolvedAt: null,
      resolutionRevisionId: null,
    })
    .onConflictDoNothing({ target: [pageAmbiguities.pageId, pageAmbiguities.logicalKey] })
    .returning();
  const created = inserted[0];
  if (created !== undefined) return created;
  const rows = await tx
    .select()
    .from(pageAmbiguities)
    .where(
      and(
        eq(pageAmbiguities.pageId, input.pageId),
        eq(pageAmbiguities.logicalKey, input.logicalKey),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (existing === undefined) throw new Error("page ambiguity disappeared after insertion");
  return existing;
}

export async function readPageAmbiguityByLogicalKey(
  executor: Executor,
  input: { readonly pageId: Uuid; readonly logicalKey: string },
): Promise<PageAmbiguityRow | null> {
  const rows = await executor
    .select()
    .from(pageAmbiguities)
    .where(
      and(
        eq(pageAmbiguities.pageId, input.pageId),
        eq(pageAmbiguities.logicalKey, input.logicalKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listOpenPageAmbiguities(
  executor: Executor,
  input: { readonly workspaceId: Uuid; readonly pageId: Uuid },
): Promise<PageAmbiguityRow[]> {
  return await executor
    .select()
    .from(pageAmbiguities)
    .where(
      and(
        eq(pageAmbiguities.workspaceId, input.workspaceId),
        eq(pageAmbiguities.pageId, input.pageId),
        eq(pageAmbiguities.status, "open"),
      ),
    )
    .orderBy(asc(pageAmbiguities.openedAt), asc(pageAmbiguities.id));
}

export async function readPageAmbiguityById(
  executor: Executor,
  input: { readonly workspaceId: Uuid; readonly ambiguityId: Uuid },
): Promise<PageAmbiguityRow | null> {
  const rows = await executor
    .select()
    .from(pageAmbiguities)
    .where(
      and(
        eq(pageAmbiguities.workspaceId, input.workspaceId),
        eq(pageAmbiguities.id, input.ambiguityId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function resolvePageAmbiguityRow(
  tx: Transaction,
  input: {
    readonly workspaceId: Uuid;
    readonly ambiguityId: Uuid;
    readonly status: "resolved-delete" | "resolved-keep" | "resolved-custom";
    readonly resolutionRevisionId: Uuid;
    readonly resolvedAt: Date;
  },
): Promise<void> {
  await tx
    .update(pageAmbiguities)
    .set({
      status: input.status,
      resolutionRevisionId: input.resolutionRevisionId,
      resolvedAt: input.resolvedAt,
    })
    .where(
      and(
        eq(pageAmbiguities.workspaceId, input.workspaceId),
        eq(pageAmbiguities.id, input.ambiguityId),
        eq(pageAmbiguities.status, "open"),
      ),
    );
}
