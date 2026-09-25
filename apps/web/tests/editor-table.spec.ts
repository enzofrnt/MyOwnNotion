import { beforeEach, describe, expect, test } from "vitest";
import type { EditorInstance } from "../src/features/editor/blocknote-schema.ts";
import {
  clampEditorTableColumnWidth,
  DEFAULT_EDITOR_TABLE_COLUMN_WIDTH,
  EditorTableManager,
  editorTableGridTemplate,
  editorTableLayout,
  editorTableTrackRule,
  insertTableCellHardBreak,
  isNoopTableMove,
  MAX_EDITOR_TABLE_COLUMN_WIDTH,
  MIN_EDITOR_TABLE_COLUMN_WIDTH,
  moveTableCellByTab,
  TABLE_COLUMNS_PROP,
  tableDropIndex,
} from "../src/features/editor/custom-blocks/table.tsx";
import {
  getTableColumnResizeHover,
  getTableHover,
  getTableLayout,
  resetTableUiState,
  setTableColumnResizeHover,
  setTableHover,
  setTableLayout,
  subscribeTableColumnResizeHover,
  subscribeTableHover,
  subscribeTableLayout,
} from "../src/features/editor/custom-blocks/table-ui-state.ts";
import { resolveSideMenuAnchor } from "../src/features/editor/editor-menus/block-side-menu.tsx";

const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

interface FakeBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: FakeBlock[];
}

/** Minimal BlockNote stand-in: a block tree with the editor calls the manager uses. */
class FakeEditor {
  readonly document: FakeBlock[];
  readonly log: string[] = [];
  cursor: { id: string; type: string } | null = null;

  constructor(document: FakeBlock[]) {
    this.document = document;
  }

  private find(
    id: string,
    blocks: FakeBlock[] = this.document,
    parent: FakeBlock | null = null,
  ): { block: FakeBlock; parent: FakeBlock | null; siblings: FakeBlock[] } | null {
    for (const block of blocks) {
      if (block.id === id) return { block, parent, siblings: blocks };
      const nested = this.find(id, block.children, block);
      if (nested !== null) return nested;
    }
    return null;
  }

  getBlock(id: string): FakeBlock | undefined {
    return this.find(id)?.block;
  }

  getParentBlock(id: string): FakeBlock | undefined {
    return this.find(id)?.parent ?? undefined;
  }

  insertBlocks(blocks: unknown[], reference: string, placement: "before" | "after"): void {
    const target = this.find(reference);
    if (target === null) throw new Error(`reference ${reference} missing`);
    const index = target.siblings.indexOf(target.block) + (placement === "after" ? 1 : 0);
    target.siblings.splice(index, 0, ...(blocks as FakeBlock[]).map(normalise));
    this.log.push(`insert ${placement} ${reference}`);
  }

  removeBlocks(ids: string[]): void {
    for (const id of ids) {
      const target = this.find(id);
      if (target === null) throw new Error(`block ${id} missing`);
      target.siblings.splice(target.siblings.indexOf(target.block), 1);
    }
    this.log.push(`remove ${ids.length}`);
  }

  updateBlock(id: string, update: { props?: Record<string, unknown>; content?: unknown }): void {
    const target = this.find(id);
    if (target === null) throw new Error(`block ${id} missing`);
    if (update.props !== undefined) Object.assign(target.block.props, update.props);
    if (update.content !== undefined) target.block.content = update.content;
    this.log.push(`update ${target.block.type}`);
  }

  setTextCursorPosition(id: string): void {
    const block = this.getBlock(id);
    if (block === undefined) throw new Error(`cursor target ${id} missing`);
    this.cursor = { id: block.id, type: block.type };
  }

  getTextCursorPosition(): { block: { id: string; type: string } } {
    if (this.cursor === null) throw new Error("no cursor");
    return { block: this.cursor };
  }

  nestBlock(): void {
    this.log.push("nest");
  }

  transact(apply: () => void): void {
    apply();
  }

  onChange(): () => void {
    return () => undefined;
  }
}

function normalise(block: FakeBlock): FakeBlock {
  return {
    id: block.id,
    type: block.type,
    props: block.props ?? {},
    content: block.content,
    children: (block.children ?? []).map(normalise),
  };
}

