import type { CanonicalBlockV3, JsonObject, JsonValue, Uuid } from "@myownnotion/domain";
import { BLOCK_FIELD_ORDER_V3, canonicalDocumentJsonV3 } from "@myownnotion/domain";
import type { TransformableBlockType } from "./block-tree.ts";
import type {
  OperationalPageDocument,
  PageCommand,
  PageImportResult,
  PageSemanticChange,
  PageTransactionResult,
} from "./document.ts";

interface UndoEntry {
  readonly forward: readonly PageCommand[];
  readonly inverse: readonly PageCommand[];
  readonly beforeGuards: readonly HistoryGuard[];
  readonly afterGuards: readonly HistoryGuard[];
}

interface HistoryGuard {
  readonly blockId: Uuid;
  /** `null` means the block must be absent; `undefined` means content is unrelated. */
  readonly content: string | null | undefined;
  /** `null` means the block must be absent; `undefined` means placement is unrelated. */
  readonly placement:
    | {
        readonly parentBlockId: Uuid | null;
        readonly beforeBlockId: Uuid | null;
      }
    | null
    | undefined;
}

export class PageUndoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageUndoError";
  }
}

function propertiesFor(block: CanonicalBlockV3): JsonObject | undefined {
  switch (block.type) {
    case "heading":
      return { level: block.level };
    case "checkbox":
      return { checked: block.checked };
    case "code":
      return { language: block.language };
    case "callout":
      return { icon: block.icon, tone: block.tone };
    default:
      return undefined;
  }
}

function blockProperty(block: CanonicalBlockV3, key: string): JsonValue | undefined {
  if (block.type === "unknown") return undefined;
  if (BLOCK_FIELD_ORDER_V3[block.type].includes(key)) {
    return (block as unknown as Readonly<Record<string, JsonValue | undefined>>)[key];
  }
  return block.rawExtraProperties?.[key];
}

function assertCommandsAreInvertible(
  document: OperationalPageDocument,
  commands: readonly PageCommand[],
): void {
  for (const command of commands) {
    if (command.type !== "set-block-property") continue;
    const state = document.blockState(command.blockId);
    const before = state === null ? undefined : blockProperty(state.block, command.key);
    if (before === undefined) {
      throw new PageUndoError(`property ${command.key} did not exist before this transaction`);
    }
  }
}

function semanticChange<T extends PageSemanticChange["type"]>(
  change: PageSemanticChange | undefined,
  type: T,
): Extract<PageSemanticChange, { readonly type: T }> {
  if (change?.type !== type) {
    throw new PageUndoError(`history expected ${type}, received ${change?.type ?? "nothing"}`);
  }
  return change as Extract<PageSemanticChange, { readonly type: T }>;
}

function inverseFor(command: PageCommand, change: PageSemanticChange | undefined): PageCommand {
  switch (command.type) {
    case "insert-block": {
      semanticChange(change, "block-inserted");
      return { type: "delete-block", blockId: command.block.id };
    }
    case "move-block": {
      const moved = semanticChange(change, "block-moved");
      return {
        type: "move-block",
        blockId: command.blockId,
        parentBlockId: moved.placementBefore.parentBlockId,
        beforeBlockId: moved.placementBefore.beforeBlockId,
      };
    }
    case "delete-block": {
      const deleted = semanticChange(change, "block-deleted");
      return {
        type: "insert-block",
        block: deleted.blockBefore,
        parentBlockId: deleted.placementBefore.parentBlockId,
        beforeBlockId: deleted.placementBefore.beforeBlockId,
      };
    }
    case "replace-text": {
      const replaced = semanticChange(change, "text-replaced");
      return {
        type: "replace-text",
        blockId: command.blockId,
        from: command.from,
        to: command.from + command.text.length,
        text: replaced.removedText,
      };
    }
    case "set-mark": {
      semanticChange(change, "mark-set");
      return { ...command, enabled: !command.enabled };
    }
    case "set-block-property": {
      const before = semanticChange(change, "block-property-set").before;
      if (before === undefined) {
        throw new PageUndoError(`property ${command.key} did not exist before this transaction`);
      }
      return { ...command, value: before };
    }
    case "set-block-type": {
      // The forward command only accepts transformable kinds, so the previous
      // type is transformable too; media and opaque blocks can never appear
      // here and are not special-cased.
      const before = semanticChange(change, "block-type-set").blockBefore;
      const blockType = before.type as TransformableBlockType;
      const properties = propertiesFor(before);
      return properties === undefined
        ? { type: "set-block-type", blockId: command.blockId, blockType }
        : { type: "set-block-type", blockId: command.blockId, blockType, properties };
    }
    case "insert-table-row": {
      semanticChange(change, "table-row-inserted");
      return { type: "delete-table-row", tableId: command.tableId, rowId: command.row.id };
    }
    case "delete-table-row": {
      const deleted = semanticChange(change, "table-row-deleted");
      return {
        type: "insert-table-row",
        tableId: command.tableId,
        row: deleted.row,
        beforeRowId: deleted.beforeRowId,
      };
    }
    case "insert-table-column": {
      semanticChange(change, "table-column-inserted");
      return {
        type: "delete-table-column",
        tableId: command.tableId,
        columnId: command.column.id,
      };
    }
    case "delete-table-column": {
      const deleted = semanticChange(change, "table-column-deleted");
      return {
        type: "insert-table-column",
        tableId: command.tableId,
        column: deleted.column,
        cells: deleted.cells,
        beforeColumnId: deleted.beforeColumnId,
      };
    }
  }
}

