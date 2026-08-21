import type {
  BlockDocumentV3,
  CanonicalBlockV3,
  JsonObject,
  JsonValue,
  MarkV3,
  TableBlockV3,
  TableCellV3,
  TableColumnV3,
  TableRowV3,
  Uuid,
} from "@myownnotion/domain";
import { collectDocumentIdsV3 } from "@myownnotion/domain";
import { LoroDoc, type Side, VersionVector } from "loro-crdt";
import {
  assertOperationalBlock,
  assertOperationalBlockTree,
  deleteOperationalBlock,
  deleteOperationalTableColumn,
  deleteOperationalTableRow,
  getOperationalBlockTree,
  initialiseOperationalBlockTree,
  insertOperationalBlock,
  insertOperationalTableColumn,
  insertOperationalTableRow,
  materialiseOperationalDocument,
  moveOperationalBlock,
  type OperationalBlockState,
  operationalBlockPlacement,
  operationalBlockProperty,
  operationalBlockSnapshot,
  operationalBlockState,
  operationalCanonicalBlockId,
  operationalTextForBlock,
  setOperationalBlockProperty,
  type TransformableBlockType,
  transformOperationalBlockType,
} from "./block-tree.ts";
import { type CanonicalProjectionResult, projectCanonicalPage } from "./canonical-projection.ts";
import {
  createOperationalCheckpoint,
  type OperationalPageCheckpoint,
  openOperationalCheckpoint,
} from "./checkpoints.ts";
import {
  configureRichText,
  createRelativeTextPosition,
  RichTextOperationError,
  replaceRichText,
  resolveRelativeTextPosition,
  setRichTextMark,
} from "./rich-text.ts";
import {
  encodeOperationalFrontiers,
  OPERATIONAL_FORMAT,
  OPERATIONAL_FORMAT_VERSION,
  versionVectorBytesEqual,
} from "./update-envelope.ts";

export const OPERATIONAL_PAGE_SCHEMA = "myownnotion.page-operations" as const;
export const OPERATIONAL_PAGE_SCHEMA_VERSION = 1 as const;

