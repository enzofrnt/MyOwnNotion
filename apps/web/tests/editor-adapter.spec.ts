import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import type { EditorBlock, EditorBlocksChanged } from "../src/features/editor/blocknote-schema.ts";
import {
  commandsFromBlockNoteChanges,
  minimalTextReplacement,
} from "../src/features/editor/editor-adapter.ts";

const FIRST = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056" as Uuid;
const SECOND = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2057" as Uuid;
const THIRD = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2058" as Uuid;
const TABLE = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2059" as Uuid;
const COLUMN_A = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2060" as Uuid;
const COLUMN_B = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2061" as Uuid;
const ROW_A = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2062" as Uuid;
const ROW_B = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2063" as Uuid;
const CELL_A1 = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2064" as Uuid;
const CELL_A2 = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2065" as Uuid;
const CELL_B1 = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2066" as Uuid;

function paragraph(id: Uuid, text: string): EditorBlock {
  return {
    id,
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: text === "" ? [] : [{ type: "text", text, styles: {} }],
    children: [],
  } as EditorBlock;
}

function tableCell(id: Uuid, text: string): EditorBlock {
  return {
    id,
    type: "tableCell",
    props: {},
    content: text === "" ? [] : [{ type: "text", text, styles: {} }],
    children: [],
  } as EditorBlock;
}

function tableRow(id: Uuid, cells: readonly EditorBlock[]): EditorBlock {
  return { id, type: "tableRow", props: {}, content: undefined, children: cells } as EditorBlock;
}

function table(
  columns: readonly { readonly id: Uuid; readonly width: number | null }[],
  rows: readonly EditorBlock[],
): EditorBlock {
  return {
    id: TABLE,
    type: "table",
    props: { columnsJson: JSON.stringify(columns) },
    content: undefined,
    children: rows,
  } as EditorBlock;
}