function buildInverse(
  commands: readonly PageCommand[],
  changes: readonly PageSemanticChange[],
): PageCommand[] {
  if (commands.length !== changes.length) {
    throw new PageUndoError("history did not receive one semantic change per command");
  }
  return commands.map((command, index) => inverseFor(command, changes[index])).reverse();
}

function commandBlockId(command: PageCommand): Uuid {
  if (command.type === "insert-block") return command.block.id;
  if (
    command.type === "insert-table-row" ||
    command.type === "delete-table-row" ||
    command.type === "insert-table-column" ||
    command.type === "delete-table-column"
  ) {
    return command.tableId;
  }
  return command.blockId;
}

function historyGuards(
  document: OperationalPageDocument,
  commands: readonly PageCommand[],
): HistoryGuard[] {
  const requirements = new Map<Uuid, { content: boolean; placement: boolean }>();
  for (const command of commands) {
    const blockId = commandBlockId(command);
    const requirement = requirements.get(blockId) ?? { content: false, placement: false };
    switch (command.type) {
      case "move-block":
        requirement.placement = true;
        break;
      case "insert-block":
      case "delete-block":
        requirement.content = true;
        requirement.placement = true;
        break;
      case "replace-text":
      case "set-mark":
      case "set-block-property":
      case "set-block-type":
      case "insert-table-row":
      case "delete-table-row":
      case "insert-table-column":
      case "delete-table-column":
        requirement.content = true;
        break;
    }
    requirements.set(blockId, requirement);
  }

  return [...requirements.entries()].map(([blockId, requirement]) => {
    const current = document.blockState(blockId);
    return {
      blockId,
      content: requirement.content
        ? current === null
          ? null
          : canonicalDocumentJsonV3({ blocks: [current.block] })
        : undefined,
      placement: requirement.placement ? (current === null ? null : current.placement) : undefined,
    };
  });
}

function placementsEqual(
  left: Exclude<HistoryGuard["placement"], null | undefined>,
  right: Exclude<HistoryGuard["placement"], null | undefined>,
): boolean {
  return left.parentBlockId === right.parentBlockId && left.beforeBlockId === right.beforeBlockId;
}

function assertHistoryGuards(
  document: OperationalPageDocument,
  guards: readonly HistoryGuard[],
  action: "undo" | "redo",
): void {
  for (const guard of guards) {
    const current = document.blockState(guard.blockId);
    if (guard.content !== undefined) {
      const currentContent =
        current === null ? null : canonicalDocumentJsonV3({ blocks: [current.block] });
      if (currentContent !== guard.content) {
        throw new PageUndoError(
          `${action} target ${guard.blockId} changed after the local transaction`,
        );
      }
    }
    if (guard.placement !== undefined) {
      const currentPlacement = current === null ? null : current.placement;
      const placementMatches =
        currentPlacement === null || guard.placement === null
          ? currentPlacement === guard.placement
          : placementsEqual(currentPlacement, guard.placement);
      if (!placementMatches) {
        throw new PageUndoError(
          `${action} target ${guard.blockId} moved after the local transaction`,
        );
      }
    }
  }
}

/** Local transaction history that never places imported updates on the undo stack. */
export class PageUndoManager {
  readonly #document: OperationalPageDocument;
  readonly #limit: number;
  #undo: UndoEntry[] = [];
  #redo: UndoEntry[] = [];

  constructor(document: OperationalPageDocument, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("undo limit must be positive");
    this.#document = document;
    this.#limit = limit;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  execute(commands: readonly PageCommand[]): PageTransactionResult {
    // Reject history shapes that cannot be inverted before the operational
    // document imports their update. A failed local gesture must be atomic.
    assertCommandsAreInvertible(this.#document, commands);
    const beforeGuards = historyGuards(this.#document, commands);
    const result = this.#document.transact(commands);
    if (result.changed) {
      this.#undo.push({
        forward: [...commands],
        inverse: buildInverse(commands, result.semanticChanges),
        beforeGuards,
        afterGuards: historyGuards(this.#document, commands),
      });
      if (this.#undo.length > this.#limit) this.#undo.shift();
      this.#redo = [];
    }
    return result;
  }

  undo(): PageTransactionResult | null {
    const entry = this.#undo.pop();
    if (entry === undefined) return null;
    try {
      assertHistoryGuards(this.#document, entry.afterGuards, "undo");
      const result = this.#document.transact(entry.inverse);
      this.#redo.push(entry);
      return result;
    } catch (error) {
      this.#undo.push(entry);
      throw new PageUndoError(
        error instanceof Error
          ? `undo could not be applied after newer changes: ${error.message}`
          : "undo could not be applied after newer changes",
      );
    }
  }

  redo(): PageTransactionResult | null {
    const entry = this.#redo.pop();
    if (entry === undefined) return null;
    try {
      assertHistoryGuards(this.#document, entry.beforeGuards, "redo");
      const result = this.#document.transact(entry.forward);
      this.#undo.push(entry);
      return result;
    } catch (error) {
      this.#redo.push(entry);
      throw new PageUndoError(
        error instanceof Error
          ? `redo could not be applied after newer changes: ${error.message}`
          : "redo could not be applied after newer changes",
      );
    }
  }

  importRemote(updateBytes: Uint8Array): PageImportResult {
    return this.#document.importUpdate(updateBytes);
  }
}
