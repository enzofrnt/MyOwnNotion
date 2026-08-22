import { type CanonicalBlockV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { OperationalPageDocument, PageUndoManager } from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: text === "" ? [] : [{ text }] };
}

describe("local operational undo", () => {
  it("undoes and redoes one atomic gesture", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "avant")] },
    });
    const history = new PageUndoManager(page);

    history.execute([{ type: "replace-text", blockId, from: 0, to: 5, text: "après" }]);
    expect(page.snapshot().blocks).toEqual([paragraph(blockId, "après")]);
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(page.snapshot().blocks).toEqual([paragraph(blockId, "avant")]);
    expect(history.canRedo).toBe(true);

    history.redo();
    expect(page.snapshot().blocks).toEqual([paragraph(blockId, "après")]);
  });

  it("rejects a non-invertible property gesture before changing the document", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "inchangé")] },
    });
    const history = new PageUndoManager(page);

    expect(() =>
      history.execute([
        {
          type: "set-block-property",
          blockId,
          key: "nouvellePropriété",
          value: "valeur",
        },
      ]),
    ).toThrow("did not exist before this transaction");

    expect(page.snapshot().blocks).toEqual([paragraph(blockId, "inchangé")]);
    expect(history.canUndo).toBe(false);
  });

  it("does not put a remote update on the local undo stack", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const remoteId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "local")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    const update = remote.transact([
      {
        type: "insert-block",
        block: paragraph(remoteId, "distant"),
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);

    history.importRemote(update.updateBytes);

    expect(history.canUndo).toBe(false);
    expect(local.snapshot().blocks.map((block) => block.id)).toEqual([firstId, remoteId]);
  });

  it("keeps a remote insertion while undoing the last local text edit", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const remoteId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "base")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([{ type: "replace-text", blockId: firstId, from: 4, to: 4, text: " locale" }]);
    const update = remote.transact([
      {
        type: "insert-block",
        block: paragraph(remoteId, "distante"),
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    history.importRemote(update.updateBytes);

    history.undo();

    expect(local.snapshot().blocks).toEqual([
      paragraph(firstId, "base"),
      paragraph(remoteId, "distante"),
    ]);
  });

  it("refuses to undo stale text offsets after a remote edit of the same block", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "base")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([{ type: "replace-text", blockId, from: 4, to: 4, text: " locale" }]);
    const remoteEdit = remote.transact([
      { type: "replace-text", blockId, from: 0, to: 0, text: "distant " },
    ]);
    history.importRemote(remoteEdit.updateBytes);
    const beforeUndo = local.snapshot();

    expect(() => history.undo()).toThrow("undo target");
    expect(history.canUndo).toBe(true);
    expect(local.snapshot()).toEqual(beforeUndo);
  });

  it("preserves a remote text edit while undoing a local move", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const movedId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [paragraph(firstId, "premier"), paragraph(movedId, "second")],
      },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([
      { type: "move-block", blockId: movedId, parentBlockId: null, beforeBlockId: firstId },
    ]);
    const remoteEdit = remote.transact([
      { type: "replace-text", blockId: movedId, from: 6, to: 6, text: " distant" },
    ]);
    history.importRemote(remoteEdit.updateBytes);

    history.undo();

    expect(local.snapshot().blocks).toEqual([
      paragraph(firstId, "premier"),
      paragraph(movedId, "second distant"),
    ]);
  });

  it("moves a contiguous group and restores its relative order with one undo", () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const thirdId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          paragraph(firstId, "first"),
          paragraph(secondId, "second"),
          paragraph(thirdId, "third"),
        ],
      },
    });
    const history = new PageUndoManager(page);

    history.execute([
      { type: "move-block", blockId: thirdId, parentBlockId: null, beforeBlockId: firstId },
      { type: "move-block", blockId: secondId, parentBlockId: null, beforeBlockId: thirdId },
    ]);
    expect(page.snapshot().blocks.map((block) => block.id)).toEqual([secondId, thirdId, firstId]);

    history.undo();
    expect(page.snapshot().blocks.map((block) => block.id)).toEqual([firstId, secondId, thirdId]);
  });

  it("restores the exact previous mark spans after a formatting gesture", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const source = {
      type: "paragraph" as const,
      id: blockId,
      content: [{ text: "ab", marks: [{ type: "bold" as const }] }, { text: "cd" }],
    };
    const page = OperationalPageDocument.create({ pageId, document: { blocks: [source] } });
    const history = new PageUndoManager(page);

    history.execute([
      {
        type: "set-mark",
        blockId,
        from: 0,
        to: 2,
        mark: { type: "bold" },
        enabled: false,
      },
      {
        type: "set-mark",
        blockId,
        from: 0,
        to: 4,
        mark: { type: "bold" },
        enabled: true,
      },
    ]);
    expect(page.snapshot().blocks[0]).toMatchObject({
      content: [{ text: "abcd", marks: [{ type: "bold" }] }],
    });

    history.undo();
    expect(page.snapshot().blocks[0]).toEqual(source);
  });

  it("undoes and redoes one table structure gesture without changing stable cells", () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const firstColumnId = generateUuidV7();
    const secondColumnId = generateUuidV7();
    const rowId = generateUuidV7();
    const firstCellId = generateUuidV7();
    const secondCellId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: [{ id: firstColumnId, width: null }],
            rows: [{ id: rowId, cells: [{ id: firstCellId, content: [{ text: "A1" }] }] }],
          },
        ],
      },
    });
    const history = new PageUndoManager(page);

    history.execute([
      {
        type: "insert-table-column",
        tableId,
        column: { id: secondColumnId, width: 180 },
        cells: [{ rowId, cell: { id: secondCellId, content: [{ text: "B1" }] } }],
        beforeColumnId: null,
      },
    ]);
    expect(page.snapshot().blocks[0]).toMatchObject({
      columns: [{ id: firstColumnId }, { id: secondColumnId }],
      rows: [{ cells: [{ id: firstCellId }, { id: secondCellId }] }],
    });

    history.undo();
    expect(page.snapshot().blocks[0]).toMatchObject({
      columns: [{ id: firstColumnId }],
      rows: [{ cells: [{ id: firstCellId }] }],
    });

    history.redo();
    expect(page.snapshot().blocks[0]).toMatchObject({
      columns: [{ id: firstColumnId }, { id: secondColumnId }],
      rows: [{ cells: [{ id: firstCellId }, { id: secondCellId }] }],
    });
  });

  it("reports an explicit failure when a remote deletion removed the local undo target", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "base")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([{ type: "replace-text", blockId, from: 4, to: 4, text: " locale" }]);
    const deletion = remote.transact([{ type: "delete-block", blockId }]);
    history.importRemote(deletion.updateBytes);

    expect(() => history.undo()).toThrow("undo could not be applied after newer changes");
    expect(history.canUndo).toBe(true);
    expect(local.snapshot().blocks).toEqual([]);
  });
});

