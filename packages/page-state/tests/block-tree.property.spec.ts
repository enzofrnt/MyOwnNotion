import {
  type BlockDocumentV3,
  canonicalDocumentJsonV3,
  generateUuidV7,
  type Uuid,
  validateDocumentV3,
} from "@myownnotion/domain";
import fc from "fast-check";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  BlockTreeOperationError,
  configureRichText,
  deleteOperationalBlock,
  deleteOperationalTableColumn,
  findOperationalNode,
  getOperationalBlockTree,
  initialiseOperationalBlockTree,
  insertOperationalBlock,
  isTransformableBlockType,
  materialiseOperationalDocument,
  moveOperationalBlock,
  moveOperationalTableColumn,
  moveOperationalTableRow,
  OperationalPageDocument,
  operationalBlockPlacement,
  operationalBlockProperty,
  operationalBlockSnapshot,
  operationalTextForBlock,
  PageCommandError,
  setOperationalBlockProperty,
  setOperationalTableColumnWidth,
  transformOperationalBlockType,
} from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

function operational(document: BlockDocumentV3): LoroDoc {
  const doc = new LoroDoc();
  configureRichText(doc);
  initialiseOperationalBlockTree(doc, document);
  return doc;
}

describe("the movable operational block tree", () => {
  it("preserves table cells through reorder and width changes at both supported limits", () => {
    const tableId = generateUuidV7();
    const columns = [generateUuidV7(), generateUuidV7()] as const;
    const rows = [generateUuidV7(), generateUuidV7()] as const;
    const cells = [
      [generateUuidV7(), generateUuidV7()],
      [generateUuidV7(), generateUuidV7()],
    ] as const;
    const doc = operational({
      blocks: [
        {
          type: "table",
          id: tableId,
          columns: columns.map((id) => ({ id, width: null })),
          rows: rows.map((id, row) => ({
            id,
            cells: columns.map((_, column) => ({
              id: cells[row]?.[column] as Uuid,
              content: [{ text: `${row}:${column}` }],
            })),
          })),
        },
      ],
    });

    moveOperationalTableRow(doc, tableId, rows[0], null);
    moveOperationalTableColumn(doc, tableId, columns[1], columns[0]);
    setOperationalTableColumnWidth(doc, tableId, columns[0], 80);
    setOperationalTableColumnWidth(doc, tableId, columns[1], 1_200);
    setOperationalTableColumnWidth(doc, tableId, columns[1], 1_200);
    setOperationalTableColumnWidth(doc, tableId, columns[1], null);

    const table = materialiseOperationalDocument(doc).blocks[0];
    if (table?.type !== "table") throw new Error("table fixture disappeared");
    expect(table.columns).toEqual([
      { id: columns[1], width: null },
      { id: columns[0], width: 80 },
    ]);
    expect(table.rows.map(({ id }) => id)).toEqual([rows[1], rows[0]]);
    expect(table.rows.map((row) => row.cells.map((cell) => cell.content[0]?.text))).toEqual([
      ["1:1", "1:0"],
      ["0:1", "0:0"],
    ]);
  });

  it("rejects table moves across identities and invalid widths without changing the document", () => {
    const firstTableId = generateUuidV7();
    const secondTableId = generateUuidV7();
    const columns = [generateUuidV7(), generateUuidV7()] as const;
    const rows = [generateUuidV7(), generateUuidV7()] as const;
    const foreignRowId = generateUuidV7();
    const makeRow = (id: Uuid) => ({
      id,
      cells: columns.map(() => ({ id: generateUuidV7(), content: [{ text: "cell" }] })),
    });
    const doc = operational({
      blocks: [
        {
          type: "table",
          id: firstTableId,
          columns: columns.map((id) => ({ id, width: null })),
          rows: rows.map(makeRow),
        },
        {
          type: "table",
          id: secondTableId,
          columns: columns.map(() => ({ id: generateUuidV7(), width: null })),
          rows: [makeRow(foreignRowId)],
        },
      ],
    });
    const before = canonicalDocumentJsonV3(materialiseOperationalDocument(doc));
    const unknown = generateUuidV7();

    expect(() => moveOperationalTableRow(doc, firstTableId, foreignRowId, null)).toThrow(
      /not in table/u,
    );
    expect(() => moveOperationalTableRow(doc, firstTableId, rows[0], foreignRowId)).toThrow(
      /not in table/u,
    );
    expect(() => moveOperationalTableRow(doc, firstTableId, rows[0], rows[0])).toThrow(
      /before itself/u,
    );
    expect(() => moveOperationalTableColumn(doc, firstTableId, unknown, null)).toThrow(
      /not in table/u,
    );
    expect(() => moveOperationalTableColumn(doc, firstTableId, columns[0], unknown)).toThrow(
      /not in table/u,
    );
    expect(() => moveOperationalTableColumn(doc, firstTableId, columns[0], columns[0])).toThrow(
      /before itself/u,
    );
    expect(() => setOperationalTableColumnWidth(doc, firstTableId, unknown, 120)).toThrow(
      /not in table/u,
    );
    for (const width of [79, 1_201, 80.5, Number.NaN, "120" as unknown as number]) {
      expect(() => setOperationalTableColumnWidth(doc, firstTableId, columns[0], width)).toThrow(
        /80 to 1200/u,
      );
    }
    expect(canonicalDocumentJsonV3(materialiseOperationalDocument(doc))).toBe(before);
  });

  it("uses positional legacy cells but refuses to substitute another column after a cell is lost", () => {
    const tableId = generateUuidV7();
    const columns = [generateUuidV7(), generateUuidV7()] as const;
    const rowId = generateUuidV7();
    const cells = [generateUuidV7(), generateUuidV7()] as const;
    const makeDoc = () =>
      operational({
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: columns.map((id) => ({ id, width: null })),
            rows: [
              {
                id: rowId,
                cells: cells.map((id, index) => ({
                  id,
                  content: [{ text: index === 0 ? "A" : "B" }],
                })),
              },
            ],
          },
        ],
      });

    const legacy = makeDoc();
    findOperationalNode(getOperationalBlockTree(legacy), cells[0]).data.set("columnId", "");
    moveOperationalTableColumn(legacy, tableId, columns[0], null);
    const moved = materialiseOperationalDocument(legacy).blocks[0];
    if (moved?.type !== "table") throw new Error("table fixture disappeared");
    expect(moved.rows[0]?.cells.map((cell) => cell.content[0]?.text)).toEqual(["B", "A"]);

    const legacyDeletion = makeDoc();
    findOperationalNode(getOperationalBlockTree(legacyDeletion), cells[0]).data.set("columnId", "");
    deleteOperationalTableColumn(legacyDeletion, tableId, columns[0]);
    const reduced = materialiseOperationalDocument(legacyDeletion).blocks[0];
    if (reduced?.type !== "table") throw new Error("table fixture disappeared");
    expect(reduced.rows[0]?.cells[0]?.content[0]?.text).toBe("B");

    for (const command of ["move-source", "move-anchor", "delete-source"] as const) {
      const incomplete = makeDoc();
      const tree = getOperationalBlockTree(incomplete);
      const lostCell = command === "move-anchor" ? cells[1] : cells[0];
      tree.delete(findOperationalNode(tree, lostCell).id);
      if (command === "move-source") {
        expect(() => moveOperationalTableColumn(incomplete, tableId, columns[0], null)).toThrow(
          /no cell for column/u,
        );
      } else if (command === "move-anchor") {
        expect(() =>
          moveOperationalTableColumn(incomplete, tableId, columns[0], columns[1]),
        ).toThrow(/no cell for column/u);
      } else {
        expect(() => deleteOperationalTableColumn(incomplete, tableId, columns[0])).toThrow(
          /has 1 cells for 2 columns/u,
        );
      }
    }
  });

  it("converges concurrent insertions at the same position with every identity intact", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("gauche", "left"),
        fc.constantFrom("droite", "right"),
        async (a, b) => {
          const pageId = generateUuidV7();
          const anchorId = generateUuidV7();
          const leftId = generateUuidV7();
          const rightId = generateUuidV7();
          const origin = OperationalPageDocument.create({
            pageId,
            document: { blocks: [paragraph(anchorId, "Ancre")] },
          });
          const checkpoint = await origin.checkpoint();
          const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
          const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });

          const leftUpdate = left.transact([
            {
              type: "insert-block",
              block: paragraph(leftId, a),
              parentBlockId: null,
              beforeBlockId: anchorId,
            },
          ]);
          const rightUpdate = right.transact([
            {
              type: "insert-block",
              block: paragraph(rightId, b),
              parentBlockId: null,
              beforeBlockId: anchorId,
            },
          ]);
          left.importUpdate(rightUpdate.updateBytes);
          right.importUpdate(leftUpdate.updateBytes);

          const leftDocument = (await left.project()).document;
          const rightDocument = (await right.project()).document;
          expect(canonicalDocumentJsonV3(leftDocument)).toBe(
            canonicalDocumentJsonV3(rightDocument),
          );
          expect(new Set(leftDocument.blocks.map(({ id }) => id))).toEqual(
            new Set([anchorId, leftId, rightId]),
          );
        },
      ),
    );
  });

  it("converges independent concurrent moves", async () => {
    const pageId = generateUuidV7();
    const ids = [generateUuidV7(), generateUuidV7(), generateUuidV7(), generateUuidV7()] as const;
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: ids.map((id, index) => paragraph(id, String(index))) },
    });
    const checkpoint = await origin.checkpoint();
    const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const leftUpdate = left.transact([
      { type: "move-block", blockId: ids[3], parentBlockId: null, beforeBlockId: ids[0] },
    ]);
    const rightUpdate = right.transact([
      { type: "move-block", blockId: ids[1], parentBlockId: null, beforeBlockId: null },
    ]);

    right.importUpdate(leftUpdate.updateBytes);
    left.importUpdate(rightUpdate.updateBytes);
    expect(canonicalDocumentJsonV3((await left.project()).document)).toBe(
      canonicalDocumentJsonV3((await right.project()).document),
    );
    expect(new Set((await left.project()).document.blocks.map(({ id }) => id))).toEqual(
      new Set(ids),
    );
  });

  it("converges concurrent moves of the same column without duplicating it", async () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const columnIds = [generateUuidV7(), generateUuidV7(), generateUuidV7()] as const;
    const rowId = generateUuidV7();
    const cellIds = [generateUuidV7(), generateUuidV7(), generateUuidV7()] as const;
    const origin = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: columnIds.map((id) => ({ id, width: null })),
            rows: [
              {
                id: rowId,
                cells: cellIds.map((id, index) => ({
                  id,
                  content: [{ text: "ABC"[index] ?? "" }],
                })),
              },
            ],
          },
        ],
      },
    });
    const checkpoint = await origin.checkpoint();
    const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });

    const leftUpdate = left.transact([
      { type: "move-table-column", tableId, columnId: columnIds[0], beforeColumnId: null },
    ]);
    const rightUpdate = right.transact([
      {
        type: "move-table-column",
        tableId,
        columnId: columnIds[0],
        beforeColumnId: columnIds[2],
      },
    ]);
    left.importUpdate(rightUpdate.updateBytes);
    right.importUpdate(leftUpdate.updateBytes);

    const leftTable = left.snapshot().blocks[0];
    if (leftTable?.type !== "table") throw new Error("table fixture disappeared");
    expect(canonicalDocumentJsonV3(left.snapshot())).toBe(
      canonicalDocumentJsonV3(right.snapshot()),
    );
    expect(new Set(leftTable.columns.map(({ id }) => id))).toEqual(new Set(columnIds));
    expect(leftTable.columns).toHaveLength(3);
    expect(
      leftTable.columns.map(
        (column, index) => `${column.id}:${leftTable.rows[0]?.cells[index]?.content[0]?.text}`,
      ),
    ).toEqual(expect.arrayContaining(columnIds.map((id, index) => `${id}:${"ABC"[index]}`)));

    // The merged sequence still accepts further edits and re-projects cleanly.
    left.transact([
      { type: "move-table-column", tableId, columnId: columnIds[1], beforeColumnId: null },
    ]);
    const settled = left.snapshot().blocks[0];
    if (settled?.type !== "table") throw new Error("table fixture disappeared");
    expect(settled.columns.at(-1)?.id).toBe(columnIds[1]);
    expect(settled.rows[0]?.cells.at(-1)?.content[0]?.text).toBe("B");
  });

  it("keeps concurrent column insertions aligned with their stable cells", async () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const anchorColumnId = generateUuidV7();
    const rowId = generateUuidV7();
    const anchorCellId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: [{ id: anchorColumnId, width: null }],
            rows: [{ id: rowId, cells: [{ id: anchorCellId, content: [{ text: "Ancre" }] }] }],
          },
        ],
      },
    });
    const checkpoint = await origin.checkpoint();
    const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const leftColumnId = generateUuidV7();
    const rightColumnId = generateUuidV7();
    const leftCellId = generateUuidV7();
    const rightCellId = generateUuidV7();

    const leftUpdate = left.transact([
      {
        type: "insert-table-column",
        tableId,
        column: { id: leftColumnId, width: 160 },
        cells: [{ rowId, cell: { id: leftCellId, content: [{ text: "Gauche" }] } }],
        beforeColumnId: anchorColumnId,
      },
    ]);
    const rightUpdate = right.transact([
      {
        type: "insert-table-column",
        tableId,
        column: { id: rightColumnId, width: 200 },
        cells: [{ rowId, cell: { id: rightCellId, content: [{ text: "Droite" }] } }],
        beforeColumnId: anchorColumnId,
      },
    ]);

    left.importUpdate(rightUpdate.updateBytes);
    right.importUpdate(leftUpdate.updateBytes);
    const leftTable = left.snapshot().blocks[0];
    const rightTable = right.snapshot().blocks[0];
    expect(canonicalDocumentJsonV3(left.snapshot())).toBe(
      canonicalDocumentJsonV3(right.snapshot()),
    );
    if (leftTable?.type !== "table" || rightTable?.type !== "table") {
      throw new Error("table fixture disappeared");
    }
    const contentByColumn = new Map(
      leftTable.columns.map((column, index) => [
        column.id,
        leftTable.rows[0]?.cells[index]?.content.map(({ text }) => text).join(""),
      ]),
    );
    expect(contentByColumn).toEqual(
      new Map([
        [leftColumnId, "Gauche"],
        [rightColumnId, "Droite"],
        [anchorColumnId, "Ancre"],
      ]),
    );
  });

  it("rejects a cycle without changing the tree", async () => {
    const pageId = generateUuidV7();
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "toggle",
            id: parentId,
            content: [{ text: "Parent" }],
            children: [
              {
                type: "toggle",
                id: childId,
                content: [{ text: "Enfant" }],
              },
            ],
          },
        ],
      },
    });
    const before = canonicalDocumentJsonV3((await page.project()).document);

    expect(() =>
      page.transact([
        {
          type: "move-block",
          blockId: parentId,
          parentBlockId: childId,
          beforeBlockId: null,
        },
      ]),
    ).toThrow(PageCommandError);
    expect(canonicalDocumentJsonV3((await page.project()).document)).toBe(before);
  });

  it("round-trips every V1 block shape, opaque fields and an unknown block", async () => {
    const unknown = validateDocumentV3({
      blocks: [
        {
          type: "futureWidget",
          id: generateUuidV7(),
          payload: { nested: [true, 3, null] },
        },
      ],
    });
    if (!unknown.ok) throw new Error("unknown block fixture should be valid");
    const unknownBlock = unknown.document.blocks[0];
    if (unknownBlock === undefined) throw new Error("unknown block fixture is empty");
    const tableCellId = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [
        {
          ...paragraph(generateUuidV7(), "Paragraphe"),
          rawExtraProperties: { future: { enabled: true } },
        },
        { type: "heading", id: generateUuidV7(), level: 2, content: [{ text: "Titre" }] },
        {
          type: "bulletedListItem",
          id: generateUuidV7(),
          content: [{ text: "Puce" }],
          children: [paragraph(generateUuidV7(), "Enfant")],
        },
        {
          type: "numberedListItem",
          id: generateUuidV7(),
          content: [{ text: "Numéro" }],
        },
        {
          type: "checkbox",
          id: generateUuidV7(),
          checked: true,
          content: [{ text: "À faire" }],
        },
        { type: "quote", id: generateUuidV7(), content: [{ text: "Citation" }] },
        { type: "code", id: generateUuidV7(), text: "const x = 1;", language: "ts" },
        { type: "divider", id: generateUuidV7() },
        {
          type: "toggle",
          id: generateUuidV7(),
          content: [{ text: "Détails" }],
          children: [paragraph(generateUuidV7(), "Contenu")],
        },
        {
          type: "callout",
          id: generateUuidV7(),
          content: [{ text: "Conseil" }],
          icon: "💡",
          tone: "yellow",
          children: [paragraph(generateUuidV7(), "Suite")],
        },
        {
          type: "table",
          id: generateUuidV7(),
          columns: [{ id: generateUuidV7(), width: 240 }],
          rows: [
            {
              id: generateUuidV7(),
              cells: [
                {
                  id: tableCellId,
                  content: [{ text: "Cellule" }],
                  children: [paragraph(generateUuidV7(), "Sous-bloc")],
                },
              ],
            },
          ],
        },
        {
          type: "image",
          id: generateUuidV7(),
          fileItemId: generateUuidV7(),
          caption: "Vue",
          altText: "Aperçu",
          displayWidth: 640,
        },
        {
          type: "fileEmbed",
          id: generateUuidV7(),
          fileItemId: generateUuidV7(),
          caption: null,
        },
        {
          type: "embed",
          id: generateUuidV7(),
          provider: "github",
          sourceUrl: "https://github.com/enzofrnt/MyOwnNotion",
          caption: "Dépôt",
        },
        unknownBlock,
      ],
    };
    const doc = operational(document);

    expect(canonicalDocumentJsonV3(materialiseOperationalDocument(doc))).toBe(
      canonicalDocumentJsonV3(document),
    );
    expect(operationalBlockSnapshot(doc, tableCellId).type).toBe("table");
  });

  it("supports properties, transformations and editable text capabilities", () => {
    const paragraphId = generateUuidV7();
    const containerId = generateUuidV7();
    const childId = generateUuidV7();
    const codeId = generateUuidV7();
    const dividerId = generateUuidV7();
    const imageId = generateUuidV7();
    const cellId = generateUuidV7();
    const doc = operational({
      blocks: [
        paragraph(paragraphId, "Texte"),
        {
          type: "toggle",
          id: containerId,
          content: [{ text: "Parent" }],
          children: [paragraph(childId, "Enfant")],
        },
        { type: "code", id: codeId, text: "code", language: null },
        { type: "divider", id: dividerId },
        {
          type: "image",
          id: imageId,
          fileItemId: generateUuidV7(),
          caption: null,
          altText: null,
          displayWidth: null,
        },
        {
          type: "table",
          id: generateUuidV7(),
          columns: [{ id: generateUuidV7(), width: null }],
          rows: [
            {
              id: generateUuidV7(),
              cells: [{ id: cellId, content: [{ text: "cell" }] }],
            },
          ],
        },
      ],
    });

    expect(isTransformableBlockType("heading")).toBe(true);
    expect(isTransformableBlockType("image")).toBe(false);
    expect(isTransformableBlockType(3)).toBe(false);
    expect(operationalBlockProperty(doc, paragraphId, "future")).toBeUndefined();
    setOperationalBlockProperty(doc, paragraphId, "future", { nested: [1, true] });
    expect(operationalBlockProperty(doc, paragraphId, "future")).toEqual({ nested: [1, true] });
    expect(() => operationalBlockProperty(doc, paragraphId, "content")).toThrow(/structural/u);
    expect(() => setOperationalBlockProperty(doc, paragraphId, "id", "other")).toThrow(
      /structural/u,
    );

    transformOperationalBlockType(doc, paragraphId, "heading", { level: 3 });
    expect(operationalBlockSnapshot(doc, paragraphId)).toMatchObject({
      type: "heading",
      level: 3,
    });
    transformOperationalBlockType(doc, paragraphId, "checkbox", undefined);
    expect(operationalBlockSnapshot(doc, paragraphId)).toMatchObject({
      type: "checkbox",
      checked: false,
    });
    transformOperationalBlockType(doc, paragraphId, "code", undefined);
    expect(operationalTextForBlock(doc, paragraphId)).toMatchObject({
      allowsMarks: false,
      allowsCodeControls: true,
    });
    expect(operationalTextForBlock(doc, codeId).allowsCodeControls).toBe(true);
    expect(operationalTextForBlock(doc, cellId)).toMatchObject({
      allowsMarks: true,
      allowsCodeControls: true,
    });
    expect(() => operationalTextForBlock(doc, dividerId)).toThrow(/no editable text/u);
    expect(() => transformOperationalBlockType(doc, imageId, "paragraph", undefined)).toThrow(
      /cannot be transformed/u,
    );
    expect(() => transformOperationalBlockType(doc, containerId, "code", undefined)).toThrow(
      /cannot retain/u,
    );
  });

  it("validates placements and protects internal table identities", () => {
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    const rowId = generateUuidV7();
    const cellId = generateUuidV7();
    const doc = operational({
      blocks: [
        paragraph(firstId, "A"),
        paragraph(secondId, "B"),
        {
          type: "toggle",
          id: parentId,
          content: [{ text: "Parent" }],
          children: [paragraph(childId, "Child")],
        },
        {
          type: "table",
          id: generateUuidV7(),
          columns: [{ id: generateUuidV7(), width: null }],
          rows: [{ id: rowId, cells: [{ id: cellId, content: [] }] }],
        },
      ],
    });

    expect(operationalBlockPlacement(doc, firstId)).toEqual({
      parentBlockId: null,
      beforeBlockId: secondId,
    });
    expect(operationalBlockPlacement(doc, childId)).toEqual({
      parentBlockId: parentId,
      beforeBlockId: null,
    });
    expect(() =>
      insertOperationalBlock(doc, paragraph(generateUuidV7(), "bad"), parentId, secondId),
    ).toThrow(/not under/u);
    expect(() => insertOperationalBlock(doc, paragraph(firstId, "duplicate"), null, null)).toThrow(
      /already exists/u,
    );
    expect(() => moveOperationalBlock(doc, firstId, null, firstId)).toThrow(/before itself/u);
    expect(() => moveOperationalBlock(doc, firstId, secondId, null)).toThrow(/cannot contain/u);
    expect(() => operationalBlockPlacement(doc, rowId)).toThrow(/internal/u);
    expect(() => deleteOperationalBlock(doc, cellId)).toThrow(/internal/u);
    expect(() => findOperationalNode(getOperationalBlockTree(doc), generateUuidV7())).toThrow(
      BlockTreeOperationError,
    );
    deleteOperationalBlock(doc, secondId);
    expect(() => findOperationalNode(getOperationalBlockTree(doc), secondId)).toThrow(
      /does not exist/u,
    );
  });
});
