import {
  type CanonicalBlockV3,
  childrenOfV3,
  type JsonValue,
  type Uuid,
} from "@myownnotion/domain";
import type { PageCommand, PageSemanticChange, PageTransactionResult } from "./document.ts";
import { compareVersionVectorBytes, versionVectorBytesEqual } from "./update-envelope.ts";

export type PageAmbiguityKind =
  | "delete-edit"
  | "delete-move"
  | "type-transform"
  | "property-transform"
  | "schema";

export interface SemanticUpdateRecord {
  readonly updateId: Uuid;
  readonly baseVersionVector: Uint8Array;
  readonly resultVersionVector: Uint8Array;
  readonly semanticChanges: readonly PageSemanticChange[];
}

export interface PageAmbiguity {
  readonly logicalKey: string;
  readonly kind: PageAmbiguityKind;
  readonly status: "open";
  readonly blockIds: readonly Uuid[];
  readonly sourceUpdateIds: readonly [Uuid, Uuid];
  readonly deletedSubtree?: CanonicalBlockV3;
  readonly recoverableSubtree?: CanonicalBlockV3;
  readonly recoverablePlacement?: {
    readonly parentBlockId: Uuid | null;
    readonly beforeBlockId: Uuid | null;
  };
  readonly propertyKey?: string;
  readonly alternatives?: readonly [CanonicalBlockV3, CanonicalBlockV3];
}

export type PageAmbiguityResolutionDecision =
  | { readonly decision: "confirm-delete" }
  | {
      readonly decision: "restore-change";
      readonly parentBlockId: Uuid | null;
      readonly beforeBlockId: Uuid | null;
    }
  | {
      readonly decision: "custom";
      readonly result: CanonicalBlockV3;
      readonly parentBlockId: Uuid | null;
      readonly beforeBlockId: Uuid | null;
    };

export interface PageAmbiguityResolutionPlan {
  readonly logicalKey: string;
  readonly decision: PageAmbiguityResolutionDecision["decision"];
  readonly status: "resolved-delete" | "resolved-keep" | "resolved-custom";
  readonly sourceUpdateIds: readonly [Uuid, Uuid];
  readonly commands: readonly PageCommand[];
  /** Persisted alongside any content commands; source updates remain immutable. */
  readonly resolutionOperation: {
    readonly type: "ambiguity-resolution";
    readonly logicalKey: string;
    readonly decision: PageAmbiguityResolutionDecision["decision"];
  };
}

export class SemanticConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticConflictError";
  }
}