describe("inverse coverage for every command kind", () => {
  it("undoes an insertion by removing the inserted subtree", () => {
    const pageId = generateUuidV7();
    const keptId = generateUuidV7();
    const insertedId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(keptId, "reste")] },
    });
    const history = new PageUndoManager(page);

    history.execute([
      {
        type: "insert-block",
        parentBlockId: null,
        beforeBlockId: keptId,
        block: paragraph(insertedId, "ajouté"),
      },
    ]);
    expect(page.snapshot().blocks.map((block) => block.id)).toEqual([insertedId, keptId]);

    history.undo();
    expect(page.snapshot().blocks.map((block) => block.id)).toEqual([keptId]);

    history.redo();
    expect(page.snapshot().blocks.map((block) => block.id)).toEqual([insertedId, keptId]);
  });

  it("undoes a deletion by restoring the exact subtree at its old placement", () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "premier"), paragraph(secondId, "second")] },
    });
    const history = new PageUndoManager(page);

    history.execute([{ type: "delete-block", blockId: firstId }]);
    expect(page.snapshot().blocks.map((block) => block.id)).toEqual([secondId]);

    history.undo();
    expect(page.snapshot().blocks).toEqual([
      paragraph(firstId, "premier"),
      paragraph(secondId, "second"),
    ]);
  });

  it("restores typed properties when undoing a transformation across kinds", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "contenu")] },
    });
    const history = new PageUndoManager(page);

    // Paragraph → heading: the inverse must restore level-less paragraph form.
    history.execute([
      { type: "set-block-type", blockId, blockType: "heading", properties: { level: 2 } },
    ]);
    expect(page.snapshot().blocks[0]).toMatchObject({ type: "heading" });
    history.undo();
    expect(page.snapshot().blocks[0]).toMatchObject({ type: "paragraph" });

    // Paragraph → checkbox → code → callout: each inverse carries the typed
    // properties of the previous kind (propertiesFor switch).
    history.execute([
      { type: "set-block-type", blockId, blockType: "checkbox", properties: { checked: true } },
    ]);
    expect(page.snapshot().blocks[0]).toMatchObject({ type: "checkbox", checked: true });
    history.undo();

    history.execute([
      { type: "set-block-type", blockId, blockType: "code", properties: { language: "ts" } },
    ]);
    expect(page.snapshot().blocks[0]).toMatchObject({ type: "code", language: "ts" });
    history.undo();

    history.execute([
      {
        type: "set-block-type",
        blockId,
        blockType: "callout",
        properties: { icon: "⚠️", tone: "yellow" },
      },
    ]);
    expect(page.snapshot().blocks[0]).toMatchObject({ type: "callout", tone: "yellow" });

    // Redo replays the forward transformation from the same entry.
    history.undo();
    history.redo();
    expect(page.snapshot().blocks[0]).toMatchObject({ type: "callout", icon: "⚠️" });
  });

  it("undoes a table row deletion by reattaching the removed row", () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const columnId = generateUuidV7();
    const rowA = generateUuidV7();
    const rowB = generateUuidV7();
    const cellA = generateUuidV7();
    const cellB = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: [{ id: columnId, width: null }],
            rows: [
              { id: rowA, cells: [{ id: cellA, content: [{ text: "A" }] }] },
              { id: rowB, cells: [{ id: cellB, content: [{ text: "B" }] }] },
            ],
          },
        ],
      },
    });
    const history = new PageUndoManager(page);

    history.execute([{ type: "delete-table-row", tableId, rowId: rowA }]);
    expect((page.snapshot().blocks[0] as unknown as { rows: unknown[] }).rows).toHaveLength(1);

    history.undo();
    expect(page.snapshot().blocks[0]).toMatchObject({
      rows: [
        { id: rowA, cells: [{ id: cellA }] },
        { id: rowB, cells: [{ id: cellB }] },
      ],
    });
  });

  it("undoes a table column deletion with its cells", () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const columnA = generateUuidV7();
    const columnB = generateUuidV7();
    const rowId = generateUuidV7();
    const cellA1 = generateUuidV7();
    const cellB1 = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: [
              { id: columnA, width: null },
              { id: columnB, width: null },
            ],
            rows: [
              {
                id: rowId,
                cells: [
                  { id: cellA1, content: [{ text: "A1" }] },
                  { id: cellB1, content: [{ text: "B1" }] },
                ],
              },
            ],
          },
        ],
      },
    });
    const history = new PageUndoManager(page);

    history.execute([{ type: "delete-table-column", tableId, columnId: columnA }]);
    expect((page.snapshot().blocks[0] as unknown as { columns: unknown[] }).columns).toHaveLength(
      1,
    );

    history.undo();
    expect(page.snapshot().blocks[0]).toMatchObject({
      columns: [{ id: columnA }, { id: columnB }],
      rows: [{ cells: [{ id: cellA1 }, { id: cellB1 }] }],
    });
  });

  it("drops the oldest entry beyond the undo limit", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "a")] },
    });
    const history = new PageUndoManager(page, 1);

    history.execute([{ type: "replace-text", blockId, from: 1, to: 1, text: "b" }]);
    history.execute([{ type: "replace-text", blockId, from: 2, to: 2, text: "c" }]);

    history.undo();
    expect(page.snapshot().blocks[0]).toMatchObject({ content: [{ text: "ab" }] });
    // The first gesture was evicted; one more undo is impossible.
    expect(history.canUndo).toBe(false);
  });

  it("refuses a redo whose guards no longer hold after remote work", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "base")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([{ type: "replace-text", blockId, from: 4, to: 4, text: " locale" }]);
    history.undo();
    // A remote edit lands on the same block while the gesture sits undone.
    const remoteEdit = remote.transact([
      { type: "replace-text", blockId, from: 0, to: 4, text: "distant" },
    ]);
    history.importRemote(remoteEdit.updateBytes);

    expect(() => history.redo()).toThrow("redo could not be applied after newer changes");
  });
});