function table(rowCount: number, columnCount: number): FakeBlock {
  const columns = Array.from({ length: columnCount }, (_, c) => ({
    id: uuid(100 + c),
    width: null,
  }));
  return {
    id: uuid(1),
    type: "table",
    props: { [TABLE_COLUMNS_PROP]: JSON.stringify(columns) },
    children: Array.from({ length: rowCount }, (_, r) => ({
      id: uuid(10 + r),
      type: "tableRow",
      props: {},
      children: Array.from({ length: columnCount }, (_, c) => ({
        id: uuid(1000 + r * 10 + c),
        type: "tableCell",
        props: {},
        content: [{ type: "text", text: `r${r}c${c}`, styles: {} }],
        children: [],
      })),
    })),
  };
}

const shape = (block: FakeBlock) => ({
  columns: (JSON.parse(block.props[TABLE_COLUMNS_PROP] as string) as unknown[]).length,
  rows: block.children.map((row) => row.children.length),
});

describe("editorTableGridTemplate", () => {
  test("uses AFFiNE default width for null columns", () => {
    expect(
      editorTableGridTemplate([
        { id: uuid(1), width: null },
        { id: uuid(2), width: null },
      ]),
    ).toBe(`${DEFAULT_EDITOR_TABLE_COLUMN_WIDTH}px ${DEFAULT_EDITOR_TABLE_COLUMN_WIDTH}px`);
  });

  test("keeps explicit widths so every row shares the same tracks", () => {
    expect(
      editorTableGridTemplate([
        { id: uuid(1), width: 80 },
        { id: uuid(2), width: 240 },
        { id: uuid(3), width: null },
      ]),
    ).toBe(`80px 240px ${DEFAULT_EDITOR_TABLE_COLUMN_WIDTH}px`);
  });

  test("applies a live resize draft without mutating column props", () => {
    expect(
      editorTableGridTemplate(
        [
          { id: uuid(1), width: null },
          { id: uuid(2), width: 180 },
        ],
        2,
        {
          columnIndex: 0,
          width: 200,
        },
      ),
    ).toBe("200px 180px");
  });

  test("clamps dragged widths to the domain catalogue", () => {
    expect(clampEditorTableColumnWidth(10)).toBe(MIN_EDITOR_TABLE_COLUMN_WIDTH);
    expect(clampEditorTableColumnWidth(9_999)).toBe(MAX_EDITOR_TABLE_COLUMN_WIDTH);
    expect(clampEditorTableColumnWidth(123.6)).toBe(124);
  });

  test("scopes the track rule to the table's own block container", () => {
    const rule = editorTableTrackRule(uuid(7), "120px 80px");
    expect(rule).toContain(`.bn-block[data-id="${uuid(7)}"]`);
    expect(rule).toContain("grid-template-columns:120px 80px");
    expect(editorTableTrackRule('x"]{}', "1px")).not.toContain('"]{}');
  });
});

describe("editorTableLayout", () => {
  test("indexes every cell by row and column", () => {
    const layout = editorTableLayout(table(2, 3));
    expect(layout.rowCount).toBe(2);
    expect(layout.columnCount).toBe(3);
    expect(layout.rowIndexByCell.get(uuid(1012))).toBe(1);
    expect(layout.columnIndexByCell.get(uuid(1012))).toBe(2);
  });
});

