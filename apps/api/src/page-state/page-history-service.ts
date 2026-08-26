/**
 * Consolidated visible history for operational pages (T146, US5).
 *
 * The operation log remains the causal authority. Revisions are human-sized
 * checkpoints: idle, maximum-duration and explicit semantic boundaries close
 * one window without replacing the page document.
 */

import {
  buildItemSnapshot,
  type Database,
  getRevision,
  insertRevision,
  lockPageOperationState,
  readPageOperationCheckpoint,
  revisionDescendsFrom,
  runMutation,
  schema,
  supersedeRevision,
  type Transaction,
} from "@myownnotion/database";
import {
  type BlockDocumentV3,
  type CanonicalBlockV3,
  childrenOfV3,
  generateUuidV7,
  type JsonObject,
  type JsonValue,
  type MarkV3,
  migrateStoredPageDocumentToV3,
  normaliseDocumentV3,
  type Uuid,
} from "@myownnotion/domain";
import { isTransformableBlockType, type PageCommand } from "@myownnotion/page-state";
import { and, eq, isNotNull, lte, or } from "drizzle-orm";
import type { SearchService } from "../search/search-service.ts";
import type { ProtectedContent } from "../security/protected-content.ts";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import { announceCommitted } from "../sync/change-notifier.ts";
import type { PageCheckpointRetentionContext } from "./checkpoint-service.ts";
import type { PageOperationService } from "./page-operation-service.ts";

export const PAGE_HISTORY_IDLE_MS = 30_000;
export const PAGE_HISTORY_MAX_WINDOW_MS = 5 * 60_000;

export class PageHistoryServiceError extends Error {
  constructor(
    readonly code: "revision.not-found" | "revision.snapshot-expired" | "revision.stale-base",
    message: string,
    readonly status: 404 | 409 | 410,
    readonly competingRevisionIds: readonly Uuid[] = [],
  ) {
    super(message);
    this.name = "PageHistoryServiceError";
  }
}

export interface PageHistoryConsolidation {
  readonly pageId: Uuid;
  readonly revisionId: Uuid;
}

export type PageHistoryConsolidationFailureCode =
  | "page-history.item-head-missing"
  | "page-history.lineage-diverged";

export class PageHistoryConsolidationError extends Error {
  override readonly name = "PageHistoryConsolidationError";

