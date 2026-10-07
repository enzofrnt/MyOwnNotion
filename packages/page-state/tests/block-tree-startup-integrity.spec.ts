import { type BlockDocumentV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  findOperationalNode,
  getOperationalBlockTree,
  initialiseOperationalBlockTree,
  insertOperationalBlock,
  materialiseOperationalDocument,
  moveOperationalBlock,
  moveOperationalTableColumn,
  moveOperationalTableRow,
  operationalBlockPlacement,
  operationalBlockProperty,
  operationalBlockSnapshot,
  operationalBlockState,
  operationalCanonicalBlockId,
  setOperationalBlockProperty,
  setOperationalTableColumnWidth,
} from "../src/block-tree.ts";
import { configureRichText } from "../src/rich-text.ts";

function fixture() {
  const tableId = generateUuidV7();
  const columnId = generateUuidV7();
  const rowId = generateUuidV7();
  const cellId = generateUuidV7();
  const paragraphId = generateUuidV7();
  const childId = generateUuidV7();
  const document: BlockDocumentV3 = {
    blocks: [
      {
        type: "toggle",
        id: paragraphId,
        content: [{ text: "parent" }],
        children: [{ type: "toggle", id: childId, content: [{ text: "child" }] }],
      },
      {
        type: "table",
        id: tableId,
        columns: [{ id: columnId, width: null }],
        rows: [{ id: rowId, cells: [{ id: cellId, content: [{ text: "cached cell" }] }] }],
      },
    ],
  };
  const doc = new LoroDoc();
  configureRichText(doc);
  initialiseOperationalBlockTree(doc, document);
  return { doc, document, tableId, columnId, rowId, cellId, paragraphId, childId };
}

function header(
  node: { data: { set(key: string, value: unknown): void } },
  id: Uuid,
  type: string,
) {
  node.data.set("blockId", id);
  node.data.set("type", type);
  node.data.set("schemaVersion", 1);
}