describe("EditorTableManager", () => {
  test("inserts a row before an index and focuses its first cell", () => {
    const editor = new FakeEditor([table(2, 2)]);
    const manager = new EditorTableManager(editor, editor.getBlock(uuid(1)) as never);
    manager.insertRow(1);
    const next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(shape(next)).toEqual({ columns: 2, rows: [2, 2, 2] });
    expect(next.children[1]?.id).not.toBe(uuid(11));
    expect(editor.cursor?.id).toBe(next.children[1]?.children[0]?.id);
  });

  test("appends a row after the last one", () => {
    const editor = new FakeEditor([table(2, 2)]);
    new EditorTableManager(editor, editor.getBlock(uuid(1)) as never).insertRow(2);
    expect(editor.log).toEqual([`insert after ${uuid(11)}`]);
  });

  test("duplicates a row with its cell content under fresh identities", () => {
    const editor = new FakeEditor([table(1, 2)]);
    new EditorTableManager(editor, editor.getBlock(uuid(1)) as never).duplicateRow(0);
    const next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(next.children).toHaveLength(2);
    expect(next.children[1]?.children[1]?.content).toEqual(next.children[0]?.children[1]?.content);
    expect(next.children[1]?.children[1]?.id).not.toBe(uuid(1001));
  });

  test("inserts a column at an index in columnsJson and in every row", () => {
    const editor = new FakeEditor([table(2, 2)]);
    new EditorTableManager(editor, editor.getBlock(uuid(1)) as never).insertColumn(1, 1);
    const next = editor.getBlock(uuid(1)) as FakeBlock;
    const columns = JSON.parse(next.props[TABLE_COLUMNS_PROP] as string) as { id: string }[];
    expect(columns.map(({ id }) => id)).toEqual([uuid(100), columns[1]?.id ?? "", uuid(101)]);
    expect(shape(next)).toEqual({ columns: 3, rows: [3, 3] });
    expect(next.children[0]?.children[1]?.content).toEqual([]);
    expect(editor.cursor?.id).toBe(next.children[1]?.children[1]?.id);
  });

  test("deletes a column with its cells and refuses to delete the last one", () => {
    const editor = new FakeEditor([table(2, 2)]);
    new EditorTableManager(editor, editor.getBlock(uuid(1)) as never).deleteColumn(0);
    const next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(shape(next)).toEqual({ columns: 1, rows: [1, 1] });
    expect(next.children[0]?.children[0]?.id).toBe(uuid(1001));
    const manager = new EditorTableManager(editor, next as never);
    expect(manager.canDeleteColumn).toBe(false);
    manager.deleteColumn(0);
    expect(shape(editor.getBlock(uuid(1)) as FakeBlock)).toEqual({ columns: 1, rows: [1, 1] });
  });

  test("deletes a row but keeps the last one", () => {
    const editor = new FakeEditor([table(2, 2)]);
    const manager = new EditorTableManager(editor, editor.getBlock(uuid(1)) as never);
    manager.deleteRow(0);
    const next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(next.children.map(({ id }) => id)).toEqual([uuid(11)]);
    expect(new EditorTableManager(editor, next as never).canDeleteRow).toBe(false);
  });

  test("clears a row and a column without touching identities", () => {
    const editor = new FakeEditor([table(2, 2)]);
    const manager = new EditorTableManager(editor, editor.getBlock(uuid(1)) as never);
    manager.clearRow(0);
    manager.clearColumn(1);
    const next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(next.children[0]?.children.map((cell) => cell.content)).toEqual([[], []]);
    expect(next.children[1]?.children.map((cell) => cell.content)).toEqual([
      [{ type: "text", text: "r1c0", styles: {} }],
      [],
    ]);
    expect(shape(next)).toEqual({ columns: 2, rows: [2, 2] });
  });

  test("resizes a column width in columnsJson", () => {
    const editor = new FakeEditor([table(1, 2)]);
    new EditorTableManager(editor, editor.getBlock(uuid(1)) as never).resizeColumn(1, 240);
    const columns = JSON.parse(
      (editor.getBlock(uuid(1)) as FakeBlock).props[TABLE_COLUMNS_PROP] as string,
    ) as { id: string; width: number | null }[];
    expect(columns).toEqual([
      { id: uuid(100), width: null },
      { id: uuid(101), width: 240 },
    ]);
  });

  test("trims columnsJson entries that have no cells before changing columns", () => {
    const block = table(1, 2);
    block.props[TABLE_COLUMNS_PROP] = JSON.stringify([
      { id: uuid(100), width: null },
      { id: uuid(101), width: null },
      { id: uuid(102), width: null },
    ]);
    const editor = new FakeEditor([block]);
    const manager = new EditorTableManager(editor, editor.getBlock(uuid(1)) as never);
    expect(manager.columnCount).toBe(2);
    manager.insertColumn(2);
    expect(shape(editor.getBlock(uuid(1)) as FakeBlock)).toEqual({ columns: 3, rows: [3] });
  });
});

