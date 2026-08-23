/** Causal command generation for exact visible-history restoration (T146, US5). */

import {
  type BlockDocumentV3,
  type CanonicalBlockV3,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { commandsForPageRestore } from "../src/page-state/page-history-service.ts";

function document(blocks: readonly CanonicalBlockV3[]): BlockDocumentV3 {
  return { blocks };
}

function paragraph(id: Uuid, text: string): CanonicalBlockV3 {
  return { type: "paragraph", id, content: [{ text }] };
}

describe("visible-history causal restore commands", () => {
  it("restores text, marks, properties, schema payloads, placement and deletion", () => {
    const unchangedId = generateUuidV7();
    const headingId = generateUuidV7();
    const codeId = generateUuidV7();
    const emptyId = generateUuidV7();
    const movedId = generateUuidV7();
    const insertedId = generateUuidV7();
    const dividerId = generateUuidV7();
    const tableId = generateUuidV7();
    const deletedId = generateUuidV7();
    const deletedParentId = generateUuidV7();
    const deletedChildId = generateUuidV7();
    const retainedParentId = generateUuidV7();
    const removedNestedId = generateUuidV7();
    const columnId = generateUuidV7();
    const rowId = generateUuidV7();
    const cellId = generateUuidV7();

    const current = document([
      paragraph(unchangedId, "same"),
      {
        type: "paragraph",
        id: headingId,
        content: [{ text: "old", marks: [{ type: "bold" }] }],
        rawExtraProperties: { future: "old" },
      },
      { type: "code", id: codeId, text: "const old = 1", language: null },
      paragraph(emptyId, "erase me"),
      paragraph(movedId, "move me"),
      { type: "divider", id: dividerId },
      { type: "table", id: tableId, columns: [], rows: [] },
      paragraph(deletedId, "delete me"),
      {
        type: "toggle",
        id: deletedParentId,
        content: [{ text: "deleted subtree" }],
        children: [paragraph(deletedChildId, "child")],
      },
      {
        type: "toggle",
        id: retainedParentId,
        content: [{ text: "retained parent" }],
        children: [paragraph(removedNestedId, "removed child")],
      },
    ]);
    const target = document([
      paragraph(movedId, "move me"),
      paragraph(unchangedId, "same"),
      {
        type: "heading",
        id: headingId,
        level: 2,
        content: [{ text: "new", marks: [{ type: "italic" }] }],
        rawExtraProperties: { future: "new" },
      },
      { type: "code", id: codeId, text: "const next = 2", language: "typescript" },
      paragraph(emptyId, ""),
      paragraph(insertedId, "insert me"),
      paragraph(dividerId, "divider became text"),
      {
        type: "table",
        id: tableId,
        columns: [{ id: columnId, width: null }],
        rows: [{ id: rowId, cells: [{ id: cellId, content: [{ text: "cell" }] }] }],
      },
      {
        type: "toggle",
        id: retainedParentId,
        content: [{ text: "retained parent" }],
        children: [],
      },
    ]);

    const commands = commandsForPageRestore(current, target);

    expect(commands).toContainEqual(
      expect.objectContaining({ type: "set-block-type", blockId: headingId, blockType: "heading" }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "set-block-property", blockId: headingId, key: "future" }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "replace-text", blockId: headingId, text: "new" }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "set-mark", blockId: headingId, enabled: false }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "set-mark", blockId: headingId, enabled: true }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "replace-text", blockId: codeId, text: "const next = 2" }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({
        type: "insert-block",
        block: expect.objectContaining({ id: insertedId }),
      }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "move-block", blockId: movedId }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "delete-block", blockId: dividerId }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({
        type: "insert-block",
        block: expect.objectContaining({ id: tableId }),
      }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "delete-block", blockId: deletedId }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "delete-block", blockId: deletedParentId }),
    );
    expect(commands).not.toContainEqual(
      expect.objectContaining({ type: "delete-block", blockId: deletedChildId }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "delete-block", blockId: removedNestedId }),
    );
  });

  it("uses delete and insert when a property must disappear", () => {
    const blockId = generateUuidV7();
    const current = document([
      {
        type: "paragraph",
        id: blockId,
        content: [{ text: "same" }],
        rawExtraProperties: { obsolete: true },
      },
    ]);
    const target = document([paragraph(blockId, "same")]);

    expect(commandsForPageRestore(current, target)).toEqual([
      { type: "delete-block", blockId },
      {
        type: "insert-block",
        block: paragraph(blockId, "same"),
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
  });

  it("requires an explicit decision for a nested schema-changing replacement", () => {
    const blockId = generateUuidV7();
    const childId = generateUuidV7();
    const current = document([
      {
        type: "toggle",
        id: blockId,
        content: [{ text: "parent" }],
        children: [paragraph(childId, "child")],
      },
    ]);
    const target = document([
      {
        type: "image",
        id: blockId,
        fileItemId: generateUuidV7(),
        caption: null,
        altText: null,
        displayWidth: null,
      },
    ]);

    expect(() => commandsForPageRestore(current, target)).toThrow(
      "nested schema-changing restore requires an explicit decision",
    );
  });
});