describe("typed-block inversions", () => {
  it("restores each typed kind with its properties when a transform is undone", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const cases: Array<{ start: CanonicalBlockV3; properties: Record<string, unknown> }> = [
      {
        start: { type: "heading" as const, id: blockId, content: [{ text: "t" }], level: 2 },
        properties: { level: 2 },
      },
      {
        start: { type: "checkbox" as const, id: blockId, content: [{ text: "t" }], checked: true },
        properties: { checked: true },
      },
      {
        start: {
          type: "code" as const,
          id: blockId,
          text: "const x = 1;",
          language: "ts",
        },
        properties: { language: "ts" },
      },
      {
        start: {
          type: "callout" as const,
          id: blockId,
          content: [{ text: "t" }],
          icon: "💡",
          tone: "yellow" as const,
        },
        properties: { icon: "💡", tone: "yellow" },
      },
    ];

    for (const { start, properties } of cases) {
      const page = OperationalPageDocument.create({ pageId, document: { blocks: [start] } });
      const history = new PageUndoManager(page);

      history.execute([{ type: "set-block-type", blockId, blockType: "paragraph" }]);
      expect(page.snapshot().blocks[0]).toMatchObject({ type: "paragraph" });

      history.undo();
      expect(page.snapshot().blocks[0]).toMatchObject({ type: start.type, ...properties });
    }
  });

  it("undoes an inserted table row by removing it again", () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const columnId = generateUuidV7();
    const rowA = generateUuidV7();
    const rowB = generateUuidV7();
    const cellA = generateUuidV7();
    const cellB = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: [{ id: columnId, width: null }],
            rows: [{ id: rowA, cells: [{ id: cellA, content: [{ text: "A" }] }] }],
          },
        ],
      },
    });
    const history = new PageUndoManager(page);

    history.execute([
      {
        type: "insert-table-row",
        tableId,
        row: { id: rowB, cells: [{ id: cellB, content: [{ text: "B" }] }] },
        beforeRowId: null,
      },
    ]);
    expect((page.snapshot().blocks[0] as unknown as { rows: unknown[] }).rows).toHaveLength(2);

    history.undo();
    expect((page.snapshot().blocks[0] as unknown as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("restores the previous value when undoing a property change", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "callout",
            id: blockId,
            content: [{ text: "t" }],
            icon: "💡",
            tone: "yellow",
          },
        ],
      },
    });
    const history = new PageUndoManager(page);

    history.execute([{ type: "set-block-property", blockId, key: "tone", value: "gray" }]);
    expect(page.snapshot().blocks[0]).toMatchObject({ tone: "gray" });

    history.undo();
    expect(page.snapshot().blocks[0]).toMatchObject({ tone: "yellow" });
  });

  it("refuses a property gesture on a block that never carried that key", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "unknown" as const,
            id: blockId,
            declaredType: "futureWidget",
            raw: { type: "futureWidget", id: blockId, payload: { nodes: [1] } },
            syntheticId: false,
          },
        ],
      },
    });
    const history = new PageUndoManager(page);

    // An opaque payload carries no comparable property: the gesture is
    // refused before the document changes (FR-019 atomicity).
    expect(() =>
      history.execute([{ type: "set-block-property", blockId, key: "tone", value: "x" }]),
    ).toThrow("did not exist before this transaction");
  });
});