describe("EditorTableManager moves", () => {
  const texts = (block: FakeBlock) =>
    block.children.map((row) =>
      row.children
        .map((cell) => (cell.content as { text: string }[] | undefined)?.[0]?.text ?? "")
        .join(","),
    );
  const columnIds = (block: FakeBlock) =>
    (JSON.parse(block.props[TABLE_COLUMNS_PROP] as string) as { id: string }[]).map(({ id }) => id);

  test("moves a row before another one or to the end, keeping identities", () => {
    const editor = new FakeEditor([table(3, 2)]);
    new EditorTableManager(editor, editor.getBlock(uuid(1)) as never).moveRow(2, 0);
    let next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(next.children.map(({ id }) => id)).toEqual([uuid(12), uuid(10), uuid(11)]);
    expect(texts(next)).toEqual(["r2c0,r2c1", "r0c0,r0c1", "r1c0,r1c1"]);
    expect(editor.log).toEqual(["remove 1", `insert before ${uuid(10)}`]);

    new EditorTableManager(editor, next).moveRow(0, 3);
    next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(next.children.map(({ id }) => id)).toEqual([uuid(10), uuid(11), uuid(12)]);
  });

  test("moves a column in columnsJson and in every row, cells following their column", () => {
    const editor = new FakeEditor([table(2, 3)]);
    new EditorTableManager(editor, editor.getBlock(uuid(1)) as never).moveColumn(0, 3);
    let next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(columnIds(next)).toEqual([uuid(101), uuid(102), uuid(100)]);
    expect(texts(next)).toEqual(["r0c1,r0c2,r0c0", "r1c1,r1c2,r1c0"]);
    expect(next.children[0]?.children.map(({ id }) => id)).toEqual([
      uuid(1001),
      uuid(1002),
      uuid(1000),
    ]);

    new EditorTableManager(editor, next).moveColumn(2, 1);
    next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(columnIds(next)).toEqual([uuid(101), uuid(100), uuid(102)]);
    expect(texts(next)).toEqual(["r0c1,r0c0,r0c2", "r1c1,r1c0,r1c2"]);
  });

  test("ignores drops on either side of the source", () => {
    const editor = new FakeEditor([table(2, 2)]);
    const manager = new EditorTableManager(editor, editor.getBlock(uuid(1)) as never);
    manager.moveRow(0, 0);
    manager.moveRow(0, 1);
    manager.moveColumn(1, 1);
    manager.moveColumn(1, 2);
    expect(editor.log).toEqual([]);
    expect(isNoopTableMove(2, 2)).toBe(true);
    expect(isNoopTableMove(2, 3)).toBe(true);
    expect(isNoopTableMove(2, 4)).toBe(false);
    expect(isNoopTableMove(2, 0)).toBe(false);
  });

  test("snaps the pointer to the nearest insertion slot", () => {
    const edges = [100, 220, 340, 460];
    expect(tableDropIndex(edges, 90)).toBe(0);
    expect(tableDropIndex(edges, 170)).toBe(1);
    expect(tableDropIndex(edges, 290)).toBe(2);
    expect(tableDropIndex(edges, 455)).toBe(3);
    expect(tableDropIndex(edges, 900)).toBe(3);
  });
});

describe("moveTableCellByTab", () => {
  test("moves between cells, appends a row after the last cell, and yields outside tables", () => {
    const editor = new FakeEditor([
      { id: uuid(2), type: "paragraph", props: {}, content: [], children: [] },
      table(1, 2),
    ]);
    editor.cursor = { id: uuid(2), type: "paragraph" };
    expect(moveTableCellByTab(editor, false)).toBe(false);

    editor.cursor = { id: uuid(1000), type: "tableCell" };
    expect(moveTableCellByTab(editor, false)).toBe(true);
    expect(editor.cursor.id).toBe(uuid(1001));
    expect(moveTableCellByTab(editor, true)).toBe(true);
    expect(editor.cursor.id).toBe(uuid(1000));
    expect(moveTableCellByTab(editor, true)).toBe(true);
    expect(editor.cursor.id).toBe(uuid(1000));

    editor.cursor = { id: uuid(1001), type: "tableCell" };
    expect(moveTableCellByTab(editor, false)).toBe(true);
    const next = editor.getBlock(uuid(1)) as FakeBlock;
    expect(next.children).toHaveLength(2);
    expect(editor.cursor.id).toBe(next.children[1]?.children[0]?.id);
  });
});