export function semanticUpdateFromTransaction(
  updateId: Uuid,
  transaction: PageTransactionResult,
): SemanticUpdateRecord {
  return {
    updateId,
    baseVersionVector: transaction.baseVersionVector,
    resultVersionVector: transaction.resultVersionVector,
    semanticChanges: transaction.semanticChanges,
  };
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const child = value[key];
        if (child === undefined) throw new SemanticConflictError(`JSON key ${key} is undefined`);
        return `${JSON.stringify(key)}:${canonicalJson(child)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sortedPair(left: Uuid, right: Uuid): readonly [Uuid, Uuid] {
  return left < right ? [left, right] : [right, left];
}

function uniqueSortedIds(ids: Iterable<Uuid>): Uuid[] {
  return [...new Set(ids)].sort();
}

function logicalKey(
  kind: PageAmbiguityKind,
  sourceUpdateIds: readonly [Uuid, Uuid],
  blockIds: readonly Uuid[],
  discriminator = "",
): string {
  return [kind, ...sourceUpdateIds, ...uniqueSortedIds(blockIds), discriminator].join(":");
}

function concurrent(left: SemanticUpdateRecord, right: SemanticUpdateRecord): boolean {
  return (
    compareVersionVectorBytes(left.resultVersionVector, right.resultVersionVector) === "concurrent"
  );
}

function deduplicateUpdates(updates: readonly SemanticUpdateRecord[]): SemanticUpdateRecord[] {
  const unique = new Map<Uuid, SemanticUpdateRecord>();
  for (const update of updates) {
    const previous = unique.get(update.updateId);
    if (previous === undefined) {
      unique.set(update.updateId, update);
      continue;
    }
    if (!versionVectorBytesEqual(previous.resultVersionVector, update.resultVersionVector)) {
      throw new SemanticConflictError(`update identity ${update.updateId} was reused`);
    }
  }
  return [...unique.values()].sort((left, right) => left.updateId.localeCompare(right.updateId));
}

function blockAfter(change: PageSemanticChange): CanonicalBlockV3 | undefined {
  switch (change.type) {
    case "block-inserted":
    case "block-moved":
    case "text-replaced":
    case "mark-set":
    case "block-property-set":
    case "block-type-set":
    case "schema-changed":
      return change.blockAfter;
    case "block-deleted":
      return undefined;
  }
}

function changeTouchesDeletedSubtree(
  change: PageSemanticChange,
  deletedIds: ReadonlySet<Uuid>,
): boolean {
  if (change.type === "block-deleted") return false;
  if (deletedIds.has(change.blockId)) return true;
  if (
    change.type === "block-inserted" &&
    change.placementAfter.parentBlockId !== null &&
    deletedIds.has(change.placementAfter.parentBlockId)
  ) {
    return true;
  }
  return false;
}

function mapChildren(
  block: CanonicalBlockV3,
  map: (child: CanonicalBlockV3) => CanonicalBlockV3,
): CanonicalBlockV3 {
  if (block.type === "unknown") return block;
  if (block.type === "table") {
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          ...(cell.children === undefined ? {} : { children: cell.children.map(map) }),
        })),
      })),
    };
  }
  const children = childrenOfV3(block);
  if (children.length === 0 || !("children" in block)) return block;
  return { ...block, children: children.map(map) } as CanonicalBlockV3;
}

function replaceDescendant(
  subtree: CanonicalBlockV3,
  replacement: CanonicalBlockV3,
): CanonicalBlockV3 {
  if (subtree.id === replacement.id) return replacement;
  return mapChildren(subtree, (child) => replaceDescendant(child, replacement));
}

function deletionAmbiguity(
  deletionUpdate: SemanticUpdateRecord,
  deletion: Extract<PageSemanticChange, { type: "block-deleted" }>,
  changeUpdate: SemanticUpdateRecord,
): PageAmbiguity | undefined {
  const deletedIds = new Set(deletion.affectedBlockIds);
  const relevant = changeUpdate.semanticChanges.filter((change) =>
    changeTouchesDeletedSubtree(change, deletedIds),
  );
  if (relevant.length === 0) return undefined;

  const move = relevant.find(
    (change): change is Extract<PageSemanticChange, { type: "block-moved" }> =>
      change.type === "block-moved",
  );
  const kind: PageAmbiguityKind = move === undefined ? "delete-edit" : "delete-move";
  let recoverableSubtree = move?.blockAfter ?? deletion.blockBefore;
  if (move === undefined) {
    for (const change of relevant) {
      const replacement = blockAfter(change);
      if (replacement !== undefined) {
        recoverableSubtree = replaceDescendant(recoverableSubtree, replacement);
      }
    }
  }
  const sourceUpdateIds = sortedPair(deletionUpdate.updateId, changeUpdate.updateId);
  const blockIds = uniqueSortedIds([deletion.blockId, ...relevant.map(({ blockId }) => blockId)]);
  return {
    logicalKey: logicalKey(kind, sourceUpdateIds, [deletion.blockId]),
    kind,
    status: "open",
    blockIds,
    sourceUpdateIds,
    deletedSubtree: deletion.blockBefore,
    recoverableSubtree,
    recoverablePlacement: move?.placementAfter ?? deletion.placementBefore,
  };
}

function transformAmbiguities(
  left: SemanticUpdateRecord,
  right: SemanticUpdateRecord,
): PageAmbiguity[] {
  const result: PageAmbiguity[] = [];
  const sourceUpdateIds = sortedPair(left.updateId, right.updateId);
  for (const leftChange of left.semanticChanges) {
    for (const rightChange of right.semanticChanges) {
      if (leftChange.blockId !== rightChange.blockId) continue;
      if (leftChange.type === "block-type-set" && rightChange.type === "block-type-set") {
        if (leftChange.afterType === rightChange.afterType) continue;
        const blockIds = [leftChange.blockId];
        result.push({
          logicalKey: logicalKey("type-transform", sourceUpdateIds, blockIds),
          kind: "type-transform",
          status: "open",
          blockIds,
          sourceUpdateIds,
          recoverableSubtree: leftChange.blockAfter,
          alternatives: [leftChange.blockAfter, rightChange.blockAfter],
        });
      }
      if (
        leftChange.type === "block-property-set" &&
        rightChange.type === "block-property-set" &&
        leftChange.key === rightChange.key
      ) {
        if (canonicalJson(leftChange.after) === canonicalJson(rightChange.after)) continue;
        const blockIds = [leftChange.blockId];
        result.push({
          logicalKey: logicalKey("property-transform", sourceUpdateIds, blockIds, leftChange.key),
          kind: "property-transform",
          status: "open",
          blockIds,
          sourceUpdateIds,
          propertyKey: leftChange.key,
          recoverableSubtree: leftChange.blockAfter,
          alternatives: [leftChange.blockAfter, rightChange.blockAfter],
        });
      }
      if (leftChange.type === "schema-changed" && rightChange.type === "schema-changed") {
        if (leftChange.afterSchemaVersion === rightChange.afterSchemaVersion) continue;
        const blockIds = [leftChange.blockId];
        result.push({
          logicalKey: logicalKey("schema", sourceUpdateIds, blockIds),
          kind: "schema",
          status: "open",
          blockIds,
          sourceUpdateIds,
          recoverableSubtree: leftChange.blockAfter,
          alternatives: [leftChange.blockAfter, rightChange.blockAfter],
        });
      }
    }
  }
  return result;
}

export function detectPageAmbiguities(updates: readonly SemanticUpdateRecord[]): PageAmbiguity[] {
  const records = deduplicateUpdates(updates);
  const ambiguities = new Map<string, PageAmbiguity>();
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const left = records[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const right = records[rightIndex];
      if (right === undefined || !concurrent(left, right)) continue;
      for (const change of left.semanticChanges) {
        if (change.type !== "block-deleted") continue;
        const ambiguity = deletionAmbiguity(left, change, right);
        if (ambiguity !== undefined) ambiguities.set(ambiguity.logicalKey, ambiguity);
      }
      for (const change of right.semanticChanges) {
        if (change.type !== "block-deleted") continue;
        const ambiguity = deletionAmbiguity(right, change, left);
        if (ambiguity !== undefined) ambiguities.set(ambiguity.logicalKey, ambiguity);
      }
      for (const ambiguity of transformAmbiguities(left, right)) {
        ambiguities.set(ambiguity.logicalKey, ambiguity);
      }
    }
  }
  return [...ambiguities.values()].sort((left, right) =>
    left.logicalKey.localeCompare(right.logicalKey),
  );
}

function replacementCommands(
  ambiguity: PageAmbiguity,
  block: CanonicalBlockV3,
  parentBlockId: Uuid | null,
  beforeBlockId: Uuid | null,
): PageCommand[] {
  const insert: PageCommand = {
    type: "insert-block",
    block,
    parentBlockId,
    beforeBlockId,
  };
  if (ambiguity.kind === "delete-edit" || ambiguity.kind === "delete-move") return [insert];
  return [{ type: "delete-block", blockId: block.id }, insert];
}

export function planPageAmbiguityResolution(
  ambiguity: PageAmbiguity,
  resolution: PageAmbiguityResolutionDecision,
): PageAmbiguityResolutionPlan {
  let status: PageAmbiguityResolutionPlan["status"];
  let commands: PageCommand[];
  switch (resolution.decision) {
    case "confirm-delete":
      if (ambiguity.kind !== "delete-edit" && ambiguity.kind !== "delete-move") {
        throw new SemanticConflictError("confirm-delete only resolves a deletion ambiguity");
      }
      status = "resolved-delete";
      commands = [];
      break;
    case "restore-change":
      if (ambiguity.recoverableSubtree === undefined) {
        throw new SemanticConflictError("the changed subtree is not recoverable");
      }
      status = "resolved-keep";
      commands = replacementCommands(
        ambiguity,
        ambiguity.recoverableSubtree,
        resolution.parentBlockId,
        resolution.beforeBlockId,
      );
      break;
    case "custom":
      status = "resolved-custom";
      commands = replacementCommands(
        ambiguity,
        resolution.result,
        resolution.parentBlockId,
        resolution.beforeBlockId,
      );
      break;
  }
  return {
    logicalKey: ambiguity.logicalKey,
    decision: resolution.decision,
    status,
    sourceUpdateIds: ambiguity.sourceUpdateIds,
    commands,
    resolutionOperation: {
      type: "ambiguity-resolution",
      logicalKey: ambiguity.logicalKey,
      decision: resolution.decision,
    },
  };
}
