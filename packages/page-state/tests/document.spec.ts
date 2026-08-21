import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  OperationalPageDocument,
  PageCommandError,
  versionVectorBytesEqual,
} from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

describe("operational page transactions", () => {
  it("applies a command batch atomically and emits one incremental update", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "Premier")] },
    });

    const result = page.transact([
      {
        type: "insert-block",
        block: paragraph(secondId, "Second"),
        parentBlockId: null,
        beforeBlockId: null,
      },
      { type: "replace-text", blockId: secondId, from: 0, to: 6, text: "Deuxième" },
    ]);

    expect(result.changed).toBe(true);
    expect(result.updateBytes.byteLength).toBeGreaterThan(0);
    expect(result.semanticChanges).toHaveLength(2);
    expect(versionVectorBytesEqual(result.baseVersionVector, result.resultVersionVector)).toBe(
      false,
    );
    expect(page.snapshot()).toEqual({
      blocks: [paragraph(firstId, "Premier"), paragraph(secondId, "Deuxième")],
    });
    await expect(page.project()).resolves.toMatchObject({
      pageId,
      document: {
        blocks: [paragraph(firstId, "Premier"), paragraph(secondId, "Deuxième")],
      },
    });
  });

  it("leaves no partial edit when a later command in the batch is invalid", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const insertedId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "Stable")] },
    });
    const before = page.versionVectorBytes();

    expect(() =>
      page.transact([
        {
          type: "insert-block",
          block: paragraph(insertedId, "Ne doit pas survivre"),
          parentBlockId: null,
          beforeBlockId: null,
        },
        {
          type: "move-block",
          blockId: generateUuidV7(),
          parentBlockId: null,
          beforeBlockId: firstId,
        },
      ]),
    ).toThrow(PageCommandError);

    expect(versionVectorBytesEqual(page.versionVectorBytes(), before)).toBe(true);
    expect((await page.project()).document).toEqual({ blocks: [paragraph(firstId, "Stable")] });
  });

  it("rejects an invalid property without scanning or committing the rest of the page", () => {
    const pageId = generateUuidV7();
    const headingId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          { type: "heading", id: headingId, level: 1, content: [{ text: "Titre" }] },
          paragraph(generateUuidV7(), "Voisin"),
        ],
      },
    });
    const before = page.versionVectorBytes();

    expect(() =>
      page.transact([{ type: "set-block-property", blockId: headingId, key: "level", value: 99 }]),
    ).toThrow(PageCommandError);

    expect(versionVectorBytesEqual(page.versionVectorBytes(), before)).toBe(true);
    expect(page.snapshot().blocks[0]).toMatchObject({ type: "heading", level: 1 });
  });

  it("keeps canonical identity through moves and rejects duplicate live identities", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "A"), paragraph(secondId, "B")] },
    });

    page.transact([
      {
        type: "move-block",
        blockId: secondId,
        parentBlockId: null,
        beforeBlockId: firstId,
      },
    ]);
    expect((await page.project()).document.blocks.map(({ id }) => id)).toEqual([secondId, firstId]);

    expect(() =>
      page.transact([
        {
          type: "insert-block",
          block: paragraph(firstId, "Collision"),
          parentBlockId: null,
          beforeBlockId: null,
        },
      ]),
    ).toThrow(/identity/u);
  });

  it("deletes a subtree without changing neighbouring block identities", async () => {
    const pageId = generateUuidV7();
    const containerId = generateUuidV7();
    const childId = generateUuidV7();
    const neighbourId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "toggle",
            id: containerId,
            content: [{ text: "Détails" }],
            children: [paragraph(childId, "Enfant")],
          },
          paragraph(neighbourId, "Voisin"),
        ],
      },
    });

    page.transact([{ type: "delete-block", blockId: containerId }]);
    expect((await page.project()).document).toEqual({
      blocks: [paragraph(neighbourId, "Voisin")],
    });
  });

  it("edits table cells by their stable identity without replacing the table", async () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const cellId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: [{ id: generateUuidV7(), width: null }],
            rows: [
              {
                id: generateUuidV7(),
                cells: [{ id: cellId, content: [{ text: "Cellule" }] }],
              },
            ],
          },
        ],
      },
    });

    const result = page.transact([
      { type: "replace-text", blockId: cellId, from: 7, to: 7, text: " modifiée" },
    ]);
    expect(result.semanticChanges[0]).toMatchObject({
      type: "text-replaced",
      blockId: cellId,
      blockAfter: { type: "table", id: tableId },
    });
    const table = (await page.project()).document.blocks[0];
    expect(table?.type === "table" ? table.rows[0]?.cells[0]?.content : []).toEqual([
      { text: "Cellule modifiée" },
    ]);
  });

  it("inserts and deletes stable table rows and columns as structural operations", async () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const firstColumnId = generateUuidV7();
    const firstRowId = generateUuidV7();
    const firstCellId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: [{ id: firstColumnId, width: null }],
            rows: [
              {
                id: firstRowId,
                cells: [{ id: firstCellId, content: [{ text: "A1" }] }],
              },
            ],
          },
        ],
      },
    });
    const secondRowId = generateUuidV7();
    const secondRowFirstCellId = generateUuidV7();
    const secondColumnId = generateUuidV7();
    const firstRowSecondCellId = generateUuidV7();
    const secondRowSecondCellId = generateUuidV7();

    page.transact([
      {
        type: "insert-table-row",
        tableId,
        row: {
          id: secondRowId,
          cells: [{ id: secondRowFirstCellId, content: [{ text: "A2" }] }],
        },
        beforeRowId: null,
      },
      {
        type: "insert-table-column",
        tableId,
        column: { id: secondColumnId, width: 180 },
        cells: [
          {
            rowId: firstRowId,
            cell: { id: firstRowSecondCellId, content: [{ text: "B1" }] },
          },
          {
            rowId: secondRowId,
            cell: { id: secondRowSecondCellId, content: [{ text: "B2" }] },
          },
        ],
        beforeColumnId: null,
      },
    ]);

    let table = page.snapshot().blocks[0];
    expect(table?.type === "table" ? table : null).toMatchObject({
      columns: [{ id: firstColumnId }, { id: secondColumnId, width: 180 }],
      rows: [
        { id: firstRowId, cells: [{ id: firstCellId }, { id: firstRowSecondCellId }] },
        {
          id: secondRowId,
          cells: [{ id: secondRowFirstCellId }, { id: secondRowSecondCellId }],
        },
      ],
    });

    page.transact([
      { type: "delete-table-column", tableId, columnId: firstColumnId },
      { type: "delete-table-row", tableId, rowId: firstRowId },
    ]);
    table = page.snapshot().blocks[0];
    expect(table?.type === "table" ? table : null).toEqual({
      type: "table",
      id: tableId,
      columns: [{ id: secondColumnId, width: 180 }],
      rows: [
        {
          id: secondRowId,
          cells: [{ id: secondRowSecondCellId, content: [{ text: "B2" }] }],
        },
      ],
    });
  });
});