describe("insertTableCellHardBreak", () => {
  test("inserts a hardBreak inside a table cell and ignores other blocks", () => {
    const dispatched: unknown[] = [];
    const hardBreakNode = { type: "hardBreak" };
    const editor = {
      cursor: { id: uuid(1000), type: "tableCell" } as { id: string; type: string } | null,
      getTextCursorPosition() {
        if (this.cursor === null) throw new Error("no cursor");
        return { block: this.cursor };
      },
      prosemirrorView: {
        state: {
          selection: { empty: true },
          schema: { nodes: { hardBreak: { create: () => hardBreakNode } } },
          tr: {
            deleteSelection() {
              return this;
            },
            replaceSelectionWith(node: unknown) {
              dispatched.push(node);
              return {
                scrollIntoView() {
                  return this;
                },
              };
            },
          },
        },
        dispatch(tr: unknown) {
          dispatched.push(["dispatch", tr]);
        },
      },
    };

    expect(insertTableCellHardBreak(editor)).toBe(true);
    expect(dispatched[0]).toBe(hardBreakNode);

    editor.cursor = { id: uuid(2), type: "paragraph" };
    expect(insertTableCellHardBreak(editor)).toBe(false);
  });
});

describe("table ui state", () => {
  beforeEach(() => resetTableUiState());

  test("publishes hover and layout per table and notifies subscribers", () => {
    let hoverNotifications = 0;
    let layoutNotifications = 0;
    const stopHover = subscribeTableHover(uuid(1), () => {
      hoverNotifications += 1;
    });
    const stopLayout = subscribeTableLayout(uuid(1), () => {
      layoutNotifications += 1;
    });
    setTableHover(uuid(1), { rowIndex: 0, columnIndex: 1 });
    setTableHover(uuid(1), { rowIndex: 0, columnIndex: 1 });
    setTableHover(uuid(2), { rowIndex: 3, columnIndex: 3 });
    expect(hoverNotifications).toBe(1);
    expect(getTableHover(uuid(1))).toEqual({ rowIndex: 0, columnIndex: 1 });
    expect(getTableHover(uuid(3))).toBeNull();
    setTableLayout(uuid(1), editorTableLayout(table(1, 1)));
    expect(layoutNotifications).toBe(1);
    expect(getTableLayout(uuid(1))?.columnCount).toBe(1);
    stopHover();
    stopLayout();
    setTableHover(uuid(1), null);
    expect(hoverNotifications).toBe(1);
  });

  test("publishes a full-height column resize hover per table", () => {
    let notifications = 0;
    const stop = subscribeTableColumnResizeHover(uuid(1), () => {
      notifications += 1;
    });
    setTableColumnResizeHover(uuid(1), 2);
    setTableColumnResizeHover(uuid(1), 2);
    expect(notifications).toBe(1);
    expect(getTableColumnResizeHover(uuid(1))).toBe(2);
    setTableColumnResizeHover(uuid(1), null);
    expect(getTableColumnResizeHover(uuid(1))).toBeNull();
    expect(notifications).toBe(2);
    stop();
  });
});

describe("side-menu anchor", () => {
  test("rows and cells anchor BlockNote's handles on the enclosing table", () => {
    const editor = new FakeEditor([table(1, 1)]);
    const cell = editor.getBlock(uuid(1000));
    const anchor = resolveSideMenuAnchor(editor as unknown as EditorInstance, cell as never);
    expect(anchor?.type).toBe("table");
    expect(anchor?.id).toBe(uuid(1));
    const paragraph = { id: uuid(2), type: "paragraph", props: {}, content: [], children: [] };
    expect(resolveSideMenuAnchor(editor as unknown as EditorInstance, paragraph as never)).toBe(
      paragraph as never,
    );
  });
});

describe("table overflow CSS", () => {
  test("full-main scrollport keeps reading alignment at rest and while scrolling", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(
      new URL("../src/features/editor/editor-table.css", import.meta.url),
      "utf8",
    );
    const outer = css.match(
      /\.page-editor \.bn-block-outer:has\(> \.bn-block > \.node-table\) \{[^}]+\}/u,
    )?.[0];
    const inner = css.match(
      /\.page-editor \.bn-block:has\(> \.node-table\) \{\n {2}--editor-table-rail:[^}]+\}/u,
    )?.[0];
    expect(outer).toMatch(/width:\s*100cqi/u);
    expect(outer).toMatch(/padding-inline-start:\s*var\(--editor-table-gutter-start\)/u);
    expect(outer).toMatch(
      /margin-inline-start:\s*calc\(-1 \* var\(--editor-table-gutter-start\)\)/u,
    );
    expect(outer).toMatch(/overflow-x:\s*auto/u);
    expect(inner).toMatch(/width:\s*max-content/u);
  });
});
