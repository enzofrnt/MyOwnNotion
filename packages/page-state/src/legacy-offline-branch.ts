import {
  type BlockDocument,
  type BlockDocumentV3,
  type CanonicalBlockV3,
  canonicalDocumentJsonV3,
  childrenOfV3,
  documentDigestV3,
  hasInlineContentV3,
  type JsonObject,
  type JsonValue,
  type MarkV3,
  migrateDocumentV2ToV3,
  normaliseDocument,
  normaliseDocumentV3,
  type TableBlockV3,
  type TableCellV3,
  type TableColumnV3,
  type TableRowV3,
  type Uuid,
} from "@myownnotion/domain";
import { isTransformableBlockType } from "./block-tree.ts";
import {
  OperationalPageDocument,
  type PageCommand,
  type PageTransactionResult,
} from "./document.ts";
import type { PageAmbiguity, PageAmbiguityKind } from "./semantic-conflicts.ts";

const MAX_CONTEXT_LENGTH = 64;

export type LegacySemanticCommand =
  | {
      readonly type: "insert-block";
      readonly block: CanonicalBlockV3;
      readonly parentBlockId: Uuid | null;
      readonly beforeBlockId: Uuid | null;
    }
  | {
      readonly type: "move-block";
      readonly blockId: Uuid;
      readonly parentBlockId: Uuid | null;
      readonly beforeBlockId: Uuid | null;
    }
  | { readonly type: "delete-block"; readonly blockId: Uuid }
  | {
      readonly type: "replace-text";
      readonly blockId: Uuid;
      readonly baseFrom: number;
      readonly baseTo: number;
      readonly beforeContext: string;
      readonly afterContext: string;
      readonly text: string;
    }
  | {
      readonly type: "set-mark";
      readonly blockId: Uuid;
      readonly baseFrom: number;
      readonly baseTo: number;
      readonly mark: MarkV3;
      readonly enabled: boolean;
    }
  | {
      readonly type: "set-type-or-property";
      readonly blockId: Uuid;
      readonly key: string;
      readonly before: JsonValue;
      readonly after: JsonValue;
      readonly properties?: JsonObject;
    }
  | {
      readonly type: "insert-table-row";
      readonly tableId: Uuid;
      readonly row: TableRowV3;
      readonly beforeRowId: Uuid | null;
    }
  | {
      readonly type: "delete-table-row";
      readonly tableId: Uuid;
      readonly rowId: Uuid;
    }
  | {
      readonly type: "insert-table-column";
      readonly tableId: Uuid;
      readonly column: TableColumnV3;
      readonly cells: readonly {
        readonly rowId: Uuid;
        readonly cell: TableCellV3;
      }[];
      readonly beforeColumnId: Uuid | null;
    }
  | {
      readonly type: "delete-table-column";
      readonly tableId: Uuid;
      readonly columnId: Uuid;
    };

export interface LegacySemanticTransaction {
  readonly transactionId: Uuid;
  readonly sequence: number;
  readonly commands: readonly LegacySemanticCommand[];
}

export interface LegacyOfflineBranch {
  readonly mode: "legacy-branch";
  readonly branchId: Uuid;
  readonly pageId: Uuid;
  readonly baseRevisionId: Uuid;
  readonly baseCanonicalDigest: string;
  /** Original transport-safe v2 base, retained when the server's revision snapshot expires. */
  readonly baseDocumentV2: BlockDocument;
  readonly baseDocument: BlockDocumentV3;
  readonly localDocument: BlockDocumentV3;
  readonly localDocumentDigest: string;
  readonly semanticTransactions: readonly LegacySemanticTransaction[];
  /**
   * The transaction that gave a freshly opened empty page its first paragraph,
   * so BlockNote has something to mount. It is device-local bootstrap: it is
   * never persisted alone, and a branch holding only it counts as unedited —
   * opening a page migrates nothing (plan §6).
   */
  readonly bootstrapTransactionId?: Uuid;
  readonly createdAt: string;
  readonly status: "editing" | "sending" | "blocked" | "converted";
}

export interface LegacyBranchReplayResult {
  readonly document: BlockDocumentV3;
  readonly digest: string;
}

export interface LegacyBranchConversionResult {
  readonly convertedBranchId: Uuid;
  readonly localDocumentDigest: string;
  readonly commands: readonly PageCommand[];
  readonly transaction: PageTransactionResult | undefined;
  readonly ambiguities: readonly PageAmbiguity[];
}

export class LegacyOfflineBranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyOfflineBranchError";
  }
}

interface IndexedNode {
  readonly id: Uuid;
  readonly block: CanonicalBlockV3 | undefined;
  readonly text: string | undefined;
  readonly parentBlockId: Uuid | null;
  readonly beforeBlockId: Uuid | null;
}