  constructor(
    readonly code: PageHistoryConsolidationFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PageHistoryConsolidationFailure {
  readonly pageId: Uuid;
  readonly code: PageHistoryConsolidationFailureCode;
  readonly errorName: string;
}

export interface PageHistoryConsolidationRun {
  readonly consolidated: number;
  readonly pageIds: readonly Uuid[];
  readonly failures: readonly PageHistoryConsolidationFailure[];
}

function consolidationFailure(
  pageId: Uuid,
  error: PageHistoryConsolidationError,
): PageHistoryConsolidationFailure {
  return {
    pageId,
    code: error.code,
    errorName: error.name,
  };
}

export interface PageHistoryServiceDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly protectedContent: ProtectedContent;
  readonly rotationPolicies: RotationPolicyService;
  readonly operations: () => PageOperationService;
  readonly search?: SearchService | undefined;
  readonly now?: () => Date;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inlineText(block: CanonicalBlockV3): string | undefined {
  if (block.type === "code") return block.text;
  if ("content" in block) return block.content.map(({ text }) => text).join("");
  return undefined;
}

function markRanges(block: CanonicalBlockV3): Array<{
  readonly from: number;
  readonly to: number;
  readonly mark: MarkV3;
}> {
  if (!("content" in block)) return [];
  const result: Array<{ from: number; to: number; mark: MarkV3 }> = [];
  let from = 0;
  for (const inline of block.content) {
    const to = from + inline.text.length;
    for (const mark of inline.marks ?? []) result.push({ from, to, mark });
    from = to;
  }
  return result;
}

const STRUCTURAL_KEYS = new Set([
  "type",
  "id",
  "content",
  "text",
  "children",
  "rows",
  "columns",
  "rawExtraProperties",
]);

function blockProperties(block: CanonicalBlockV3): JsonObject {
  const properties: Record<string, JsonValue> = {};
  if ("rawExtraProperties" in block) {
    for (const [key, value] of Object.entries(block.rawExtraProperties ?? {})) {
      properties[key] = value;
    }
  }
  for (const [key, value] of Object.entries(block as unknown as Record<string, unknown>)) {
    if (STRUCTURAL_KEYS.has(key) || value === undefined) continue;
    properties[key] = value as JsonValue;
  }
  return properties;
}

function shallowBlock(block: CanonicalBlockV3): CanonicalBlockV3 {
  if (!("children" in block)) return structuredClone(block);
  const copy = structuredClone(block) as CanonicalBlockV3 & { children?: CanonicalBlockV3[] };
  delete copy.children;
  return copy;
}

interface IndexedBlock {
  readonly block: CanonicalBlockV3;
  readonly parentBlockId: Uuid | null;
  readonly beforeBlockId: Uuid | null;
}

function indexDocument(document: BlockDocumentV3): Map<Uuid, IndexedBlock> {
  const index = new Map<Uuid, IndexedBlock>();
  const visit = (blocks: readonly CanonicalBlockV3[], parentBlockId: Uuid | null) => {
    blocks.forEach((block, offset) => {
      index.set(block.id, {
        block,
        parentBlockId,
        beforeBlockId: blocks[offset + 1]?.id ?? null,
      });
      visit(childrenOfV3(block), block.id);
    });
  };
  visit(document.blocks, null);
  return index;
}

function textAndMarkCommands(current: CanonicalBlockV3, target: CanonicalBlockV3): PageCommand[] {
  const currentText = inlineText(current);
  const targetText = inlineText(target);
  if (currentText === undefined || targetText === undefined) return [];
  const commands: PageCommand[] = [];
  if (currentText !== targetText || !sameJson(markRanges(current), markRanges(target))) {
    commands.push({
      type: "replace-text",
      blockId: target.id,
      from: 0,
      to: currentText.length,
      text: targetText,
    });
    if (target.type !== "code" && targetText.length > 0) {
      const marks = new Map<string, MarkV3>();
      for (const { mark } of [...markRanges(current), ...markRanges(target)]) {
        marks.set(JSON.stringify(mark), mark);
      }
      for (const mark of marks.values()) {
        commands.push({
          type: "set-mark",
          blockId: target.id,
          from: 0,
          to: targetText.length,
          mark,
          enabled: false,
        });
      }
      for (const range of markRanges(target)) {
        if (range.from === range.to) continue;
        commands.push({ type: "set-mark", blockId: target.id, ...range, enabled: true });
      }
    }
  }
  return commands;
}

function payloadCommands(current: CanonicalBlockV3, target: CanonicalBlockV3): PageCommand[] {
  const commands: PageCommand[] = [];
  if (current.type !== target.type) {
    if (isTransformableBlockType(current.type) && isTransformableBlockType(target.type)) {
      commands.push({
        type: "set-block-type",
        blockId: target.id,
        blockType: target.type,
        properties: blockProperties(target),
      });
    } else {
      return [];
    }
  }
  const currentProperties = blockProperties(current);
  for (const [key, value] of Object.entries(blockProperties(target))) {
    if (!sameJson(currentProperties[key], value)) {
      commands.push({ type: "set-block-property", blockId: target.id, key, value });
    }
  }
  commands.push(...textAndMarkCommands(current, target));
  return commands;
}

/**
 * Produces a causal restore transaction instead of a document replacement.
 *
 * Textual and ordinary property changes preserve block identity. Complex
 * schema payloads that cannot be transformed in place are conservatively
 * represented as delete+insert, which keeps concurrent work recoverable via
 * the existing semantic ambiguity layer rather than silently reducing it.
 */
export function commandsForPageRestore(
  current: BlockDocumentV3,
  target: BlockDocumentV3,
): readonly PageCommand[] {
  const currentIndex = indexDocument(current);
  const targetIndex = indexDocument(target);
  const commands: PageCommand[] = [];
  const replaced = new Set<Uuid>();

  const place = (blocks: readonly CanonicalBlockV3[], parentBlockId: Uuid | null) => {
    for (let offset = blocks.length - 1; offset >= 0; offset -= 1) {
      const targetBlock = blocks[offset];
      if (targetBlock === undefined) continue;
      const beforeBlockId = blocks[offset + 1]?.id ?? null;
      const currentBlock = currentIndex.get(targetBlock.id)?.block;
      if (currentBlock === undefined) {
        commands.push({
          type: "insert-block",
          block: shallowBlock(targetBlock),
          parentBlockId,
          beforeBlockId,
        });
      } else {
        const currentProperties = blockProperties(currentBlock);
        const targetProperties = blockProperties(targetBlock);
        const directlyTransformable =
          currentBlock.type === targetBlock.type ||
          (isTransformableBlockType(currentBlock.type) &&
            isTransformableBlockType(targetBlock.type));
        const atomicSchemaPayload = ["table", "unknown"].includes(targetBlock.type);
        const removesProperty = Object.keys(currentProperties).some(
          (key) => !(key in targetProperties),
        );
        const dividerTypeChange =
          currentBlock.type !== targetBlock.type &&
          (currentBlock.type === "divider" || targetBlock.type === "divider");
        if (
          (!directlyTransformable || atomicSchemaPayload || removesProperty || dividerTypeChange) &&
          !sameJson(shallowBlock(currentBlock), shallowBlock(targetBlock))
        ) {
          if (childrenOfV3(currentBlock).length > 0 || childrenOfV3(targetBlock).length > 0) {
            throw new TypeError("a nested schema-changing restore requires an explicit decision");
          }
          commands.push({ type: "delete-block", blockId: targetBlock.id });
          commands.push({
            type: "insert-block",
            block: shallowBlock(targetBlock),
            parentBlockId,
            beforeBlockId,
          });
          replaced.add(targetBlock.id);
        } else {
          commands.push(...payloadCommands(currentBlock, targetBlock));
          const currentPlacement = currentIndex.get(targetBlock.id);
          if (
            currentPlacement?.parentBlockId !== parentBlockId ||
            currentPlacement.beforeBlockId !== beforeBlockId
          ) {
            commands.push({
              type: "move-block",
              blockId: targetBlock.id,
              parentBlockId,
              beforeBlockId,
            });
          }
        }
      }
      if (!replaced.has(targetBlock.id)) place(childrenOfV3(targetBlock), targetBlock.id);
    }
  };
  place(target.blocks, null);

  for (const [blockId, currentBlock] of currentIndex) {
    if (targetIndex.has(blockId)) continue;
    const parentMissing =
      currentBlock.parentBlockId !== null && !targetIndex.has(currentBlock.parentBlockId);
    if (!parentMissing) commands.push({ type: "delete-block", blockId });
  }
  return commands;
}

function pageDocumentFromSnapshot(snapshot: unknown): BlockDocumentV3 | null {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const pageDocument = (snapshot as Record<string, unknown>)["pageDocument"];
  if (pageDocument === null || typeof pageDocument !== "object" || Array.isArray(pageDocument)) {
    return null;
  }
  const record = pageDocument as Record<string, unknown>;
  if (typeof record["formatVersion"] !== "number") return null;
  const migrated = migrateStoredPageDocumentToV3({
    formatVersion: record["formatVersion"],
    body: record["body"],
  });
  return migrated.ok ? normaliseDocumentV3(migrated.document) : null;
}

async function lockItemRevisionHead(
  tx: Transaction,
  workspaceId: Uuid,
  pageId: Uuid,
): Promise<Uuid | null> {
  const rows = await tx
    .select({ currentRevisionId: schema.items.currentRevisionId })
    .from(schema.items)
    .where(and(eq(schema.items.workspaceId, workspaceId), eq(schema.items.id, pageId)))
    .for("update")
    .limit(1);
  return (rows[0]?.currentRevisionId as Uuid | undefined) ?? null;
}

export class PageHistoryService {
  readonly #deps: Omit<PageHistoryServiceDeps, "now"> & { readonly now: () => Date };

  constructor(deps: PageHistoryServiceDeps) {
    this.#deps = { ...deps, now: deps.now ?? (() => new Date()) };
  }

  async consolidateIfDue(
    tx: Transaction,
    pageId: Uuid,
    options: { readonly force?: boolean; readonly now?: Date } = {},
  ): Promise<PageHistoryConsolidation | null> {
    const now = options.now ?? this.#deps.now();
    const state = await lockPageOperationState(tx, this.#deps.workspaceId, pageId);
    if (
      state.status !== "active" ||
      state.revisionWindowStartedAt === null ||
      state.revisionWindowLastUpdateAt === null
    ) {
      return null;
    }
    const idle = now.getTime() - state.revisionWindowLastUpdateAt.getTime() >= PAGE_HISTORY_IDLE_MS;
    const maximum =
      now.getTime() - state.revisionWindowStartedAt.getTime() >= PAGE_HISTORY_MAX_WINDOW_MS;
    if (options.force !== true && !idle && !maximum) return null;
    if (state.lastRevisionId === null) {
      throw new Error("an operational page has no revision boundary to consolidate");
    }

    const historyBoundaryId = state.lastRevisionId as Uuid;
    const itemRevisionHead = await lockItemRevisionHead(tx, this.#deps.workspaceId, pageId);
    if (itemRevisionHead === null) {
      throw new PageHistoryConsolidationError(
        "page-history.item-head-missing",
        "the operational page has no canonical item head",
      );
    }
    const [historyBoundary, itemHead] = await Promise.all([
      getRevision(tx, historyBoundaryId),
      itemRevisionHead === historyBoundaryId ? null : getRevision(tx, itemRevisionHead),
    ]);
    if (
      historyBoundary?.itemId !== pageId ||
      (itemRevisionHead !== historyBoundaryId && itemHead?.itemId !== pageId)
    ) {
      throw new PageHistoryConsolidationError(
        "page-history.lineage-diverged",
        "the item head and operational history boundary belong to different lineages",
      );
    }
    if (itemRevisionHead !== historyBoundaryId) {
      const descendsFromBoundary = await revisionDescendsFrom(
        tx,
        itemRevisionHead,
        historyBoundaryId,
      );
      if (!descendsFromBoundary) {
        throw new PageHistoryConsolidationError(
          "page-history.lineage-diverged",
          "the item head does not descend from the operational history boundary",
        );
      }
    }

    const revisionId = generateUuidV7();
    const mutationId = generateUuidV7();
    const snapshot = await buildItemSnapshot(tx, pageId);
    await insertRevision(tx, {
      id: revisionId,
      itemId: pageId,
      mutationId,
      parentRevisionIds: [itemRevisionHead],
      snapshot,
      acceptedAt: now,
    });
    await this.#deps.protectedContent.writeRevisionSnapshot(tx, { revisionId, snapshot });
    await supersedeRevision(tx, itemRevisionHead, now);
    await tx.insert(schema.mutations).values({
      id: mutationId,
      workspaceId: this.#deps.workspaceId,
      commandType: "page-operations.consolidated",
      status: "accepted",
      submittedAt: now,
      acceptedAt: now,
      resultRevisionIds: [revisionId],
    });
    await tx
      .update(schema.items)
      .set({ currentRevisionId: revisionId, updatedAt: now })
      .where(
        and(eq(schema.items.workspaceId, this.#deps.workspaceId), eq(schema.items.id, pageId)),
      );
    await tx
      .update(schema.pageOperationStates)
      .set({
        lastRevisionId: revisionId,
        revisionWindowStartedAt: null,
        revisionWindowLastUpdateAt: null,
        revisionWindowFrontierEnvelopeId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.pageOperationStates.workspaceId, this.#deps.workspaceId),
          eq(schema.pageOperationStates.pageId, pageId),
        ),
      );
    await tx
      .update(schema.pageOperationCheckpoints)
      .set({ revisionId })
      .where(
        and(
          eq(schema.pageOperationCheckpoints.workspaceId, this.#deps.workspaceId),
          eq(schema.pageOperationCheckpoints.pageId, pageId),
          eq(schema.pageOperationCheckpoints.throughPageSequence, state.lastUpdateSequence),
        ),
      );
    return { pageId, revisionId };
  }

  async consolidateDue(): Promise<PageHistoryConsolidationRun> {
    const now = this.#deps.now();
    const idleBefore = new Date(now.getTime() - PAGE_HISTORY_IDLE_MS);
    const maximumBefore = new Date(now.getTime() - PAGE_HISTORY_MAX_WINDOW_MS);
    const candidates = await this.#deps.db
      .select({ pageId: schema.pageOperationStates.pageId })
      .from(schema.pageOperationStates)
      .where(
        and(
          eq(schema.pageOperationStates.workspaceId, this.#deps.workspaceId),
          eq(schema.pageOperationStates.status, "active"),
          isNotNull(schema.pageOperationStates.revisionWindowStartedAt),
          or(
            lte(schema.pageOperationStates.revisionWindowLastUpdateAt, idleBefore),
            lte(schema.pageOperationStates.revisionWindowStartedAt, maximumBefore),
          ),
        ),
      );
    const pageIds: Uuid[] = [];
    const failures: PageHistoryConsolidationFailure[] = [];
    for (const candidate of candidates) {
      const pageId = candidate.pageId as Uuid;
      try {
        const consolidated = await runMutation(this.#deps.db, async (tx) => {
          await this.#deps.rotationPolicies.assertWritesAllowed(tx);
          return await this.consolidateIfDue(tx, pageId, { now });
        });
        if (consolidated !== null) pageIds.push(consolidated.pageId);
      } catch (error) {
        if (!(error instanceof PageHistoryConsolidationError)) throw error;
        failures.push(consolidationFailure(pageId, error));
      }
    }
    return { consolidated: pageIds.length, pageIds, failures };
  }

  async restoreRevision(input: {
    readonly revisionId: Uuid;
    readonly expectedCurrentRevisionId: Uuid;
    readonly mutationId: Uuid;
    readonly deviceId: Uuid;
  }): Promise<{ readonly mutationId: Uuid; readonly revisionIds: readonly Uuid[] }> {
    let committedSequence: number | undefined;
    let changedPageId: Uuid | undefined;
    const result = await runMutation(this.#deps.db, async (tx) => {
      await this.#deps.rotationPolicies.assertWritesAllowed(tx);
      const replay = await tx
        .select({
          commandType: schema.mutations.commandType,
          status: schema.mutations.status,
          revisionIds: schema.mutations.resultRevisionIds,
        })
        .from(schema.mutations)
        .where(eq(schema.mutations.id, input.mutationId))
        .limit(1);
      if (replay[0] !== undefined) {
        if (replay[0].commandType !== "revision.restore" || replay[0].status !== "accepted") {
          throw new Error("the restore idempotency key belongs to another mutation");
        }
        return {
          mutationId: input.mutationId,
          revisionIds: replay[0].revisionIds as Uuid[],
        };
      }

      const source = await getRevision(tx, input.revisionId);
      if (source === null) {
        throw new PageHistoryServiceError("revision.not-found", "Revision does not exist", 404);
      }
      const state = await lockPageOperationState(tx, this.#deps.workspaceId, source.itemId);
      if (state.status !== "active" || state.lastRevisionId === null) {
        throw new PageHistoryServiceError("revision.not-found", "Revision is not operational", 404);
      }
      // The canonical item head can advance through a rename, move or another
      // non-editor mutation while the operational content boundary stays put.
      // Lock and compare both heads before touching the page so that such a
      // race is an explicit stale-base conflict, never a 500 or an overwrite.
      const itemRevisionHead = await lockItemRevisionHead(
        tx,
        this.#deps.workspaceId,
        source.itemId,
      );
      if (itemRevisionHead === null) {
        throw new PageHistoryServiceError("revision.not-found", "Revision is not operational", 404);
      }
      const competingRevisionIds = [state.lastRevisionId as Uuid, itemRevisionHead].filter(
        (revisionId, index, all) =>
          revisionId !== input.expectedCurrentRevisionId && all.indexOf(revisionId) === index,
      );
      if (competingRevisionIds.length > 0) {
        throw new PageHistoryServiceError(
          "revision.stale-base",
          "The page has advanced since this restore was prepared",
          409,
          competingRevisionIds,
        );
      }
      // A restore is a semantic boundary. Preserve any live editing window as
      // its own visible revision before applying the inverse operations, so the
      // work being restored over remains recoverable from history.
      await this.consolidateIfDue(tx, source.itemId, { force: true });
      const protectedSnapshot = await this.#deps.protectedContent.readRevisionSnapshot<
        Record<string, unknown>
      >(tx, input.revisionId);
      const target = pageDocumentFromSnapshot(protectedSnapshot ?? source.snapshot);
      if (target === null) {
        throw new PageHistoryServiceError(
          "revision.snapshot-expired",
          "Revision content is no longer retained",
          410,
        );
      }
      const loaded = await this.#deps.operations().loadForMutation(tx, source.itemId);
      const current = (await loaded.document.project()).document;
      const commands = commandsForPageRestore(current, target);
      if (commands.length === 0) {
        throw new PageHistoryServiceError(
          "revision.stale-base",
          "The selected revision already matches the page",
          409,
          [state.lastRevisionId as Uuid],
        );
      }
      const applied = await this.#deps.operations().applyServerCommands(
        {
          pageId: source.itemId,
          deviceId: input.deviceId,
          mutationId: input.mutationId,
          commandType: "revision.restore",
          commands,
        },
        tx,
      );
      committedSequence = applied.committedSequence;
      changedPageId = source.itemId;
      return { mutationId: input.mutationId, revisionIds: [applied.revisionId] };
    });
    announceCommitted(committedSequence);
    if (
      committedSequence !== undefined &&
      changedPageId !== undefined &&
      this.#deps.search !== undefined
    ) {
      try {
        await this.#deps.search.applyCommittedChanges([changedPageId], committedSequence);
      } catch {
        // The canonical restore is committed. Search marks itself stale and
        // rebuilds; a derived index cannot turn a successful restore into a
        // failed synchronization event.
      }
    }
    return result;
  }

  async historyAllowsCompaction(
    tx: Transaction,
    context: PageCheckpointRetentionContext,
  ): Promise<boolean> {
    const [state, checkpoint] = await Promise.all([
      lockPageOperationState(tx, context.workspaceId, context.pageId),
      readPageOperationCheckpoint(tx, {
        workspaceId: context.workspaceId,
        pageId: context.pageId,
        checkpointId: context.checkpointId,
      }),
    ]);
    if (
      checkpoint === null ||
      state.revisionWindowStartedAt !== null ||
      checkpoint.revisionId === null ||
      checkpoint.revisionId !== state.lastRevisionId
    ) {
      return false;
    }
    const revision = await getRevision(tx, checkpoint.revisionId as Uuid);
    return revision?.snapshot !== null;
  }
}
