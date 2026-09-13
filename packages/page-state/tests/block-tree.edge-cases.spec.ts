import { type BlockDocumentV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  configureRichText,
  deleteOperationalTableColumn,
  deleteOperationalTableRow,
  findOperationalNode,
  getOperationalBlockTree,
  initialiseOperationalBlockTree,
  insertOperationalTableColumn,
  insertOperationalTableRow,
  materialiseOperationalDocument,
  type OperationalTableColumnCell,
  operationalBlockProperty,
  operationalBlockSnapshot,
} from "../src/index.ts";

const PROPS_KEY = "props";
const CONTENT_KEY = "content";
const TABLE_COLUMNS_KEY = "tableColumns";

function paragraph(id: Uuid, text = "text") {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

function tableFixture() {
  const tableId = generateUuidV7();
  const columnId = generateUuidV7();
  const rowId = generateUuidV7();
  const cellId = generateUuidV7();
  const doc = operational({
    blocks: [
      {
        type: "table",
        id: tableId,
        columns: [{ id: columnId, width: null }],
        rows: [{ id: rowId, cells: [{ id: cellId, content: [{ text: "cell" }] }] }],
      },
    ],
  });
  const tree = getOperationalBlockTree(doc);
  const table = tree.roots()[0];
  if (table === undefined) throw new Error("table fixture is empty");
  const row = table.children()?.[0];
  const cell = row?.children()?.[0];
  if (row === undefined || cell === undefined) throw new Error("table fixture is incomplete");
  return { doc, tree, table, row, cell, tableId, columnId, rowId, cellId };
}

function operational(document: BlockDocumentV3): LoroDoc {
  const doc = new LoroDoc();
  configureRichText(doc);
  initialiseOperationalBlockTree(doc, document);
  return doc;
}

function setNodeHeader(
  node: { data: { set(key: string, value: unknown): void } },
  id: Uuid,
  type: string,
) {
  node.data.set("blockId", id);
  node.data.set("type", type);
  node.data.set("schemaVersion", 1);
}

describe("operational block tree malformed and boundary states", () => {
  it("rejects non-canonical property values instead of leaking them into projections", () => {
    const id = generateUuidV7();
    const doc = operational({ blocks: [paragraph(id)] });
    const props = findOperationalNode(getOperationalBlockTree(doc), id).data.ensureMergeableMap(
      PROPS_KEY,
    );

    props.set("extra:nan", Number.NaN);
    expect(() => operationalBlockProperty(doc, id, "nan")).toThrow(/non-finite number/u);

    props.set("extra:bytes", new Uint8Array([1, 2]));
    expect(() => operationalBlockProperty(doc, id, "bytes")).toThrow(/not canonical JSON/u);

    props.setContainer("extra:map", new LoroMap());
    expect(() => operationalBlockProperty(doc, id, "map")).toThrow(/plain JSON object/u);

    props.set("extra:array", [{ nested: [true, null, 3] }]);
    expect(operationalBlockProperty(doc, id, "array")).toEqual([{ nested: [true, null, 3] }]);
  });

  it("rejects missing, duplicated, and unsupported tree identities", () => {
    const doc = new LoroDoc();
    configureRichText(doc);
    const tree = getOperationalBlockTree(doc);
    const missing = tree.createNode();
    expect(() => findOperationalNode(tree, generateUuidV7())).toThrow(/canonical identity/u);
    tree.delete(missing.id);

    const duplicateId = generateUuidV7();
    const first = tree.createNode();
    const second = tree.createNode();
    setNodeHeader(first, duplicateId, "paragraph");
    setNodeHeader(second, duplicateId, "paragraph");
    expect(() => findOperationalNode(tree, duplicateId)).toThrow(/duplicated/u);

    const unsupportedDoc = new LoroDoc();
    configureRichText(unsupportedDoc);
    const unsupported = getOperationalBlockTree(unsupportedDoc).createNode();
    setNodeHeader(unsupported, generateUuidV7(), "futureType");
    expect(() => materialiseOperationalDocument(unsupportedDoc)).toThrow(/unsupported type/u);
    expect(missing.isDeleted()).toBe(true);
  });

  it("rejects internal nodes when they appear outside their table owner", () => {
    const doc = operational({ blocks: [paragraph(generateUuidV7())] });
    const tree = getOperationalBlockTree(doc);
    const paragraphNode = tree.roots()[0];
    if (paragraphNode === undefined) throw new Error("paragraph fixture is empty");
    const row = paragraphNode.createNode();
    setNodeHeader(row, generateUuidV7(), "tableRow");
    expect(() => materialiseOperationalDocument(doc)).toThrow(/internal tableRow/u);

    const secondDoc = operational({ blocks: [paragraph(generateUuidV7())] });
    const rootCell = getOperationalBlockTree(secondDoc).createNode();
    setNodeHeader(rootCell, generateUuidV7(), "tableCell");
    expect(() => materialiseOperationalDocument(secondDoc)).toThrow(/internal tableCell/u);
  });

  it("rejects malformed table rows and keeps column identity mapping strict", () => {
    const first = tableFixture();
    const wrongChild = first.table.createNode();
    setNodeHeader(wrongChild, generateUuidV7(), "paragraph");
    expect(() => materialiseOperationalDocument(first.doc)).toThrow(/not a tableRow/u);

    const second = tableFixture();
    const secondRow = second.row;
    second.tree.delete(second.cell.id);
    const wrongCell = secondRow.createNode();
    setNodeHeader(wrongCell, generateUuidV7(), "paragraph");
    expect(() => materialiseOperationalDocument(second.doc)).toThrow(/not a tableCell/u);

    const third = tableFixture();
    const duplicate = third.row.createNode();
    setNodeHeader(duplicate, generateUuidV7(), "tableCell");
    duplicate.data.set("columnId", third.columnId);
    expect(() => materialiseOperationalDocument(third.doc)).toThrow(/duplicates column/u);

    const fourth = tableFixture();
    fourth.cell.data.set("columnId", generateUuidV7());
    expect(() => materialiseOperationalDocument(fourth.doc)).toThrow(/no cell for column/u);
  });

  it("rejects missing required fields and structural children on leaf blocks", () => {
    const headingId = generateUuidV7();
    const codeId = generateUuidV7();
    const dividerId = generateUuidV7();
    const imageId = generateUuidV7();
    const fileId = generateUuidV7();
    const embedId = generateUuidV7();
    const doc = operational({
      blocks: [
        { type: "heading", id: headingId, level: 1, content: [] },
        { type: "code", id: codeId, text: "code", language: "ts" },
        { type: "divider", id: dividerId },
        {
          type: "image",
          id: imageId,
          fileItemId: fileId,
          caption: null,
          altText: null,
          displayWidth: null,
        },
        { type: "fileEmbed", id: fileId, fileItemId: fileId, caption: null },
        {
          type: "embed",
          id: embedId,
          provider: "github",
          sourceUrl: "https://github.com/example/project",
          caption: null,
        },
      ],
    });
    const tree = getOperationalBlockTree(doc);
    const heading = findOperationalNode(tree, headingId);
    heading.data.ensureMergeableMap(PROPS_KEY).delete("level");
    expect(() => operationalBlockSnapshot(doc, headingId)).toThrow(/level is missing/u);

    const leaves: readonly [Uuid, string][] = [
      [codeId, "code"],
      [dividerId, "divider"],
      [imageId, "image"],
      [fileId, "file block"],
      [embedId, "embed"],
    ];
    for (const [id, label] of leaves) {
      const child = findOperationalNode(tree, id).createNode();
      setNodeHeader(child, generateUuidV7(), "paragraph");
      expect(() => operationalBlockSnapshot(doc, id)).toThrow(
        new RegExp(`${label}.*children`, "u"),
      );
    }
  });

  it("supports legacy table columns while migrating them on a column edit", () => {
    const tableId = generateUuidV7();
    const columnId = generateUuidV7();
    const rowId = generateUuidV7();
    const cellId = generateUuidV7();
    const doc = new LoroDoc();
    configureRichText(doc);
    const tree = getOperationalBlockTree(doc);
    const table = tree.createNode();
    setNodeHeader(table, tableId, "table");
    table.data.ensureMergeableMap(PROPS_KEY).set("columns", [{ id: columnId, width: null }]);
    const row = table.createNode();
    setNodeHeader(row, rowId, "tableRow");
    const cell = row.createNode();
    setNodeHeader(cell, cellId, "tableCell");
    cell.data.set("columnId", columnId);
    cell.data.ensureMergeableText(CONTENT_KEY).insert(0, "cell");
    const newColumnId = generateUuidV7();
    const newCellId = generateUuidV7();
    const cells: readonly OperationalTableColumnCell[] = [
      { rowId, cell: { id: newCellId, content: [{ text: "new" }] } },
    ];
    insertOperationalTableColumn(doc, tableId, { id: newColumnId, width: 120 }, cells, null);
    const snapshot = operationalBlockSnapshot(doc, tableId);
    expect(snapshot.type).toBe("table");
    if (snapshot.type === "table") {
      expect(snapshot.columns.map(({ id }) => id)).toEqual([columnId, newColumnId]);
      expect(snapshot.rows[0]?.cells.map(({ id }) => id)).toEqual([cellId, newCellId]);
    }
  });

  it("rejects invalid table operation targets and incomplete row or column edits", () => {
    const fixture = tableFixture();
    const paragraphId = generateUuidV7();
    const paragraphDoc = operational({ blocks: [paragraph(paragraphId)] });
    expect(() =>
      insertOperationalTableRow(
        paragraphDoc,
        paragraphId,
        { id: generateUuidV7(), cells: [] },
        null,
      ),
    ).toThrow(/not a table/u);
    expect(() => deleteOperationalTableRow(paragraphDoc, paragraphId, generateUuidV7())).toThrow(
      /not a table/u,
    );
    expect(() =>
      insertOperationalTableColumn(
        paragraphDoc,
        paragraphId,
        { id: generateUuidV7(), width: null },
        [],
        null,
      ),
    ).toThrow(/not a table/u);
    expect(() => deleteOperationalTableColumn(paragraphDoc, paragraphId, generateUuidV7())).toThrow(
      /not a table/u,
    );

    expect(() =>
      insertOperationalTableRow(
        fixture.doc,
        fixture.tableId,
        { id: generateUuidV7(), cells: [] },
        null,
      ),
    ).toThrow(/has 0 cells/u);
    expect(() =>
      insertOperationalTableRow(
        fixture.doc,
        fixture.tableId,
        { id: generateUuidV7(), cells: [{ id: generateUuidV7(), content: [] }] },
        fixture.cellId,
      ),
    ).toThrow(/not in table/u);
    expect(() => deleteOperationalTableRow(fixture.doc, fixture.tableId, fixture.rowId)).toThrow(
      /at least one row/u,
    );
    expect(() =>
      insertOperationalTableColumn(
        fixture.doc,
        fixture.tableId,
        { id: generateUuidV7(), width: null },
        [],
        null,
      ),
    ).toThrow(/exactly one cell/u);
    const incomplete = tableFixture();
    const beforeIncompleteInsert = materialiseOperationalDocument(incomplete.doc);
    expect(() =>
      insertOperationalTableColumn(
        incomplete.doc,
        incomplete.tableId,
        { id: generateUuidV7(), width: null },
        [{ rowId: generateUuidV7(), cell: { id: generateUuidV7(), content: [] } }],
        null,
      ),
    ).toThrow(/no cell for row/u);
    expect(materialiseOperationalDocument(incomplete.doc)).toEqual(beforeIncompleteInsert);
    expect(() =>
      insertOperationalTableColumn(
        fixture.doc,
        fixture.tableId,
        { id: fixture.columnId, width: null },
        [{ rowId: fixture.rowId, cell: { id: generateUuidV7(), content: [] } }],
        null,
      ),
    ).toThrow(/already exists/u);
    expect(() =>
      deleteOperationalTableColumn(fixture.doc, fixture.tableId, fixture.columnId),
    ).toThrow(/at least one column/u);
  });

  it("prevalidates every table cell before changing columns", () => {
    const insertTableId = generateUuidV7();
    const insertColumnId = generateUuidV7();
    const insertDoc = operational({
      blocks: [
        {
          type: "table",
          id: insertTableId,
          columns: [{ id: insertColumnId, width: null }],
          rows: [
            { id: generateUuidV7(), cells: [{ id: generateUuidV7(), content: [{ text: "A" }] }] },
            { id: generateUuidV7(), cells: [{ id: generateUuidV7(), content: [{ text: "B" }] }] },
          ],
        },
      ],
    });
    const insertBefore = materialiseOperationalDocument(insertDoc);
    const insertRows = insertBefore.blocks[0];
    if (insertRows?.type !== "table") throw new Error("insert fixture is incomplete");
    const [firstRow, secondRow] = insertRows.rows;
    if (firstRow === undefined || secondRow === undefined) {
      throw new Error("insert fixture rows are incomplete");
    }
    expect(() =>
      insertOperationalTableColumn(
        insertDoc,
        insertTableId,
        { id: generateUuidV7(), width: null },
        [
          { rowId: firstRow.id, cell: { id: generateUuidV7(), content: [{ text: "new A" }] } },
          {
            rowId: secondRow.id,
            cell: { id: generateUuidV7(), content: undefined as never },
          },
        ],
        null,
      ),
    ).toThrow();
    expect(materialiseOperationalDocument(insertDoc)).toEqual(insertBefore);

    const deleteTableId = generateUuidV7();
    const deleteColumnIds = [generateUuidV7(), generateUuidV7()] as const;
    const deleteRowIds = [generateUuidV7(), generateUuidV7()] as const;
    const deleteDoc = operational({
      blocks: [
        {
          type: "table",
          id: deleteTableId,
          columns: deleteColumnIds.map((id) => ({ id, width: null })),
          rows: deleteRowIds.map((id, rowIndex) => ({
            id,
            cells: deleteColumnIds.map((_columnId, columnIndex) => ({
              id: generateUuidV7(),
              content: [{ text: `${rowIndex}:${columnIndex}` }],
            })),
          })),
        },
      ],
    });
    const deleteTree = getOperationalBlockTree(deleteDoc);
    const deleteTable = deleteTree.roots()[0];
    if (deleteTable === undefined) throw new Error("delete fixture is incomplete");
    const deleteRows = deleteTable.children() ?? [];
    const firstDeleteRow = deleteRows[0];
    const secondDeleteRow = deleteRows[1];
    if (firstDeleteRow === undefined || secondDeleteRow === undefined) {
      throw new Error("delete fixture rows are incomplete");
    }
    const firstRowChildrenBefore = (firstDeleteRow.children() ?? []).map((node) => node.id);
    const columnsBefore = deleteTable.data.ensureMergeableList(TABLE_COLUMNS_KEY).toArray();
    const malformedCell = secondDeleteRow.children()?.[1];
    if (malformedCell === undefined) throw new Error("delete fixture cells are incomplete");
    malformedCell.data.set("type", "paragraph");

    expect(() =>
      deleteOperationalTableColumn(deleteDoc, deleteTableId, deleteColumnIds[1]),
    ).toThrow();
    expect(deleteTable.data.ensureMergeableList(TABLE_COLUMNS_KEY).toArray()).toEqual(
      columnsBefore,
    );
    expect((firstDeleteRow.children() ?? []).map((node) => node.id)).toEqual(
      firstRowChildrenBefore,
    );
  });

  it("rejects a globally duplicated identity before inserting a table column", () => {
    const fixture = tableFixture();
    const columnsBefore = fixture.table.data.ensureMergeableList(TABLE_COLUMNS_KEY).toArray();
    const rowChildrenBefore = (fixture.row.children() ?? []).map((node) => node.id);
    const duplicate = fixture.tree.createNode();
    setNodeHeader(duplicate, fixture.cellId, "paragraph");

    expect(() =>
      insertOperationalTableColumn(
        fixture.doc,
        fixture.tableId,
        { id: generateUuidV7(), width: null },
        [{ rowId: fixture.rowId, cell: { id: generateUuidV7(), content: [] } }],
        null,
      ),
    ).toThrow(/duplicated/u);
    expect(fixture.table.data.ensureMergeableList(TABLE_COLUMNS_KEY).toArray()).toEqual(
      columnsBefore,
    );
    expect((fixture.row.children() ?? []).map((node) => node.id)).toEqual(rowChildrenBefore);
  });

  it("rejects opaque property collisions with known block fields", () => {
    const id = generateUuidV7();
    const doc = operational({ blocks: [paragraph(id)] });
    const props = findOperationalNode(getOperationalBlockTree(doc), id).data.ensureMergeableMap(
      PROPS_KEY,
    );
    props.set("extra:content", "shadow");
    expect(() => operationalBlockSnapshot(doc, id)).toThrow(/collides with paragraph.content/u);
  });

  it("rejects malformed table columns and preserves explicit empty content", () => {
    const fixture = tableFixture();
    const columns = fixture.table.data.ensureMergeableList(TABLE_COLUMNS_KEY);
    columns.delete(0, 1);
    columns.insert(0, "not a column");
    expect(() => operationalBlockSnapshot(fixture.doc, fixture.tableId)).toThrow(
      /columns\[0\].*object/u,
    );

    const empty = operational({ blocks: [paragraph(generateUuidV7(), "")] });
    expect(materialiseOperationalDocument(empty).blocks[0]).toMatchObject({ content: [] });
  });
});