describe("cached operational tree integrity before resuming edits", () => {
  it("refuses table edits targeting another subtree without changing its cells", () => {
    const f = fixture();
    expect(() => moveOperationalTableRow(f.doc, f.tableId, f.childId, null)).toThrow(
      /not in table/u,
    );
    expect(() => moveOperationalTableColumn(f.doc, f.tableId, generateUuidV7(), null)).toThrow(
      /not in table/u,
    );
    expect(() => setOperationalTableColumnWidth(f.doc, f.tableId, generateUuidV7(), 120)).toThrow(
      /not in table/u,
    );
    expect(materialiseOperationalDocument(f.doc)).toEqual(f.document);
  });

  it("refuses inserting children into table rows or terminal blocks", () => {
    const f = fixture();
    expect(() =>
      insertOperationalBlock(
        f.doc,
        { type: "paragraph", id: generateUuidV7(), content: [] },
        f.rowId,
        null,
      ),
    ).toThrow(/cannot contain/u);
    expect(() =>
      insertOperationalBlock(
        f.doc,
        { type: "paragraph", id: generateUuidV7(), content: [] },
        f.tableId,
        null,
      ),
    ).toThrow(/cannot contain/u);
    expect(() => moveOperationalBlock(f.doc, f.cellId, null, null)).toThrow(/internal/u);
    expect(materialiseOperationalDocument(f.doc)).toEqual(f.document);
  });

  it("refuses a stored table whose row lost a cell", () => {
    const f = fixture();
    const tree = getOperationalBlockTree(f.doc);
    tree.delete(findOperationalNode(tree, f.cellId).id);
    expect(() => operationalBlockSnapshot(f.doc, f.tableId)).toThrow(/0 cells for 1 columns/u);
  });

  it.each([
    ["rawUnknown", [], /JSON object/u],
    ["declaredType", 7, /invalid metadata/u],
    ["syntheticId", "true", /invalid metadata/u],
  ] as const)(
    "rejects corrupt opaque block %s while restoring the projection",
    (key, value, error) => {
      const doc = new LoroDoc();
      configureRichText(doc);
      const tree = getOperationalBlockTree(doc);
      const node = tree.createNode();
      header(node, generateUuidV7(), "unknown");
      node.data.set("rawUnknown", { type: "future" });
      node.data.set("declaredType", "future");
      node.data.set("syntheticId", true);
      node.data.set(key, value);
      expect(() => materialiseOperationalDocument(doc)).toThrow(error);
    },
  );

  it("resolves a table cell or row to the same canonical history owner and placement", () => {
    const f = fixture();
    const owner = {
      block: f.document.blocks[1],
      placement: { parentBlockId: null, beforeBlockId: null },
    };
    for (const id of [f.tableId, f.rowId, f.cellId]) {
      expect(operationalCanonicalBlockId(f.doc, id)).toBe(f.tableId);
      expect(operationalBlockState(f.doc, id)).toEqual(owner);
      expect(operationalBlockSnapshot(f.doc, id)).toEqual(f.document.blocks[1]);
    }
    expect(operationalBlockPlacement(f.doc, f.paragraphId)).toEqual({
      parentBlockId: null,
      beforeBlockId: f.tableId,
    });
    expect(operationalBlockPlacement(f.doc, f.childId)).toEqual({
      parentBlockId: f.paragraphId,
      beforeBlockId: null,
    });
    expect(operationalCanonicalBlockId(f.doc, generateUuidV7())).toBeNull();
    expect(operationalBlockState(f.doc, generateUuidV7())).toBeNull();
  });

  it("refuses duplicated canonical owners before capturing history", () => {
    const f = fixture();
    header(getOperationalBlockTree(f.doc).createNode(), f.cellId, "paragraph");
    expect(() => operationalCanonicalBlockId(f.doc, f.cellId)).toThrow(/duplicated/u);
    expect(() => operationalBlockState(f.doc, f.cellId)).toThrow(/duplicated/u);
  });

  it.each(["tableRow", "tableCell"])(
    "refuses an orphan %s instead of assigning a fake history owner",
    (type) => {
      const f = fixture();
      const id = generateUuidV7();
      header(getOperationalBlockTree(f.doc).createNode(), id, type);
      expect(() => operationalCanonicalBlockId(f.doc, id)).toThrow(/no canonical ancestor/u);
      expect(() => operationalBlockState(f.doc, id)).toThrow(/no canonical ancestor/u);
      expect(() => operationalBlockSnapshot(f.doc, id)).toThrow(/no canonical ancestor/u);
      expect(() => operationalBlockProperty(f.doc, id, "caption")).toThrow(/cannot be read/u);
      expect(() => setOperationalBlockProperty(f.doc, id, "caption", "changed")).toThrow(
        /cannot be set/u,
      );
    },
  );

  it.each(["id", "content", "children", "columns"])(
    "refuses %s as a property without changing cached content",
    (key) => {
      const f = fixture();
      expect(() => operationalBlockProperty(f.doc, f.paragraphId, key)).toThrow(/structural/u);
      expect(() => setOperationalBlockProperty(f.doc, f.paragraphId, key, "changed")).toThrow(
        /structural/u,
      );
      expect(materialiseOperationalDocument(f.doc)).toEqual(f.document);
    },
  );

  it("keeps unknown blocks opaque and refuses property mutation", () => {
    const doc = new LoroDoc();
    configureRichText(doc);
    const id = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [
        {
          type: "unknown",
          id,
          declaredType: "future",
          syntheticId: true,
          raw: { type: "future", metadata: { nested: [1, true, null] } },
        },
      ],
    };
    initialiseOperationalBlockTree(doc, document);
    expect(materialiseOperationalDocument(doc)).toEqual(document);
    expect(() => operationalBlockProperty(doc, id, "metadata")).toThrow(/cannot be read/u);
    expect(() => setOperationalBlockProperty(doc, id, "metadata", {})).toThrow(/cannot be set/u);
  });

  it("refuses a second bootstrap and cross-parent placements without altering the projection", () => {
    const f = fixture();
    expect(() => initialiseOperationalBlockTree(f.doc, f.document)).toThrow(/already initialised/u);
    expect(() =>
      insertOperationalBlock(
        f.doc,
        { type: "paragraph", id: generateUuidV7(), content: [] },
        null,
        f.childId,
      ),
    ).toThrow(/requested parent/u);
    expect(() => moveOperationalBlock(f.doc, f.paragraphId, null, f.paragraphId)).toThrow(
      /before itself/u,
    );
    expect(() => moveOperationalBlock(f.doc, f.paragraphId, f.childId, null)).toThrow(/cycle/u);
    expect(materialiseOperationalDocument(f.doc)).toEqual(f.document);
  });

  it("rejects malformed stored columns rather than resuming an invalid table", () => {
    const f = fixture();
    const table = findOperationalNode(getOperationalBlockTree(f.doc), f.tableId);
    table.data.delete("tableColumns");
    table.data.ensureMergeableMap("props").set("columns", { invalid: true });
    expect(() => operationalBlockSnapshot(f.doc, f.tableId)).toThrow(/columns must be an array/u);
  });

  it("rejects invalid known properties before an operational document can be published", () => {
    const f = fixture();
    setOperationalBlockProperty(f.doc, f.paragraphId, "metadata", [true, { nested: "retained" }]);
    expect(operationalBlockProperty(f.doc, f.paragraphId, "metadata")).toEqual([
      true,
      { nested: "retained" },
    ]);
    const node = findOperationalNode(getOperationalBlockTree(f.doc), f.paragraphId);
    node.data.set("type", "heading");
    node.data.ensureMergeableMap("props").set("level", 9);
    expect(() => materialiseOperationalDocument(f.doc)).toThrow(/projection is invalid/u);
  });
});
