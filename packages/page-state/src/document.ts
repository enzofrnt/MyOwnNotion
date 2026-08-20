import type {
  BlockDocumentV3,
  CanonicalBlockV3,
  JsonObject,
  JsonValue,
  MarkV3,
  Uuid,
} from "@myownnotion/domain";
import { collectDocumentIdsV3 } from "@myownnotion/domain";
import { LoroDoc, type Side } from "loro-crdt";
import {
  assertOperationalBlockTree,
  deleteOperationalBlock,
  getOperationalBlockTree,
  initialiseOperationalBlockTree,
  insertOperationalBlock,
  moveOperationalBlock,
  operationalBlockPlacement,
  operationalBlockProperty,
  operationalBlockSnapshot,
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
import { encodeOperationalFrontiers, versionVectorBytesEqual } from "./update-envelope.ts";

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
      readonly blockAfter: CanonicalBlockV3;
    }
  | {
      readonly type: "mark-set";
      readonly blockId: Uuid;
      readonly from: number;
      readonly to: number;
      readonly markType: MarkV3["type"];
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
        markType: command.mark.type,
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
      assertOperationalBlockTree(working);
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