describe("BlockNote changes → page commands", () => {
  it("translates a slash-menu type change into a rich block as one set-block-type", () => {
    // The `/Encadré` gesture reaches the adapter as an update of the same
    // block id: dropping it left the visible callout absent from the
    // operational authority until a projection assertion rewound the work.
    const before = paragraph(FIRST, "");
    const after = {
      id: FIRST,
      type: "callout",
      props: { icon: "💡", tone: "yellow" },
      content: [],
      children: [],
    } as EditorBlock;

    expect(
      commandsFromBlockNoteChanges({
        changes: [{ type: "update", block: after, prevBlock: before, source: { type: "local" } }],
        document: [after],
      }),
    ).toEqual([
      {
        type: "set-block-type",
        blockId: FIRST,
        blockType: "callout",
        properties: { icon: "💡", tone: "yellow" },
      },
    ]);
  });

  it("clears a slash query before transforming its block into a divider", () => {
    const before = paragraph(FIRST, "/div");
    const after = {
      id: FIRST,
      type: "divider",
      props: {},
      content: undefined,
      children: [],
    } as EditorBlock;

    expect(
      commandsFromBlockNoteChanges({
        changes: [{ type: "update", block: after, prevBlock: before, source: { type: "local" } }],
        document: [after],
      }),
    ).toEqual([
      { type: "replace-text", blockId: FIRST, from: 0, to: 4, text: "" },
      { type: "set-block-type", blockId: FIRST, blockType: "divider" },
    ]);
  });

  it("translates a whole new table as one insert-block, never row-by-row", () => {
    // BlockNote announces a created table together with its rows and cells.
    // Re-translating those rows targeted a table the authority did not hold
    // yet and refused the whole gesture.
    const newTable = table(
      [
        { id: COLUMN_A, width: null },
        { id: COLUMN_B, width: null },
      ],
      [tableRow(ROW_A, [tableCell(CELL_A1, ""), tableCell(CELL_A2, "")])],
    );
    const changes = [
      { type: "insert", block: newTable, prevBlock: undefined, source: { type: "local" } },
      {
        type: "insert",
        block: tableRow(ROW_A, []),
        prevBlock: undefined,
        source: { type: "local" },
      },
      {
        type: "insert",
        block: tableCell(CELL_A1, ""),
        prevBlock: undefined,
        source: { type: "local" },
      },
      {
        type: "insert",
        block: tableCell(CELL_A2, ""),
        prevBlock: undefined,
        source: { type: "local" },
      },
    ] as EditorBlocksChanged;

    const commands = commandsFromBlockNoteChanges({ changes, document: [newTable] });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "insert-block", block: { type: "table" } });
  });

  it("emits the bounded text replacement instead of replacing the block", () => {
    const before = paragraph(FIRST, "alpha");
    const after = paragraph(FIRST, "alpine");
    const changes = [
      { type: "update", block: after, prevBlock: before, source: { type: "local" } },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [after] })).toEqual([
      { type: "replace-text", blockId: FIRST, from: 3, to: 5, text: "ine" },
    ]);
  });

  it("persists a slash transform that changes text and adds a page link together", () => {
    const before = paragraph(FIRST, "/page");
    const after = {
      ...paragraph(FIRST, ""),
      content: [
        {
          type: "pageLink",
          props: { targetItemId: FIRST },
          content: [{ type: "text", text: "Sans titre", styles: {} }],
        },
      ],
    } as EditorBlock;
    const changes = [
      { type: "update", block: after, prevBlock: before, source: { type: "local" } },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [after] })).toEqual([
      { type: "replace-text", blockId: FIRST, from: 0, to: 4, text: "Sans titr" },
      {
        type: "set-mark",
        blockId: FIRST,
        from: 0,
        to: 10,
        mark: { type: "pageLink", targetItemId: FIRST },
        enabled: true,
      },
    ]);
  });

  it("keeps a move as one move command, never delete plus insert", () => {
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const changes = [
      {
        type: "move",
        block: second,
        prevBlock: second,
        source: { type: "drop" },
      },
    ] as EditorBlocksChanged;

    const commands = commandsFromBlockNoteChanges({ changes, document: [second, first] });

    expect(commands).toEqual([
      { type: "move-block", blockId: SECOND, parentBlockId: null, beforeBlockId: FIRST },
    ]);
    expect(commands.map((command) => command.type)).not.toContain("delete-block");
    expect(commands.map((command) => command.type)).not.toContain("insert-block");
  });

  it("uses the final sibling order for a multi-block paste in one atomic command batch", () => {
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const changes = [
      { type: "insert", block: first, prevBlock: undefined, source: { type: "paste" } },
      { type: "insert", block: second, prevBlock: undefined, source: { type: "paste" } },
    ] as EditorBlocksChanged;

    const commands = commandsFromBlockNoteChanges({ changes, document: [first, second] });

    expect(commands).toHaveLength(2);
    expect(commands).toEqual([
      expect.objectContaining({
        type: "insert-block",
        block: expect.objectContaining({ id: SECOND }),
      }),
      expect.objectContaining({
        type: "insert-block",
        block: expect.objectContaining({ id: FIRST }),
        beforeBlockId: SECOND,
      }),
    ]);
  });

  it("edits a table cell by its own identity instead of replacing the table", () => {
    const before = tableCell(THIRD, "Cellule");
    const after = tableCell(THIRD, "Cellule durable");
    const changes = [
      { type: "update", block: after, prevBlock: before, source: { type: "local" } },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [after] })).toEqual([
      { type: "replace-text", blockId: THIRD, from: 7, to: 7, text: " durable" },
    ]);
  });

  it("emits rich block property updates without replacing their content", () => {
    const before = {
      id: THIRD,
      type: "callout",
      props: { icon: "💡", tone: "yellow" },
      content: [{ type: "text", text: "Conseil", styles: {} }],
      children: [],
    } as EditorBlock;
    const after = {
      ...before,
      props: { icon: "⚠️", tone: "red" },
    } as EditorBlock;
    const changes = [
      { type: "update", block: after, prevBlock: before, source: { type: "local" } },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [after] })).toEqual([
      { type: "set-block-property", blockId: THIRD, key: "icon", value: "⚠️" },
      { type: "set-block-property", blockId: THIRD, key: "tone", value: "red" },
    ]);
  });

  it("translates a table row insertion into one structural command", () => {
    const firstRow = tableRow(ROW_A, [tableCell(CELL_A1, "A1")]);
    const secondRow = tableRow(ROW_B, [tableCell(CELL_B1, "A2")]);
    const current = table([{ id: COLUMN_A, width: null }], [firstRow, secondRow]);
    const changes = [
      { type: "insert", block: secondRow, prevBlock: undefined, source: { type: "local" } },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [current] })).toEqual([
      {
        type: "insert-table-row",
        tableId: TABLE,
        row: { id: ROW_B, cells: [{ id: CELL_B1, content: [{ text: "A2" }] }] },
        beforeRowId: null,
      },
    ]);
  });

  it("translates a table row deletion without replacing its surviving neighbour", () => {
    const deleted = tableRow(ROW_B, [tableCell(CELL_B1, "A2")]);
    const current = table(
      [{ id: COLUMN_A, width: null }],
      [tableRow(ROW_A, [tableCell(CELL_A1, "A1")])],
    );
    const changes = [
      { type: "delete", block: deleted, prevBlock: undefined, source: { type: "local" } },
    ] as EditorBlocksChanged;

    expect(
      commandsFromBlockNoteChanges({
        changes,
        document: [current],
        tableIdForInternalBlock: (blockId) => (blockId === ROW_B ? TABLE : null),
      }),
    ).toEqual([{ type: "delete-table-row", tableId: TABLE, rowId: ROW_B }]);
  });

  it("derives a stable column insertion from the table property and cell identities", () => {
    const previous = table(
      [{ id: COLUMN_A, width: null }],
      [tableRow(ROW_A, [tableCell(CELL_A1, "A1")])],
    );
    const current = table(
      [
        { id: COLUMN_A, width: null },
        { id: COLUMN_B, width: 180 },
      ],
      [tableRow(ROW_A, [tableCell(CELL_A1, "A1"), tableCell(CELL_A2, "B1")])],
    );
    const changes = [
      { type: "update", block: current, prevBlock: previous, source: { type: "local" } },
      {
        type: "insert",
        block: tableCell(CELL_A2, "B1"),
        prevBlock: undefined,
        source: { type: "local" },
      },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [current] })).toEqual([
      {
        type: "insert-table-column",
        tableId: TABLE,
        column: { id: COLUMN_B, width: 180 },
        cells: [{ rowId: ROW_A, cell: { id: CELL_A2, content: [{ text: "B1" }] } }],
        beforeColumnId: null,
      },
    ]);
  });

  it("derives a stable column deletion from the table property", () => {
    const previous = table(
      [
        { id: COLUMN_A, width: null },
        { id: COLUMN_B, width: 180 },
      ],
      [tableRow(ROW_A, [tableCell(CELL_A1, "A1"), tableCell(CELL_A2, "B1")])],
    );
    const current = table(
      [{ id: COLUMN_A, width: null }],
      [tableRow(ROW_A, [tableCell(CELL_A1, "A1")])],
    );
    const changes = [
      { type: "update", block: current, prevBlock: previous, source: { type: "local" } },
      {
        type: "delete",
        block: tableCell(CELL_A2, "B1"),
        prevBlock: undefined,
        source: { type: "local" },
      },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [current] })).toEqual([
      { type: "delete-table-column", tableId: TABLE, columnId: COLUMN_B },
    ]);
  });
});

describe("minimal UTF-16 text diff", () => {
  it("keeps the common prefix and suffix", () => {
    expect(minimalTextReplacement("un ancien texte", "un nouveau texte")).toEqual({
      from: 3,
      to: 9,
      text: "nouveau",
    });
  });
});