export type PageCommand =
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
      readonly from: number;
      readonly to: number;
      readonly text: string;
    }
  | {
      readonly type: "set-mark";
      readonly blockId: Uuid;
      readonly from: number;
      readonly to: number;
      readonly mark: MarkV3;
      readonly enabled: boolean;
    }
  | {
      readonly type: "set-block-property";
      readonly blockId: Uuid;
      readonly key: string;
      readonly value: JsonValue;
    }
  | {
      readonly type: "set-block-type";
      readonly blockId: Uuid;
      readonly blockType: TransformableBlockType;
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

export type PageSemanticChange =
  | {
      readonly type: "block-inserted";
      readonly blockId: Uuid;
      readonly affectedBlockIds: readonly Uuid[];
      readonly blockAfter: CanonicalBlockV3;
      readonly placementAfter: {
        readonly parentBlockId: Uuid | null;
        readonly beforeBlockId: Uuid | null;
      };
    }
  | {
      readonly type: "block-moved";
      readonly blockId: Uuid;
      readonly affectedBlockIds: readonly Uuid[];
      readonly blockAfter: CanonicalBlockV3;
      readonly placementBefore: {
        readonly parentBlockId: Uuid | null;
        readonly beforeBlockId: Uuid | null;
      };
      readonly placementAfter: {
        readonly parentBlockId: Uuid | null;
        readonly beforeBlockId: Uuid | null;
      };
    }
  | {
      readonly type: "block-deleted";
      readonly blockId: Uuid;
      readonly affectedBlockIds: readonly Uuid[];
      readonly blockBefore: CanonicalBlockV3;
      readonly placementBefore: {
        readonly parentBlockId: Uuid | null;
        readonly beforeBlockId: Uuid | null;
      };
    }
  | {
      readonly type: "text-replaced";
      readonly blockId: Uuid;
      readonly from: number;
      readonly to: number;
      readonly insertedLength: number;
      readonly removedText: string;
      readonly blockAfter: CanonicalBlockV3;
    }
  | {
      readonly type: "mark-set";
      readonly blockId: Uuid;
      readonly from: number;
      readonly to: number;
      readonly mark: MarkV3;
      readonly enabled: boolean;
      readonly blockAfter: CanonicalBlockV3;
    }
  | {
      readonly type: "block-property-set";
      readonly blockId: Uuid;
      readonly key: string;
      readonly before: JsonValue | undefined;
      readonly after: JsonValue;
      readonly blockAfter: CanonicalBlockV3;
    }
  | {
      readonly type: "block-type-set";
      readonly blockId: Uuid;
      readonly beforeType: CanonicalBlockV3["type"];
      readonly afterType: TransformableBlockType;
      readonly blockBefore: CanonicalBlockV3;
      readonly blockAfter: CanonicalBlockV3;
    }
  | {
      readonly type: "table-row-inserted";
      readonly blockId: Uuid;
      readonly affectedBlockIds: readonly Uuid[];
      readonly row: TableRowV3;
      readonly beforeRowId: Uuid | null;
      readonly blockBefore: TableBlockV3;
      readonly blockAfter: TableBlockV3;
    }
  | {
      readonly type: "table-row-deleted";
      readonly blockId: Uuid;
      readonly affectedBlockIds: readonly Uuid[];
      readonly row: TableRowV3;
      readonly beforeRowId: Uuid | null;
      readonly blockBefore: TableBlockV3;
      readonly blockAfter: TableBlockV3;
    }
  | {
      readonly type: "table-column-inserted";
      readonly blockId: Uuid;
      readonly affectedBlockIds: readonly Uuid[];
      readonly column: TableColumnV3;
      readonly cells: readonly {
        readonly rowId: Uuid;
        readonly cell: TableCellV3;
      }[];
      readonly beforeColumnId: Uuid | null;
      readonly blockBefore: TableBlockV3;
      readonly blockAfter: TableBlockV3;
    }
  | {
      readonly type: "table-column-deleted";
      readonly blockId: Uuid;
      readonly affectedBlockIds: readonly Uuid[];
      readonly column: TableColumnV3;
      readonly cells: readonly {
        readonly rowId: Uuid;
        readonly cell: TableCellV3;
      }[];
      readonly beforeColumnId: Uuid | null;
      readonly blockBefore: TableBlockV3;
      readonly blockAfter: TableBlockV3;
    }
  | {
      /** Emitted by a schema migrator, never by an ordinary editor command. */
      readonly type: "schema-changed";
      readonly blockId: Uuid;
      readonly beforeSchemaVersion: number;
      readonly afterSchemaVersion: number;
      readonly blockAfter: CanonicalBlockV3;
    };

export interface PageTransactionResult {
  readonly changed: boolean;
  readonly updateBytes: Uint8Array;
  readonly baseVersionVector: Uint8Array;
  readonly resultVersionVector: Uint8Array;
  readonly resultFrontiers: Uint8Array;
  readonly semanticChanges: readonly PageSemanticChange[];
}

export interface PageImportResult {
  readonly changed: boolean;
  readonly pending: boolean;
  readonly versionVector: Uint8Array;
}

export class PageCommandError extends Error {
  readonly commandIndex: number;
  readonly commandType: PageCommand["type"];

  constructor(
    message: string,
    commandIndex: number,
    commandType: PageCommand["type"],
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PageCommandError";
    this.commandIndex = commandIndex;
    this.commandType = commandType;
  }
}

function metadata(doc: LoroDoc) {
  return doc.getMap("documentMeta");
}

function configureOperationalDocument(doc: LoroDoc): void {
  configureRichText(doc);
  getOperationalBlockTree(doc);
}

function initialiseMetadata(doc: LoroDoc, pageId: Uuid): void {
  const map = metadata(doc);
  map.set("schema", OPERATIONAL_PAGE_SCHEMA);
  map.set("schemaVersion", OPERATIONAL_PAGE_SCHEMA_VERSION);
  map.set("pageId", pageId);
}

function assertMetadata(doc: LoroDoc, pageId: Uuid): void {
  const map = metadata(doc);
  if (
    map.get("schema") !== OPERATIONAL_PAGE_SCHEMA ||
    map.get("schemaVersion") !== OPERATIONAL_PAGE_SCHEMA_VERSION ||
    map.get("pageId") !== pageId
  ) {
    throw new TypeError("operational page metadata mismatch");
  }
}

function tableSnapshot(doc: LoroDoc, tableId: Uuid): TableBlockV3 {
  const block = operationalBlockSnapshot(doc, tableId);
  if (block.type !== "table") throw new TypeError(`${tableId} is not a table`);
  return block;
}

function tableRowIdentities(row: TableRowV3): Uuid[] {
  return [
    row.id,
    ...row.cells.flatMap((cell) => [
      cell.id,
      ...(collectDocumentIdsV3({ blocks: cell.children ?? [] }) as Uuid[]),
    ]),
  ];
}

function tableColumnIdentities(
  column: TableColumnV3,
  cells: readonly { readonly rowId: Uuid; readonly cell: TableCellV3 }[],
): Uuid[] {
  return [
    column.id,
    ...cells.flatMap(({ cell }) => [
      cell.id,
      ...(collectDocumentIdsV3({ blocks: cell.children ?? [] }) as Uuid[]),
    ]),
  ];
}

function applyCommand(doc: LoroDoc, command: PageCommand): PageSemanticChange {
  switch (command.type) {
    case "insert-block": {
      insertOperationalBlock(doc, command.block, command.parentBlockId, command.beforeBlockId);
      const blockAfter = operationalBlockSnapshot(doc, command.block.id);
      return {
        type: "block-inserted",
        blockId: command.block.id,
        affectedBlockIds: collectDocumentIdsV3({ blocks: [blockAfter] }) as Uuid[],
        blockAfter,
        placementAfter: operationalBlockPlacement(doc, command.block.id),
      };
    }
    case "move-block": {
      const placementBefore = operationalBlockPlacement(doc, command.blockId);
      moveOperationalBlock(doc, command.blockId, command.parentBlockId, command.beforeBlockId);
      const blockAfter = operationalBlockSnapshot(doc, command.blockId);
      return {
        type: "block-moved",
        blockId: command.blockId,
        affectedBlockIds: collectDocumentIdsV3({ blocks: [blockAfter] }) as Uuid[],
        blockAfter,
        placementBefore,
        placementAfter: operationalBlockPlacement(doc, command.blockId),
      };
    }
    case "delete-block": {
      const blockBefore = operationalBlockSnapshot(doc, command.blockId);
      const placementBefore = operationalBlockPlacement(doc, command.blockId);
      deleteOperationalBlock(doc, command.blockId);
      return {
        type: "block-deleted",
        blockId: command.blockId,
        affectedBlockIds: collectDocumentIdsV3({ blocks: [blockBefore] }) as Uuid[],
        blockBefore,
        placementBefore,
      };
    }
    case "replace-text": {
      const target = operationalTextForBlock(doc, command.blockId);
      const removedText = target.text.toString().slice(command.from, command.to);
      replaceRichText(
        target.text,
        command.from,
        command.to,
        command.text,
        target.allowsCodeControls,
      );
      return {
        type: "text-replaced",
        blockId: command.blockId,
        from: command.from,
        to: command.to,
        insertedLength: command.text.length,
        removedText,
        blockAfter: operationalBlockSnapshot(doc, command.blockId),
      };
    }
    case "set-mark": {
      const target = operationalTextForBlock(doc, command.blockId);
      if (!target.allowsMarks) {
        throw new RichTextOperationError(`block ${command.blockId} does not support marks`);
      }
      setRichTextMark(target.text, command.from, command.to, command.mark, command.enabled);
      return {
        type: "mark-set",
        blockId: command.blockId,
        from: command.from,
        to: command.to,
        mark: command.mark,
        enabled: command.enabled,
        blockAfter: operationalBlockSnapshot(doc, command.blockId),
      };
    }
    case "set-block-property": {
      const before = operationalBlockProperty(doc, command.blockId, command.key);
      setOperationalBlockProperty(doc, command.blockId, command.key, command.value);
      return {
        type: "block-property-set",
        blockId: command.blockId,
        key: command.key,
        before,
        after: command.value,
        blockAfter: operationalBlockSnapshot(doc, command.blockId),
      };
    }
    case "set-block-type": {
      const blockBefore = operationalBlockSnapshot(doc, command.blockId);
      transformOperationalBlockType(doc, command.blockId, command.blockType, command.properties);
      return {
        type: "block-type-set",
        blockId: command.blockId,
        beforeType: blockBefore.type,
        afterType: command.blockType,
        blockBefore,
        blockAfter: operationalBlockSnapshot(doc, command.blockId),
      };
    }
    case "insert-table-row": {
      const blockBefore = tableSnapshot(doc, command.tableId);
      insertOperationalTableRow(doc, command.tableId, command.row, command.beforeRowId);
      const blockAfter = tableSnapshot(doc, command.tableId);
      const row = blockAfter.rows.find(({ id }) => id === command.row.id);
      if (row === undefined) throw new TypeError(`inserted row ${command.row.id} is missing`);
      return {
        type: "table-row-inserted",
        blockId: command.tableId,
        affectedBlockIds: tableRowIdentities(row),
        row,
        beforeRowId: command.beforeRowId,
        blockBefore,
        blockAfter,
      };
    }
    case "delete-table-row": {
      const blockBefore = tableSnapshot(doc, command.tableId);
      const rowIndex = blockBefore.rows.findIndex(({ id }) => id === command.rowId);
      const row = blockBefore.rows[rowIndex];
      if (row === undefined)
        throw new TypeError(`row ${command.rowId} is not in ${command.tableId}`);
      const beforeRowId = blockBefore.rows[rowIndex + 1]?.id ?? null;
      deleteOperationalTableRow(doc, command.tableId, command.rowId);
      return {
        type: "table-row-deleted",
        blockId: command.tableId,
        affectedBlockIds: tableRowIdentities(row),
        row,
        beforeRowId,
        blockBefore,
        blockAfter: tableSnapshot(doc, command.tableId),
      };
    }
    case "insert-table-column": {
      const blockBefore = tableSnapshot(doc, command.tableId);
      insertOperationalTableColumn(
        doc,
        command.tableId,
        command.column,
        command.cells,
        command.beforeColumnId,
      );
      const blockAfter = tableSnapshot(doc, command.tableId);
      const columnIndex = blockAfter.columns.findIndex(({ id }) => id === command.column.id);
      const column = blockAfter.columns[columnIndex];
      if (column === undefined) {
        throw new TypeError(`inserted column ${command.column.id} is missing`);
      }
      const cells = blockAfter.rows.map((row) => {
        const cell = row.cells[columnIndex];
        if (cell === undefined) {
          throw new TypeError(`inserted column ${command.column.id} has no cell in row ${row.id}`);
        }
        return { rowId: row.id, cell };
      });
      return {
        type: "table-column-inserted",
        blockId: command.tableId,
        affectedBlockIds: tableColumnIdentities(column, cells),
        column,
        cells,
        beforeColumnId: command.beforeColumnId,
        blockBefore,
        blockAfter,
      };
    }
    case "delete-table-column": {
      const blockBefore = tableSnapshot(doc, command.tableId);
      const columnIndex = blockBefore.columns.findIndex(({ id }) => id === command.columnId);
      const column = blockBefore.columns[columnIndex];
      if (column === undefined) {
        throw new TypeError(`column ${command.columnId} is not in ${command.tableId}`);
      }
      const cells = blockBefore.rows.map((row) => {
        const cell = row.cells[columnIndex];
        if (cell === undefined) {
          throw new TypeError(`column ${command.columnId} has no cell in row ${row.id}`);
        }
        return { rowId: row.id, cell };
      });
      const beforeColumnId = blockBefore.columns[columnIndex + 1]?.id ?? null;
      deleteOperationalTableColumn(doc, command.tableId, command.columnId);
      return {
        type: "table-column-deleted",
        blockId: command.tableId,
        affectedBlockIds: tableColumnIdentities(column, cells),
        column,
        cells,
        beforeColumnId,
        blockBefore,
        blockAfter: tableSnapshot(doc, command.tableId),
      };
    }
  }
}

function cloneBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

export class OperationalPageDocument {
  readonly #pageId: Uuid;
  readonly #doc: LoroDoc;

  private constructor(pageId: Uuid, doc: LoroDoc) {
    this.#pageId = pageId;
    this.#doc = doc;
    configureOperationalDocument(this.#doc);
    assertMetadata(this.#doc, pageId);
  }

  static create(input: {
    readonly pageId: Uuid;
    readonly document: BlockDocumentV3;
  }): OperationalPageDocument {
    const doc = new LoroDoc();
    configureOperationalDocument(doc);
    initialiseMetadata(doc, input.pageId);
    initialiseOperationalBlockTree(doc, input.document);
    assertOperationalBlockTree(doc);
    doc.commit({ origin: "myownnotion.bootstrap" });
    return new OperationalPageDocument(input.pageId, doc);
  }

  static async fromCheckpoint(input: {
    readonly pageId: Uuid;
    readonly checkpoint: OperationalPageCheckpoint;
  }): Promise<OperationalPageDocument> {
    const doc = await openOperationalCheckpoint(input.pageId, input.checkpoint);
    configureOperationalDocument(doc);
    assertMetadata(doc, input.pageId);
    assertOperationalBlockTree(doc);
    return new OperationalPageDocument(input.pageId, doc);
  }

  /**
   * Opens the fields carried by the HTTP checkpoint response.
   *
   * Frontiers are intentionally not duplicated on the wire: they are derived
   * from the authenticated snapshot and then verified together with the digest
   * and version vector by the ordinary checkpoint loader.
   */
  static async fromSnapshotTransport(input: {
    readonly pageId: Uuid;
    readonly snapshotBytes: Uint8Array;
    readonly snapshotDigest: string;
    readonly versionVector: Uint8Array;
  }): Promise<OperationalPageDocument> {
    const snapshot = LoroDoc.fromSnapshot(input.snapshotBytes);
    return await OperationalPageDocument.fromCheckpoint({
      pageId: input.pageId,
      checkpoint: {
        operationalFormat: OPERATIONAL_FORMAT,
        operationalVersion: OPERATIONAL_FORMAT_VERSION,
        pageId: input.pageId,
        bytes: cloneBytes(input.snapshotBytes),
        digest: input.snapshotDigest,
        versionVector: cloneBytes(input.versionVector),
        frontiers: cloneBytes(encodeOperationalFrontiers(snapshot.frontiers())),
      },
    });
  }

  get pageId(): Uuid {
    return this.#pageId;
  }

  get peerId(): string {
    return this.#doc.peerIdStr;
  }

  versionVectorBytes(): Uint8Array {
    this.#doc.commit();
    return cloneBytes(this.#doc.oplogVersion().encode());
  }

  /** Encodes the exact frontier represented by a version this replica knows. */
  frontiersForVersionVector(versionVector: Uint8Array): Uint8Array {
    return cloneBytes(
      encodeOperationalFrontiers(this.#doc.vvToFrontiers(VersionVector.decode(versionVector))),
    );
  }

  /** Exports only operations absent from a known causal version. */
  exportUpdateFrom(versionVector: Uint8Array): Uint8Array {
    this.#doc.commit();
    return cloneBytes(
      this.#doc.export({ mode: "update", from: VersionVector.decode(versionVector) }),
    );
  }

  transact(commands: readonly PageCommand[]): PageTransactionResult {
    this.#doc.commit();
    const baseVersion = this.#doc.oplogVersion();
    const baseVersionVector = cloneBytes(baseVersion.encode());
    const working = this.#doc.fork();
    working.setPeerId(this.#doc.peerIdStr);
    configureOperationalDocument(working);
    const semanticChanges: PageSemanticChange[] = [];

    for (const [index, command] of commands.entries()) {
      try {
        semanticChanges.push(applyCommand(working, command));
      } catch (error) {
        if (error instanceof PageCommandError) throw error;
        const detail = error instanceof Error ? error.message : "unknown operational failure";
        throw new PageCommandError(
          `command ${index + 1} (${command.type}) failed: ${detail}`,
          index,
          command.type,
          error,
        );
      }
    }

    try {
      assertMetadata(working, this.#pageId);
      // Re-validating all 500 blocks after every keystroke made input latency
      // scale with document length. Structural edits retain whole-tree
      // validation because they can affect ancestry, identity uniqueness and
      // sibling placement. Other edits validate only their changed canonical
      // subtree, preserving the same schema guarantee at constant page cost.
      const hasStructuralCommand = commands.some(
        (command) =>
          command.type === "insert-block" ||
          command.type === "move-block" ||
          command.type === "delete-block" ||
          command.type === "insert-table-row" ||
          command.type === "delete-table-row" ||
          command.type === "insert-table-column" ||
          command.type === "delete-table-column",
      );
      if (hasStructuralCommand) {
        assertOperationalBlockTree(working);
      } else {
        const changedBlockIds = new Set<Uuid>();
        for (const command of commands) {
          if ("blockId" in command) changedBlockIds.add(command.blockId);
        }
        for (const blockId of changedBlockIds) assertOperationalBlock(working, blockId);
      }
      working.commit({ origin: "myownnotion.editor" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "invalid operational projection";
      const lastIndex = Math.max(0, commands.length - 1);
      const commandType = commands[lastIndex]?.type ?? "set-block-property";
      throw new PageCommandError(detail, lastIndex, commandType, error);
    }

    const resultVersionVector = cloneBytes(working.oplogVersion().encode());
    const changed = !versionVectorBytesEqual(baseVersionVector, resultVersionVector);
    const updateBytes = cloneBytes(working.export({ mode: "update", from: baseVersion }));
    if (changed) {
      const status = this.#doc.import(updateBytes);
      if (status.pending !== null) {
        throw new Error("a local transaction unexpectedly produced a causally pending update");
      }
      if (!versionVectorBytesEqual(this.#doc.oplogVersion().encode(), resultVersionVector)) {
        throw new Error("local transaction import did not reach its result version");
      }
    }
    return {
      changed,
      updateBytes,
      baseVersionVector,
      resultVersionVector,
      resultFrontiers: cloneBytes(encodeOperationalFrontiers(working.frontiers())),
      semanticChanges: changed ? semanticChanges : [],
    };
  }

  importUpdate(updateBytes: Uint8Array): PageImportResult {
    this.#doc.commit();
    const before = this.#doc.oplogVersion().encode();
    const status = this.#doc.import(updateBytes);
    assertMetadata(this.#doc, this.#pageId);
    const versionVector = cloneBytes(this.#doc.oplogVersion().encode());
    return {
      changed: !versionVectorBytesEqual(before, versionVector),
      pending: status.pending !== null && status.pending.size > 0,
      versionVector,
    };
  }

  project(): Promise<CanonicalProjectionResult> {
    return projectCanonicalPage(this.#pageId, this.#doc);
  }

  /**
   * Synchronous editor-facing projection. Digests remain the responsibility
   * of `project()`; a mounted editor needs only the validated canonical value
   * after each local gesture and must never read Loro internals directly.
   */
  snapshot(): BlockDocumentV3 {
    return materialiseOperationalDocument(this.#doc);
  }

  /** One-block state used by local history; absent blocks return `null`. */
  blockState(blockId: Uuid): OperationalBlockState | null {
    return operationalBlockState(this.#doc, blockId);
  }

  canonicalBlockIdForIdentity(blockId: Uuid): Uuid | null {
    return operationalCanonicalBlockId(this.#doc, blockId);
  }

  checkpoint(): Promise<OperationalPageCheckpoint> {
    assertMetadata(this.#doc, this.#pageId);
    assertOperationalBlockTree(this.#doc);
    return createOperationalCheckpoint(this.#pageId, this.#doc);
  }

  createRelativeTextPosition(blockId: Uuid, index: number, side: Side = 0): Uint8Array {
    return createRelativeTextPosition(
      operationalTextForBlock(this.#doc, blockId).text,
      index,
      side,
    );
  }

  resolveRelativeTextPosition(
    encodedCursor: Uint8Array,
  ): { readonly offset: number; readonly side: Side } | undefined {
    return resolveRelativeTextPosition(this.#doc, encodedCursor);
  }
}