function inlineText(block: CanonicalBlockV3): string | undefined {
  if (block.type === "unknown") return undefined;
  if (hasInlineContentV3(block)) return block.content.map(({ text }) => text).join("");
  if (block.type === "code") return block.text;
  return undefined;
}

function indexDocument(document: BlockDocumentV3): Map<Uuid, IndexedNode> {
  const result = new Map<Uuid, IndexedNode>();
  const visit = (blocks: readonly CanonicalBlockV3[], parentBlockId: Uuid | null): void => {
    for (const [index, block] of blocks.entries()) {
      result.set(block.id, {
        id: block.id,
        block,
        text: inlineText(block),
        parentBlockId,
        beforeBlockId: blocks[index + 1]?.id ?? null,
      });
      if (block.type === "unknown") continue;
      if (block.type === "table") {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            result.set(cell.id, {
              id: cell.id,
              block: undefined,
              text: cell.content.map(({ text }) => text).join(""),
              parentBlockId: block.id,
              beforeBlockId: null,
            });
            visit(cell.children ?? [], cell.id);
          }
        }
      } else {
        visit(childrenOfV3(block), block.id);
      }
    }
  };
  visit(document.blocks, null);
  return result;
}

function canonicalValue(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const child = value[key];
        if (child === undefined) throw new LegacyOfflineBranchError(`JSON key ${key} is undefined`);
        return `${JSON.stringify(key)}:${canonicalValue(child)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalValue(left) === canonicalValue(right);
}

function blockProperty(block: CanonicalBlockV3, key: string): JsonValue | undefined {
  if (key === "type") return block.type;
  if (block.type === "unknown") return block.raw[key];
  const direct = (block as unknown as Record<string, unknown>)[key];
  if (
    direct === null ||
    typeof direct === "string" ||
    typeof direct === "number" ||
    typeof direct === "boolean" ||
    Array.isArray(direct)
  ) {
    return direct as JsonValue;
  }
  if (direct !== undefined && typeof direct === "object") return direct as JsonValue;
  return block.rawExtraProperties?.[key];
}

function transformProperties(block: CanonicalBlockV3): JsonObject | undefined {
  if (block.type === "unknown") return undefined;
  const known: JsonObject =
    block.type === "heading"
      ? { level: block.level }
      : block.type === "checkbox"
        ? { checked: block.checked }
        : block.type === "code"
          ? { language: block.language }
          : block.type === "callout"
            ? { icon: block.icon, tone: block.tone }
            : {};
  const properties = { ...known, ...block.rawExtraProperties };
  return Object.keys(properties).length === 0 ? undefined : properties;
}

function assertTextRange(text: string, from: number, to: number): void {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from > to ||
    to > text.length
  ) {
    throw new LegacyOfflineBranchError("legacy text range is outside its block");
  }
  for (const offset of [from, to]) {
    if (offset <= 0 || offset >= text.length) continue;
    const before = text.charCodeAt(offset - 1);
    const after = text.charCodeAt(offset);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
      throw new LegacyOfflineBranchError("legacy text range splits a UTF-16 surrogate pair");
    }
  }
}

function assertContexts(
  text: string,
  from: number,
  to: number,
  beforeContext: string,
  afterContext: string,
): void {
  if (beforeContext.length > MAX_CONTEXT_LENGTH || afterContext.length > MAX_CONTEXT_LENGTH) {
    throw new LegacyOfflineBranchError(
      `legacy text contexts must not exceed ${MAX_CONTEXT_LENGTH}`,
    );
  }
  if (text.slice(Math.max(0, from - beforeContext.length), from) !== beforeContext) {
    throw new LegacyOfflineBranchError("legacy before-context does not match its source text");
  }
  if (text.slice(to, to + afterContext.length) !== afterContext) {
    throw new LegacyOfflineBranchError("legacy after-context does not match its source text");
  }
}

function proofCommand(command: LegacySemanticCommand, document: BlockDocumentV3): PageCommand {
  const nodes = indexDocument(document);
  switch (command.type) {
    case "insert-block":
    case "move-block":
    case "delete-block":
    case "insert-table-row":
    case "delete-table-row":
    case "insert-table-column":
    case "delete-table-column":
      return command;
    case "replace-text": {
      const text = nodes.get(command.blockId)?.text;
      if (text === undefined) {
        throw new LegacyOfflineBranchError(`legacy text block ${command.blockId} does not exist`);
      }
      assertTextRange(text, command.baseFrom, command.baseTo);
      assertContexts(
        text,
        command.baseFrom,
        command.baseTo,
        command.beforeContext,
        command.afterContext,
      );
      return {
        type: "replace-text",
        blockId: command.blockId,
        from: command.baseFrom,
        to: command.baseTo,
        text: command.text,
      };
    }
    case "set-mark": {
      const text = nodes.get(command.blockId)?.text;
      if (text === undefined) {
        throw new LegacyOfflineBranchError(`legacy text block ${command.blockId} does not exist`);
      }
      assertTextRange(text, command.baseFrom, command.baseTo);
      return {
        type: "set-mark",
        blockId: command.blockId,
        from: command.baseFrom,
        to: command.baseTo,
        mark: command.mark,
        enabled: command.enabled,
      };
    }
    case "set-type-or-property": {
      const block = nodes.get(command.blockId)?.block;
      if (block === undefined) {
        throw new LegacyOfflineBranchError(`legacy block ${command.blockId} does not exist`);
      }
      const current = blockProperty(block, command.key) ?? null;
      if (!valuesEqual(current, command.before)) {
        throw new LegacyOfflineBranchError(
          `legacy ${command.key} precondition does not match block ${command.blockId}`,
        );
      }
      if (command.key === "type") {
        if (!isTransformableBlockType(command.after)) {
          throw new LegacyOfflineBranchError(
            `legacy target type ${String(command.after)} is unsupported`,
          );
        }
        return {
          type: "set-block-type",
          blockId: command.blockId,
          blockType: command.after,
          ...(command.properties === undefined ? {} : { properties: command.properties }),
        };
      }
      return {
        type: "set-block-property",
        blockId: command.blockId,
        key: command.key,
        value: command.after,
      };
    }
  }
}

async function replay(
  pageId: Uuid,
  baseDocument: BlockDocumentV3,
  transactions: readonly LegacySemanticTransaction[],
): Promise<LegacyBranchReplayResult> {
  const page = OperationalPageDocument.create({
    pageId,
    document: baseDocument,
  });
  const seenTransactions = new Set<Uuid>();
  for (const [index, transaction] of transactions.entries()) {
    if (transaction.sequence !== index + 1) {
      throw new LegacyOfflineBranchError(
        "legacy transaction sequences must be contiguous from one",
      );
    }
    if (seenTransactions.has(transaction.transactionId)) {
      throw new LegacyOfflineBranchError(
        `legacy transaction ${transaction.transactionId} is duplicated`,
      );
    }
    seenTransactions.add(transaction.transactionId);
    for (const command of transaction.commands) {
      const projection = await page.project();
      page.transact([proofCommand(command, projection.document)]);
    }
  }
  const document = (await page.project()).document;
  return { document, digest: await documentDigestV3(document) };
}

export async function createLegacyOfflineBranch(input: {
  readonly branchId: Uuid;
  readonly pageId: Uuid;
  readonly baseRevisionId: Uuid;
  readonly baseDocument: BlockDocument;
  readonly createdAt: string;
}): Promise<LegacyOfflineBranch> {
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new LegacyOfflineBranchError("legacy branch creation time must be RFC 3339 compatible");
  }
  const baseDocument = normaliseDocumentV3(migrateDocumentV2ToV3(input.baseDocument));
  const baseDocumentV2 = normaliseDocument(input.baseDocument);
  const baseCanonicalDigest = await documentDigestV3(baseDocument);
  return {
    mode: "legacy-branch",
    branchId: input.branchId,
    pageId: input.pageId,
    baseRevisionId: input.baseRevisionId,
    baseCanonicalDigest,
    baseDocumentV2,
    baseDocument,
    localDocument: baseDocument,
    localDocumentDigest: baseCanonicalDigest,
    semanticTransactions: [],
    createdAt: input.createdAt,
    status: "editing",
  };
}

export async function appendLegacySemanticTransaction(
  branch: LegacyOfflineBranch,
  transaction: LegacySemanticTransaction,
): Promise<LegacyOfflineBranch> {
  if (branch.status !== "editing") {
    throw new LegacyOfflineBranchError(`legacy branch in ${branch.status} state cannot be edited`);
  }
  if (transaction.sequence !== branch.semanticTransactions.length + 1) {
    throw new LegacyOfflineBranchError("legacy transaction sequence is not the next sequence");
  }
  if (
    branch.semanticTransactions.some(
      ({ transactionId }) => transactionId === transaction.transactionId,
    )
  ) {
    throw new LegacyOfflineBranchError(
      `legacy transaction ${transaction.transactionId} is duplicated`,
    );
  }
  const semanticTransactions = [...branch.semanticTransactions, transaction];
  const replayed = await replay(branch.pageId, branch.baseDocument, semanticTransactions);
  return {
    ...branch,
    semanticTransactions,
    localDocument: replayed.document,
    localDocumentDigest: replayed.digest,
  };
}

/**
 * Turns one verified local Loro transaction into the transport-independent
 * semantic proof retained by a not-yet-activated legacy page.
 *
 * The transaction's update bytes are deliberately ignored: they descend from
 * a device-local bootstrap and therefore cannot be merged with a server
 * bootstrap created independently from the same canonical JSON.
 */
export function legacySemanticCommandsFromTransaction(input: {
  readonly pageId: Uuid;
  readonly beforeDocument: BlockDocumentV3;
  readonly transaction: PageTransactionResult;
}): LegacySemanticCommand[] {
  if (!input.transaction.changed) return [];
  const proofPage = OperationalPageDocument.create({
    pageId: input.pageId,
    document: input.beforeDocument,
  });
  const commands: LegacySemanticCommand[] = [];
  for (const change of input.transaction.semanticChanges) {
    const beforeDocument = proofPage.snapshot();
    const before = indexDocument(beforeDocument);
    const command: LegacySemanticCommand = (() => {
      switch (change.type) {
        case "block-inserted":
          return {
            type: "insert-block",
            block: change.blockAfter,
            parentBlockId: change.placementAfter.parentBlockId,
            beforeBlockId: change.placementAfter.beforeBlockId,
          };
        case "block-moved":
          return {
            type: "move-block",
            blockId: change.blockId,
            parentBlockId: change.placementAfter.parentBlockId,
            beforeBlockId: change.placementAfter.beforeBlockId,
          };
        case "block-deleted":
          return { type: "delete-block", blockId: change.blockId };
        case "text-replaced": {
          const beforeText = before.get(change.blockId)?.text;
          const afterText = indexDocument({ blocks: [change.blockAfter] }).get(
            change.blockId,
          )?.text;
          if (beforeText === undefined || afterText === undefined) {
            throw new LegacyOfflineBranchError(
              `text transaction target ${change.blockId} is not representable`,
            );
          }
          assertTextRange(beforeText, change.from, change.to);
          if (beforeText.slice(change.from, change.to) !== change.removedText) {
            throw new LegacyOfflineBranchError(
              `text transaction proof does not match block ${change.blockId}`,
            );
          }
          const inserted = afterText.slice(change.from, change.from + change.insertedLength);
          const expectedAfter =
            beforeText.slice(0, change.from) + inserted + beforeText.slice(change.to);
          if (expectedAfter !== afterText) {
            throw new LegacyOfflineBranchError(
              `text transaction result does not match block ${change.blockId}`,
            );
          }
          return {
            type: "replace-text",
            blockId: change.blockId,
            baseFrom: change.from,
            baseTo: change.to,
            beforeContext: beforeText.slice(
              Math.max(0, change.from - MAX_CONTEXT_LENGTH),
              change.from,
            ),
            afterContext: beforeText.slice(change.to, change.to + MAX_CONTEXT_LENGTH),
            text: inserted,
          };
        }
        case "mark-set":
          return {
            type: "set-mark",
            blockId: change.blockId,
            baseFrom: change.from,
            baseTo: change.to,
            mark: change.mark,
            enabled: change.enabled,
          };
        case "block-property-set":
          return {
            type: "set-type-or-property",
            blockId: change.blockId,
            key: change.key,
            before: change.before ?? null,
            after: change.after,
          };
        case "block-type-set": {
          const properties = transformProperties(change.blockAfter);
          return {
            type: "set-type-or-property",
            blockId: change.blockId,
            key: "type",
            before: change.beforeType,
            after: change.afterType,
            ...(properties === undefined ? {} : { properties }),
          };
        }
        case "table-row-inserted":
          return {
            type: "insert-table-row",
            tableId: change.blockId,
            row: change.row,
            beforeRowId: change.beforeRowId,
          };
        case "table-row-deleted":
          return {
            type: "delete-table-row",
            tableId: change.blockId,
            rowId: change.row.id,
          };
        case "table-column-inserted":
          return {
            type: "insert-table-column",
            tableId: change.blockId,
            column: change.column,
            cells: change.cells,
            beforeColumnId: change.beforeColumnId,
          };
        case "table-column-deleted":
          return {
            type: "delete-table-column",
            tableId: change.blockId,
            columnId: change.column.id,
          };
        case "schema-changed":
          throw new LegacyOfflineBranchError(
            "schema migrations cannot be recorded as an offline editor transaction",
          );
      }
    })();
    proofPage.transact([proofCommand(command, beforeDocument)]);
    const expectedBlock = "blockAfter" in change ? change.blockAfter : undefined;
    if (expectedBlock !== undefined) {
      const actualBlock = indexDocument(proofPage.snapshot()).get(expectedBlock.id)?.block;
      if (actualBlock === undefined || !sameBlock(actualBlock, expectedBlock)) {
        throw new LegacyOfflineBranchError(
          `legacy transaction proof diverges after ${change.type}`,
        );
      }
    } else if (
      change.type === "block-deleted" &&
      indexDocument(proofPage.snapshot()).has(change.blockId)
    ) {
      throw new LegacyOfflineBranchError(
        `legacy transaction proof retained deleted block ${change.blockId}`,
      );
    }
    commands.push(command);
  }
  return commands;
}

export async function verifyLegacyOfflineBranch(
  branch: LegacyOfflineBranch,
): Promise<LegacyBranchReplayResult> {
  if (branch.mode !== "legacy-branch") {
    throw new LegacyOfflineBranchError("unsupported legacy branch mode");
  }
  const baseDigest = await documentDigestV3(branch.baseDocument);
  if (baseDigest !== branch.baseCanonicalDigest) {
    throw new LegacyOfflineBranchError("legacy base document digest mismatch");
  }
  if (
    canonicalDocumentJsonV3(migrateDocumentV2ToV3(branch.baseDocumentV2)) !==
    canonicalDocumentJsonV3(branch.baseDocument)
  ) {
    throw new LegacyOfflineBranchError("legacy v2 base does not match its v3 proof document");
  }
  const replayed = await replay(branch.pageId, branch.baseDocument, branch.semanticTransactions);
  if (
    replayed.digest !== branch.localDocumentDigest ||
    canonicalDocumentJsonV3(replayed.document) !== canonicalDocumentJsonV3(branch.localDocument)
  ) {
    throw new LegacyOfflineBranchError(
      "legacy local projection does not match its semantic replay",
    );
  }
  return replayed;
}

function allOccurrences(value: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const result: number[] = [];
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + 1)) {
    result.push(index);
  }
  return result;
}

function locateContextGap(
  current: string,
  command: Extract<LegacySemanticCommand, { type: "replace-text" }>,
): { readonly beforeEnd: number; readonly afterStart: number } | undefined {
  const beforeEnds =
    command.beforeContext.length === 0
      ? [0]
      : allOccurrences(current, command.beforeContext).map(
          (index) => index + command.beforeContext.length,
        );
  const afterStarts =
    command.afterContext.length === 0
      ? [current.length]
      : allOccurrences(current, command.afterContext);
  const expectedLength = command.baseTo - command.baseFrom;
  const candidates = beforeEnds
    .flatMap((beforeEnd) =>
      afterStarts
        .filter((afterStart) => afterStart >= beforeEnd)
        .map((afterStart) => ({
          beforeEnd,
          afterStart,
          score:
            Math.abs(afterStart - beforeEnd - expectedLength) +
            Math.abs(beforeEnd - command.baseFrom) / Math.max(1, current.length),
        })),
    )
    .sort((left, right) => left.score - right.score);
  const best = candidates[0];
  if (best === undefined) return undefined;
  const next = candidates[1];
  if (next !== undefined && next.score === best.score) return undefined;
  return best;
}

function sameBlock(left: CanonicalBlockV3, right: CanonicalBlockV3): boolean {
  return (
    canonicalDocumentJsonV3({ blocks: [left] }) === canonicalDocumentJsonV3({ blocks: [right] })
  );
}

function commandBlockId(command: LegacySemanticCommand): Uuid {
  if ("blockId" in command) return command.blockId;
  if (command.type === "insert-block") return command.block.id;
  return command.tableId;
}

function tableFromIndex(
  index: ReadonlyMap<Uuid, IndexedNode>,
  tableId: Uuid,
): TableBlockV3 | undefined {
  const block = index.get(tableId)?.block;
  return block?.type === "table" ? block : undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalValue(left as JsonValue) === canonicalValue(right as JsonValue);
}

function tableColumnCells(table: TableBlockV3, columnId: Uuid): readonly TableCellV3[] | undefined {
  const columnIndex = table.columns.findIndex(({ id }) => id === columnId);
  if (columnIndex < 0) return undefined;
  const cells: TableCellV3[] = [];
  for (const row of table.rows) {
    const cell = row.cells[columnIndex];
    if (cell === undefined) return undefined;
    cells.push(cell);
  }
  return cells;
}

function sourcePair(left: Uuid, right: Uuid): readonly [Uuid, Uuid] {
  return left < right ? [left, right] : [right, left];
}

function legacyAmbiguity(input: {
  readonly branch: LegacyOfflineBranch;
  readonly transactionId: Uuid;
  readonly kind: PageAmbiguityKind;
  readonly blockId: Uuid;
  readonly deletedSubtree?: CanonicalBlockV3;
  readonly recoverableSubtree: CanonicalBlockV3;
  readonly parentBlockId: Uuid | null;
  readonly beforeBlockId: Uuid | null;
  readonly propertyKey?: string;
}): PageAmbiguity {
  const sourceUpdateIds = sourcePair(input.branch.baseRevisionId, input.transactionId);
  const discriminator = input.propertyKey ?? "";
  return {
    logicalKey: ["legacy", input.kind, input.branch.branchId, input.blockId, discriminator].join(
      ":",
    ),
    kind: input.kind,
    status: "open",
    blockIds: [input.blockId],
    sourceUpdateIds,
    ...(input.deletedSubtree === undefined ? {} : { deletedSubtree: input.deletedSubtree }),
    recoverableSubtree: input.recoverableSubtree,
    recoverablePlacement: {
      parentBlockId: input.parentBlockId,
      beforeBlockId: input.beforeBlockId,
    },
    ...(input.propertyKey === undefined ? {} : { propertyKey: input.propertyKey }),
  };
}

function activeCommand(input: {
  readonly branch: LegacyOfflineBranch;
  readonly transactionId: Uuid;
  readonly command: LegacySemanticCommand;
  readonly proofBefore: BlockDocumentV3;
  readonly proofAfter: BlockDocumentV3;
  readonly active: BlockDocumentV3;
}): { readonly command?: PageCommand; readonly ambiguity?: PageAmbiguity } {
  const proofBefore = indexDocument(input.proofBefore);
  const proofAfter = indexDocument(input.proofAfter);
  const active = indexDocument(input.active);
  const command = input.command;
  const recoverable = proofAfter.get(commandBlockId(command))?.block;
  const ambiguity = (
    kind: PageAmbiguityKind,
    blockId: Uuid,
    deletedSubtree?: CanonicalBlockV3,
    propertyKey?: string,
  ) => {
    const changed = recoverable ?? proofBefore.get(blockId)?.block;
    if (changed === undefined) {
      throw new LegacyOfflineBranchError(`legacy ambiguity ${blockId} has no recoverable block`);
    }
    const placement = proofAfter.get(blockId) ?? proofBefore.get(blockId);
    return legacyAmbiguity({
      branch: input.branch,
      transactionId: input.transactionId,
      kind,
      blockId,
      ...(deletedSubtree === undefined ? {} : { deletedSubtree }),
      recoverableSubtree: changed,
      parentBlockId: placement?.parentBlockId ?? null,
      beforeBlockId: placement?.beforeBlockId ?? null,
      ...(propertyKey === undefined ? {} : { propertyKey }),
    });
  };

  switch (command.type) {
    case "insert-block": {
      const existing = active.get(command.block.id)?.block;
      if (existing === undefined) return { command };
      if (sameBlock(existing, command.block)) return {};
      return { ambiguity: ambiguity("schema", command.block.id) };
    }
    case "move-block": {
      if (active.get(command.blockId)?.block === undefined) {
        return { ambiguity: ambiguity("delete-move", command.blockId) };
      }
      return {
        command: {
          ...command,
          beforeBlockId:
            command.beforeBlockId !== null && active.has(command.beforeBlockId)
              ? command.beforeBlockId
              : null,
        },
      };
    }
    case "delete-block": {
      const current = active.get(command.blockId);
      if (current?.block === undefined) return {};
      const before = proofBefore.get(command.blockId);
      if (before?.block === undefined) {
        return { ambiguity: ambiguity("schema", command.blockId) };
      }
      if (!sameBlock(current.block, before.block)) {
        return { ambiguity: ambiguity("delete-edit", command.blockId, before.block) };
      }
      if (
        current.parentBlockId !== before.parentBlockId ||
        current.beforeBlockId !== before.beforeBlockId
      ) {
        return { ambiguity: ambiguity("delete-move", command.blockId, before.block) };
      }
      return { command };
    }
    case "replace-text": {
      const current = active.get(command.blockId);
      const before = proofBefore.get(command.blockId);
      if (current?.text === undefined || before?.text === undefined) {
        return { ambiguity: ambiguity("delete-edit", command.blockId, before?.block) };
      }
      const gap = locateContextGap(current.text, command);
      if (gap === undefined) return { ambiguity: ambiguity("schema", command.blockId) };
      const removed = before.text.slice(command.baseFrom, command.baseTo);
      const currentGap = current.text.slice(gap.beforeEnd, gap.afterStart);
      if (command.baseFrom === command.baseTo) {
        return {
          command: {
            type: "replace-text",
            blockId: command.blockId,
            from: gap.afterStart,
            to: gap.afterStart,
            text: command.text,
          },
        };
      }
      if (currentGap === command.text) return {};
      if (currentGap !== removed) return { ambiguity: ambiguity("schema", command.blockId) };
      return {
        command: {
          type: "replace-text",
          blockId: command.blockId,
          from: gap.beforeEnd,
          to: gap.afterStart,
          text: command.text,
        },
      };
    }
    case "set-mark": {
      const current = active.get(command.blockId);
      const before = proofBefore.get(command.blockId);
      if (current?.text === undefined || before?.text === undefined) {
        return { ambiguity: ambiguity("delete-edit", command.blockId, before?.block) };
      }
      if (current.text !== before.text) return { ambiguity: ambiguity("schema", command.blockId) };
      return {
        command: {
          type: "set-mark",
          blockId: command.blockId,
          from: command.baseFrom,
          to: command.baseTo,
          mark: command.mark,
          enabled: command.enabled,
        },
      };
    }
    case "set-type-or-property": {
      const current = active.get(command.blockId)?.block;
      const beforeBlock = proofBefore.get(command.blockId)?.block;
      if (current === undefined || beforeBlock === undefined) {
        return { ambiguity: ambiguity("delete-edit", command.blockId, beforeBlock) };
      }
      const currentValue = blockProperty(current, command.key) ?? null;
      if (valuesEqual(currentValue, command.after)) {
        if (
          command.key !== "type" ||
          command.properties === undefined ||
          Object.entries(command.properties).every(([key, value]) =>
            valuesEqual(blockProperty(current, key), value),
          )
        ) {
          return {};
        }
        return { ambiguity: ambiguity("type-transform", command.blockId) };
      }
      if (!valuesEqual(currentValue, command.before)) {
        return {
          ambiguity: ambiguity(
            command.key === "type" ? "type-transform" : "property-transform",
            command.blockId,
            undefined,
            command.key === "type" ? undefined : command.key,
          ),
        };
      }
      return { command: proofCommand(command, input.proofBefore) };
    }
    case "insert-table-row": {
      const currentTable = tableFromIndex(active, command.tableId);
      const beforeTable = tableFromIndex(proofBefore, command.tableId);
      if (currentTable === undefined || beforeTable === undefined) {
        return { ambiguity: ambiguity("delete-edit", command.tableId, beforeTable) };
      }
      const existing = currentTable.rows.find(({ id }) => id === command.row.id);
      if (existing !== undefined) {
        return sameJson(existing, command.row)
          ? {}
          : { ambiguity: ambiguity("schema", command.tableId) };
      }
      if (
        !sameJson(
          currentTable.columns.map(({ id }) => id),
          beforeTable.columns.map(({ id }) => id),
        )
      ) {
        return { ambiguity: ambiguity("schema", command.tableId) };
      }
      return {
        command: {
          ...command,
          beforeRowId:
            command.beforeRowId !== null &&
            currentTable.rows.some(({ id }) => id === command.beforeRowId)
              ? command.beforeRowId
              : null,
        },
      };
    }
    case "delete-table-row": {
      const currentTable = tableFromIndex(active, command.tableId);
      if (currentTable === undefined) {
        return {
          ambiguity: ambiguity(
            "delete-edit",
            command.tableId,
            tableFromIndex(proofBefore, command.tableId),
          ),
        };
      }
      const currentRow = currentTable.rows.find(({ id }) => id === command.rowId);
      if (currentRow === undefined) return {};
      const beforeTable = tableFromIndex(proofBefore, command.tableId);
      const beforeRow = beforeTable?.rows.find(({ id }) => id === command.rowId);
      if (beforeRow === undefined) {
        return { ambiguity: ambiguity("schema", command.tableId) };
      }
      if (!sameJson(currentRow, beforeRow)) {
        return { ambiguity: ambiguity("delete-edit", command.tableId, beforeTable) };
      }
      return { command };
    }
    case "insert-table-column": {
      const currentTable = tableFromIndex(active, command.tableId);
      const beforeTable = tableFromIndex(proofBefore, command.tableId);
      if (currentTable === undefined || beforeTable === undefined) {
        return { ambiguity: ambiguity("delete-edit", command.tableId, beforeTable) };
      }
      const existingIndex = currentTable.columns.findIndex(({ id }) => id === command.column.id);
      if (existingIndex >= 0) {
        const existingColumn = currentTable.columns[existingIndex];
        const existingCells = tableColumnCells(currentTable, command.column.id);
        const expectedCells = command.cells.map(({ cell }) => cell);
        return existingColumn !== undefined &&
          existingCells !== undefined &&
          sameJson(existingColumn, command.column) &&
          sameJson(existingCells, expectedCells)
          ? {}
          : { ambiguity: ambiguity("schema", command.tableId) };
      }
      if (
        !sameJson(
          currentTable.rows.map(({ id }) => id),
          beforeTable.rows.map(({ id }) => id),
        ) ||
        !sameJson(
          command.cells.map(({ rowId }) => rowId),
          beforeTable.rows.map(({ id }) => id),
        )
      ) {
        return { ambiguity: ambiguity("schema", command.tableId) };
      }
      return {
        command: {
          ...command,
          beforeColumnId:
            command.beforeColumnId !== null &&
            currentTable.columns.some(({ id }) => id === command.beforeColumnId)
              ? command.beforeColumnId
              : null,
        },
      };
    }
    case "delete-table-column": {
      const currentTable = tableFromIndex(active, command.tableId);
      if (currentTable === undefined) {
        return {
          ambiguity: ambiguity(
            "delete-edit",
            command.tableId,
            tableFromIndex(proofBefore, command.tableId),
          ),
        };
      }
      const currentColumn = currentTable.columns.find(({ id }) => id === command.columnId);
      if (currentColumn === undefined) return {};
      const beforeTable = tableFromIndex(proofBefore, command.tableId);
      const beforeColumn = beforeTable?.columns.find(({ id }) => id === command.columnId);
      const currentCells = tableColumnCells(currentTable, command.columnId);
      const beforeCells =
        beforeTable === undefined ? undefined : tableColumnCells(beforeTable, command.columnId);
      if (
        beforeTable === undefined ||
        beforeColumn === undefined ||
        currentCells === undefined ||
        beforeCells === undefined
      ) {
        return { ambiguity: ambiguity("schema", command.tableId) };
      }
      if (
        !sameJson(currentColumn, beforeColumn) ||
        !sameJson(currentCells, beforeCells) ||
        !sameJson(
          currentTable.rows.map(({ id }) => id),
          beforeTable.rows.map(({ id }) => id),
        )
      ) {
        return { ambiguity: ambiguity("delete-edit", command.tableId, beforeTable) };
      }
      return { command };
    }
  }
}

export async function convertLegacyOfflineBranch(input: {
  readonly branch: LegacyOfflineBranch;
  readonly activePage: OperationalPageDocument;
}): Promise<LegacyBranchConversionResult> {
  await verifyLegacyOfflineBranch(input.branch);
  if (input.activePage.pageId !== input.branch.pageId) {
    throw new LegacyOfflineBranchError("legacy branch page does not match the active page");
  }
  const proofPage = OperationalPageDocument.create({
    pageId: input.branch.pageId,
    document: input.branch.baseDocument,
  });
  const activeStart = (await input.activePage.project()).document;
  const workingPage = OperationalPageDocument.create({
    pageId: input.branch.pageId,
    document: activeStart,
  });
  const commands: PageCommand[] = [];
  const ambiguities = new Map<string, PageAmbiguity>();

  for (const transaction of input.branch.semanticTransactions) {
    for (const legacyCommand of transaction.commands) {
      const proofBefore = (await proofPage.project()).document;
      proofPage.transact([proofCommand(legacyCommand, proofBefore)]);
      const proofAfter = (await proofPage.project()).document;
      const active = (await workingPage.project()).document;
      const translated = activeCommand({
        branch: input.branch,
        transactionId: transaction.transactionId,
        command: legacyCommand,
        proofBefore,
        proofAfter,
        active,
      });
      if (translated.ambiguity !== undefined) {
        ambiguities.set(translated.ambiguity.logicalKey, translated.ambiguity);
      }
      if (translated.command !== undefined) {
        try {
          workingPage.transact([translated.command]);
          commands.push(translated.command);
        } catch (error) {
          throw new LegacyOfflineBranchError(
            `legacy command cannot be translated safely: ${error instanceof Error ? error.message : "unknown failure"}`,
          );
        }
      }
    }
  }

  const proof = await proofPage.project();
  if (
    proof.canonicalDigest !== input.branch.localDocumentDigest ||
    canonicalDocumentJsonV3(proof.document) !== canonicalDocumentJsonV3(input.branch.localDocument)
  ) {
    throw new LegacyOfflineBranchError("legacy proof changed during conversion");
  }
  const transaction = commands.length === 0 ? undefined : input.activePage.transact(commands);
  return {
    convertedBranchId: input.branch.branchId,
    localDocumentDigest: input.branch.localDocumentDigest,
    commands,
    transaction,
    ambiguities: [...ambiguities.values()],
  };
}
