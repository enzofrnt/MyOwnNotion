/**
 * Table blocks — AFFiNE's table UI on top of BlockNote's block tree.
 *
 * Operational model (unchanged): `table` (columns in `columnsJson`) ›
 * `tableRow` › `tableCell` blocks with stable identities so undo, CRDT sync
 * and the editor adapter keep working.
 *
 * Rendering follows AFFiNE's split (see docs/design/affine-table-ui.md):
 * - the `table` node view is the `TableBlock` wrapper: the two `+` rails and
 *   the shared column tracks, published through a `<style>` scoped to this
 *   table so every row grid aligns without touching the parent DOM;
 * - each `tableCell` node view is AFFiNE's `TableCell`: rich text plus the `⋯`
 *   column handle on the first row and the `⋯` row handle on the first
 *   column, revealed by the shared hover state. The `⋯` is also the drag
 *   handle that reorders rows and columns (10px threshold, preview + drop
 *   indicator in the top layer);
 * - `EditorTableManager` is the `TableDataManager`: every structural action is
 *   one BlockNote transaction the adapter already knows how to translate
 *   (insert/delete/move row and column).
 *
 * Hard rules learned from the RAM crashes: never mutate the DOM of a
 * ProseMirror node outside our own node view, keep `:has()` off the cells,
 * and render menus with the native popover API instead of a portal.
 */
import type { PartialBlock } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { generateUuidV7, isUuid, type TableColumnV3 } from "@myownnotion/domain";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type ToggleEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { AppIcon, type AppIconName } from "../../../ui/icons.tsx";
import {
  clearTableColumnResizeHoverSoon,
  clearTableHoverSoon,
  getTableColumnResizeHover,
  getTableColumnWidthDraft,
  getTableHover,
  getTableLayout,
  setTableColumnResizeHover,
  setTableColumnWidthDraft,
  setTableHover,
  setTableLayout,
  subscribeTableColumnResizeHover,
  subscribeTableColumnWidthDraft,
  subscribeTableHover,
  subscribeTableLayout,
  type TableHoverPosition,
  type TableLayout,
} from "./table-ui-state.ts";

export const TABLE_COLUMNS_PROP = "columnsJson";
/** AFFiNE `DefaultColumnWidth` — fixed track width for row alignment. */
export const DEFAULT_EDITOR_TABLE_COLUMN_WIDTH = 120;
export const MIN_EDITOR_TABLE_COLUMN_WIDTH = 80;
export const MAX_EDITOR_TABLE_COLUMN_WIDTH = 1_200;
export const EDITOR_TABLE_MAX_COLUMNS = 50;
export const EDITOR_TABLE_MAX_ROWS = 10_000;

/** Clamps a dragged width to the domain catalogue (80–1200 px). */
export function clampEditorTableColumnWidth(width: number): number {
  return Math.min(
    MAX_EDITOR_TABLE_COLUMN_WIDTH,
    Math.max(MIN_EDITOR_TABLE_COLUMN_WIDTH, Math.round(width)),
  );
}

interface TableEditorBlock {
  readonly id: string;
  readonly type: string;
  readonly children: readonly TableEditorBlock[];
  readonly props?: Record<string, unknown>;
  readonly content?: unknown;
}

interface TableEditorApi {
  insertBlocks(blocks: unknown[], reference: string, placement: "before" | "after"): unknown;
  removeBlocks(blockIds: string[]): unknown;
  updateBlock(blockId: string, update: unknown): unknown;
  getBlock(blockId: string): TableEditorBlock | undefined;
  getParentBlock(blockId: string): TableEditorBlock | undefined;
  setTextCursorPosition(blockId: string, placement: "start" | "end"): unknown;
  nestBlock(): unknown;
  transact(apply: () => void): unknown;
  onChange(callback: () => void): (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Columns

export function serialiseEditorTableColumns(columns: readonly TableColumnV3[]): string {
  return JSON.stringify(columns);
}

export function parseEditorTableColumns(value: unknown): readonly TableColumnV3[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > EDITOR_TABLE_MAX_COLUMNS) {
      return null;
    }
    const columns: TableColumnV3[] = [];
    const identities = new Set<string>();
    for (const column of parsed) {
      if (column === null || Array.isArray(column) || typeof column !== "object") return null;
      if (Object.keys(column).some((key) => key !== "id" && key !== "width")) return null;
      const id = (column as Record<string, unknown>)["id"];
      const width = (column as Record<string, unknown>)["width"];
      if (
        !isUuid(id) ||
        identities.has(id) ||
        (width !== null &&
          (typeof width !== "number" ||
            !Number.isInteger(width) ||
            width < MIN_EDITOR_TABLE_COLUMN_WIDTH ||
            width > MAX_EDITOR_TABLE_COLUMN_WIDTH))
      ) {
        return null;
      }
      identities.add(id);
      columns.push({ id, width });
    }
    return columns;
  } catch {
    return null;
  }
}

/** `grid-template-columns` shared by every row of one table. */
export function editorTableGridTemplate(
  columns: readonly TableColumnV3[],
  columnCount = columns.length,
  draft?: { readonly columnIndex: number; readonly width: number } | null,
): string {
  const count = Math.max(1, columnCount);
  return Array.from({ length: count }, (_, index) => {
    const drafted =
      draft !== null && draft !== undefined && draft.columnIndex === index
        ? draft.width
        : undefined;
    const width = drafted ?? columns[index]?.width;
    const px =
      typeof width === "number" && Number.isInteger(width)
        ? width
        : DEFAULT_EDITOR_TABLE_COLUMN_WIDTH;
    return `${px}px`;
  }).join(" ");
}

/**
 * Rule applied to the row grids of one table. Rendered inside the table node
 * view (our DOM) and targeted by the block id BlockNote already places on the
 * block container, so column widths reach every row without any script
 * touching the ProseMirror DOM.
 */
export function editorTableTrackRule(tableId: string, template: string): string {
  const id = tableId.replace(/["\\]/g, "");
  return `.page-editor .bn-block[data-id="${id}"] > .bn-block-group > .bn-block-outer > .bn-block > .bn-block-group{grid-template-columns:${template};}`;
}

// ---------------------------------------------------------------------------
// Model helpers

function newCell(content: unknown = []): Record<string, unknown> {
  return { id: generateUuidV7(), type: "tableCell", content };
}

function newRow(columnCount: number, contents?: readonly unknown[]): Record<string, unknown> {
  return {
    id: generateUuidV7(),
    type: "tableRow",
    children: Array.from({ length: columnCount }, (_, index) => newCell(contents?.[index] ?? [])),
  };
}

export function createEditorTable(rowCount = 2, columnCount = 3): PartialBlock {
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > EDITOR_TABLE_MAX_ROWS) {
    throw new RangeError("A table must contain between 1 and 10000 rows.");
  }
  if (!Number.isInteger(columnCount) || columnCount < 1 || columnCount > EDITOR_TABLE_MAX_COLUMNS) {
    throw new RangeError("A table must contain between 1 and 50 columns.");
  }
  const columns = Array.from({ length: columnCount }, () => ({
    id: generateUuidV7(),
    width: null,
  }));
  return {
    id: generateUuidV7(),
    type: "table",
    props: { [TABLE_COLUMNS_PROP]: serialiseEditorTableColumns(columns) },
    children: Array.from({ length: rowCount }, () => newRow(columnCount)),
  } as unknown as PartialBlock;
}

function tableRows(table: TableEditorBlock): readonly TableEditorBlock[] {
  return table.children.filter((child) => child.type === "tableRow");
}

function rowCells(row: TableEditorBlock): readonly TableEditorBlock[] {
  return row.children.filter((child) => child.type === "tableCell");
}

/**
 * Cells are the visible truth: a `columnsJson` entry without cells (left by an
 * older gesture) must not draw a phantom track. The manager trims such
 * entries the next time the user changes the columns.
 */
function tableColumnCount(table: TableEditorBlock, columns: readonly TableColumnV3[]): number {
  const firstRow = tableRows(table)[0];
  const cellCount = firstRow === undefined ? 0 : rowCells(firstRow).length;
  return Math.max(1, cellCount > 0 ? cellCount : columns.length);
}

/** Layout the cells read to know whether they carry a `⋯` handle. */
export function editorTableLayout(table: TableEditorBlock): TableLayout {
  const rows = tableRows(table);
  const rowIndexByCell = new Map<string, number>();
  const columnIndexByCell = new Map<string, number>();
  let columnCount = 0;
  rows.forEach((row, rowIndex) => {
    const cells = rowCells(row);
    columnCount = Math.max(columnCount, cells.length);
    cells.forEach((cell, columnIndex) => {
      rowIndexByCell.set(cell.id, rowIndex);
      columnIndexByCell.set(cell.id, columnIndex);
    });
  });
  return { rowCount: rows.length, columnCount, rowIndexByCell, columnIndexByCell };
}

function structureSignature(table: TableEditorBlock | undefined): string {
  if (table === undefined) return "";
  const columnsJson = table.props?.[TABLE_COLUMNS_PROP];
  const rows = tableRows(table)
    .map((row) => `${row.id}:${rowCells(row).length}`)
    .join(",");
  return `${typeof columnsJson === "string" ? columnsJson : ""}|${rows}`;
}

// ---------------------------------------------------------------------------
// Moves — shared by the ⋯ drag and the menu entries

/** AFFiNE starts a row/column drag after roughly this many pixels. */
export const TABLE_DRAG_THRESHOLD_PX = 10;

/** `toIndex` is an insertion slot: dropping on either side of the source changes nothing. */
export function isNoopTableMove(fromIndex: number, toIndex: number): boolean {
  return toIndex === fromIndex || toIndex === fromIndex + 1;
}

/**
 * Insertion slot closest to the pointer. `edges` holds the leading edge of
 * every track plus the trailing edge of the last one, in viewport pixels.
 */
export function tableDropIndex(edges: readonly number[], pointer: number): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, edge] of edges.entries()) {
    const candidate = Math.abs(edge - pointer);
    if (candidate < distance) {
      distance = candidate;
      best = index;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Manager — AFFiNE `TableDataManager` over BlockNote transactions

export class EditorTableManager {
  readonly columns: readonly TableColumnV3[];
  readonly rows: readonly TableEditorBlock[];
  readonly columnCount: number;

  constructor(
    private readonly editor: TableEditorApi,
    private readonly table: TableEditorBlock,
  ) {
    this.columns = parseEditorTableColumns(table.props?.[TABLE_COLUMNS_PROP]) ?? [];
    this.rows = tableRows(table);
    this.columnCount = tableColumnCount(table, this.columns);
  }

  get canAddRow(): boolean {
    return this.rows.length < EDITOR_TABLE_MAX_ROWS;
  }

  get canAddColumn(): boolean {
    return this.columnCount < EDITOR_TABLE_MAX_COLUMNS;
  }

  get canDeleteRow(): boolean {
    return this.rows.length > 1;
  }

  get canDeleteColumn(): boolean {
    return this.columnCount > 1;
  }

  /** Inserts an empty row before `index`; `index === rows.length` appends. */
  insertRow(index: number, contents?: readonly unknown[]): void {
    if (!this.canAddRow) return;
    const row = newRow(this.columnCount, contents);
    const before = this.rows[index];
    const last = this.rows.at(-1);
    if (before !== undefined) {
      this.editor.insertBlocks([row], before.id, "before");
    } else if (last !== undefined) {
      this.editor.insertBlocks([row], last.id, "after");
    } else {
      this.editor.insertBlocks([row], this.table.id, "after");
      this.editor.setTextCursorPosition(row["id"] as string, "start");
      this.editor.nestBlock();
    }
    this.focusCell(row, 0);
  }

  duplicateRow(index: number): void {
    const source = this.rows[index];
    if (source === undefined) return;
    this.insertRow(
      index + 1,
      rowCells(source).map((cell) => cell.content ?? []),
    );
  }

  clearRow(index: number): void {
    const row = this.rows[index];
    if (row === undefined) return;
    this.editor.transact(() => {
      for (const cell of rowCells(row)) this.editor.updateBlock(cell.id, { content: [] });
    });
  }

  deleteRow(index: number): void {
    const row = this.rows[index];
    if (row === undefined || !this.canDeleteRow) return;
    this.editor.removeBlocks([row.id]);
  }

  /** Inserts an empty column before `index`; `index === columnCount` appends. */
  insertColumn(index: number, focusRowIndex = 0): void {
    if (!this.canAddColumn) return;
    const column: TableColumnV3 = { id: generateUuidV7(), width: null };
    const next = this.columns.slice(0, this.columnCount);
    next.splice(Math.min(index, next.length), 0, column);
    const createdCells: Record<string, unknown>[] = [];
    this.editor.transact(() => {
      this.editor.updateBlock(this.table.id, {
        props: { [TABLE_COLUMNS_PROP]: serialiseEditorTableColumns(next) },
      });
      for (const row of this.rows) {
        const cells = rowCells(row);
        const cell = newCell();
        createdCells.push(cell);
        const before = cells[index];
        const last = cells.at(-1);
        if (before !== undefined) this.editor.insertBlocks([cell], before.id, "before");
        else if (last !== undefined) this.editor.insertBlocks([cell], last.id, "after");
      }
    });
    const focus = createdCells[focusRowIndex] ?? createdCells[0];
    if (typeof focus?.["id"] === "string") {
      this.editor.setTextCursorPosition(focus["id"], "start");
    }
  }

  clearColumn(index: number): void {
    this.editor.transact(() => {
      for (const row of this.rows) {
        const cell = rowCells(row)[index];
        if (cell !== undefined) this.editor.updateBlock(cell.id, { content: [] });
      }
    });
  }

  deleteColumn(index: number): void {
    if (!this.canDeleteColumn || index < 0 || index >= this.columnCount) return;
    const next = this.columns
      .slice(0, this.columnCount)
      .filter((_, candidate) => candidate !== index);
    const cellIds = this.rows
      .map((row) => rowCells(row)[index]?.id)
      .filter((id): id is string => typeof id === "string");
    this.editor.transact(() => {
      this.editor.updateBlock(this.table.id, {
        props: { [TABLE_COLUMNS_PROP]: serialiseEditorTableColumns(next) },
      });
      if (cellIds.length > 0) this.editor.removeBlocks(cellIds);
    });
  }

  /**
   * Places the row at `fromIndex` before the row currently at `toIndex`
   * (`toIndex === rows.length` moves it last). Re-inserting the same block
   * inside one transaction is what BlockNote reports as a `move`, which the
   * adapter turns into `move-table-row`.
   */
  moveRow(fromIndex: number, toIndex: number): void {
    const row = this.rows[fromIndex];
    if (row === undefined || isNoopTableMove(fromIndex, toIndex)) return;
    const target = this.rows[toIndex];
    const last = this.rows.at(-1);
    if (target === undefined && (last === undefined || last.id === row.id)) return;
    this.editor.transact(() => {
      this.editor.removeBlocks([row.id]);
      if (target !== undefined) this.editor.insertBlocks([row], target.id, "before");
      else if (last !== undefined) this.editor.insertBlocks([row], last.id, "after");
    });
    // Re-inserting leaves ProseMirror with a node selection on the table;
    // AFFiNE keeps the moved row active instead.
    this.focusCell(row as unknown as Record<string, unknown>, 0);
  }

  /** Column counterpart of `moveRow`: reorders `columnsJson` and every row's cells. */
  moveColumn(fromIndex: number, toIndex: number): void {
    if (isNoopTableMove(fromIndex, toIndex) || toIndex < 0 || toIndex > this.columnCount) return;
    const next = this.columns.slice(0, this.columnCount);
    const [column] = next.splice(fromIndex, 1);
    if (column === undefined) return;
    next.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, column);
    this.editor.transact(() => {
      this.editor.updateBlock(this.table.id, {
        props: { [TABLE_COLUMNS_PROP]: serialiseEditorTableColumns(next) },
      });
      for (const row of this.rows) {
        const cells = rowCells(row);
        const cell = cells[fromIndex];
        if (cell === undefined) continue;
        const target = cells[toIndex];
        const last = cells.at(-1);
        this.editor.removeBlocks([cell.id]);
        if (target !== undefined) this.editor.insertBlocks([cell], target.id, "before");
        else if (last !== undefined && last.id !== cell.id) {
          this.editor.insertBlocks([cell], last.id, "after");
        }
      }
    });
    const firstRow = this.rows[0];
    const movedCell = firstRow === undefined ? undefined : rowCells(firstRow)[fromIndex];
    if (movedCell !== undefined) this.editor.setTextCursorPosition(movedCell.id, "start");
  }

  /** Persists one column width; `null` restores the default track. */
  resizeColumn(index: number, width: number | null): void {
    if (index < 0 || index >= this.columnCount) return;
    const next = this.columns.slice(0, this.columnCount).map((column, candidate) =>
      candidate === index
        ? {
            id: column.id,
            width: width === null ? null : clampEditorTableColumnWidth(width),
          }
        : column,
    );
    const current = this.columns[index];
    if (current === undefined || current.width === next[index]?.width) return;
    this.editor.updateBlock(this.table.id, {
      props: { [TABLE_COLUMNS_PROP]: serialiseEditorTableColumns(next) },
    });
  }

  private focusCell(row: Record<string, unknown>, columnIndex: number): void {
    const cells = row["children"] as Array<Record<string, unknown>> | undefined;
    const cell = cells?.[columnIndex];
    if (typeof cell?.["id"] === "string") this.editor.setTextCursorPosition(cell["id"], "start");
  }
}

// ---------------------------------------------------------------------------
// Keyboard — Tab / Shift+Tab between cells (AFFiNE moves the selection; the
// last cell appends a row)

interface TableCursorApi extends TableEditorApi {
  getTextCursorPosition(): { readonly block: { readonly id: string; readonly type: string } };
}

/**
 * Moves the caret to the previous/next cell. Returns false when the caret is
 * not inside a table cell so BlockNote's own Tab behaviour applies.
 */
export function moveTableCellByTab(
  editor: unknown,
  backwards: boolean,
  focusedCellId?: string,
): boolean {
  const api = editor as TableCursorApi;
  // Firefox can focus a nested cell content node without updating BlockNote's
  // text cursor. The keyboard listener supplies the focused block id from the
  // node view, which is still checked against the current document below.
  const cursorBlock =
    focusedCellId === undefined ? api.getTextCursorPosition().block : api.getBlock(focusedCellId);
  if (cursorBlock === undefined) return false;
  if (cursorBlock.type !== "tableCell") return false;
  const row = api.getParentBlock(cursorBlock.id);
  const table = row?.type === "tableRow" ? api.getParentBlock(row.id) : undefined;
  if (table?.type !== "table") return false;
  const rows = tableRows(table);
  const cells = rows.flatMap((candidate) => rowCells(candidate));
  const index = cells.findIndex(({ id }) => id === cursorBlock.id);
  const target = cells[index + (backwards ? -1 : 1)];
  if (target !== undefined) {
    api.setTextCursorPosition(target.id, backwards ? "end" : "start");
    return true;
  }
  if (backwards || index < 0) return true;
  const manager = new EditorTableManager(api, table);
  if (manager.canAddRow) manager.insertRow(rows.length);
  return true;
}

/**
 * Shift+Enter inside a cell inserts a hard line break (grows the row) instead
 * of leaving the cell. Returns false outside table cells so BlockNote’s
 * default Shift+Enter applies.
 */
export function insertTableCellHardBreak(editor: unknown): boolean {
  const api = editor as TableCursorApi & {
    readonly prosemirrorView: {
      readonly state: {
        readonly selection: { readonly empty: boolean };
        readonly schema: {
          readonly nodes: { readonly hardBreak?: { create(): unknown } };
        };
        readonly tr: {
          deleteSelection(): unknown;
          replaceSelectionWith(
            node: unknown,
            inheritMarks?: boolean,
          ): {
            scrollIntoView(): unknown;
          };
        };
      };
      dispatch(tr: unknown): void;
    };
  };
  try {
    if (api.getTextCursorPosition().block.type !== "tableCell") return false;
  } catch {
    return false;
  }
  const { state, dispatch } = api.prosemirrorView;
  const hardBreak = state.schema.nodes.hardBreak;
  if (hardBreak === undefined) return false;
  const tr = state.tr;
  if (!state.selection.empty) tr.deleteSelection();
  dispatch(tr.replaceSelectionWith(hardBreak.create(), false).scrollIntoView());
  return true;
}

// ---------------------------------------------------------------------------
// Shared-state hooks

function useTableHover(tableId: string): TableHoverPosition | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeTableHover(tableId, listener),
    [tableId],
  );
  return useSyncExternalStore(
    subscribe,
    () => getTableHover(tableId),
    () => null,
  );
}

function useTableLayout(tableId: string | null): TableLayout | null {
  const subscribe = useCallback(
    (listener: () => void) =>
      tableId === null ? () => undefined : subscribeTableLayout(tableId, listener),
    [tableId],
  );
  return useSyncExternalStore(
    subscribe,
    () => (tableId === null ? null : getTableLayout(tableId)),
    () => null,
  );
}

function useTableColumnWidthDraft(
  tableId: string,
): { readonly columnIndex: number; readonly width: number } | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeTableColumnWidthDraft(tableId, listener),
    [tableId],
  );
  return useSyncExternalStore(
    subscribe,
    () => getTableColumnWidthDraft(tableId),
    () => null,
  );
}

function useTableColumnResizeHover(tableId: string): number | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeTableColumnResizeHover(tableId, listener),
    [tableId],
  );
  return useSyncExternalStore(
    subscribe,
    () => getTableColumnResizeHover(tableId),
    () => null,
  );
}

/**
 * The `table` node is a leaf: ProseMirror does not re-render it when rows or
 * cells change underneath. Follow the document instead and refresh only when
 * the structure (rows, cell counts, columns) actually moved.
 */
function useLiveTableBlock(editor: TableEditorApi, tableId: string): TableEditorBlock | undefined {
  const read = useCallback(() => editor.getBlock(tableId), [editor, tableId]);
  const [table, setTable] = useState(read);
  const signature = useRef(structureSignature(table));
  useEffect(() => {
    const refresh = (): void => {
      const next = read();
      const nextSignature = structureSignature(next);
      if (nextSignature === signature.current) return;
      signature.current = nextSignature;
      setTable(next);
    };
    refresh();
    return editor.onChange(refresh);
  }, [editor, read]);
  return table;
}

// ---------------------------------------------------------------------------
// Table node view — wrapper: rails + shared tracks

function preventEditorSelection(event: PointerEvent<HTMLElement>): void {
  // Buttons live inside the contenteditable root; a default mousedown would
  // move the ProseMirror selection onto the button and drop the caret.
  event.preventDefault();
}

/**
 * AFFiNE column-resize hit target on the right edge of a cell. Preview widths
 * live in table-ui-state; persistence happens once on pointerup. Hovering any
 * cell's handle highlights the same edge on every row of that column.
 */
function ColumnResizeHandle({
  editor,
  tableId,
  columnIndex,
}: {
  readonly editor: TableEditorApi;
  readonly tableId: string;
  readonly columnIndex: number;
}) {
  const copy = FR_COPY.editor.richBlocks.table;
  const resizeHover = useTableColumnResizeHover(tableId);
  const widthDraft = useTableColumnWidthDraft(tableId);
  const highlighted = resizeHover === columnIndex || widthDraft?.columnIndex === columnIndex;
  const drag = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    preventEditorSelection(event);
    event.stopPropagation();
    const table = editor.getBlock(tableId);
    if (table?.type !== "table") return;
    const manager = new EditorTableManager(editor, table);
    const column = manager.columns[columnIndex];
    const startWidth =
      typeof column?.width === "number" && Number.isInteger(column.width)
        ? column.width
        : DEFAULT_EDITOR_TABLE_COLUMN_WIDTH;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setTableColumnResizeHover(tableId, columnIndex);
    setTableColumnWidthDraft(tableId, { columnIndex, width: startWidth });
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const width = clampEditorTableColumnWidth(
      current.startWidth + (event.clientX - current.startX),
    );
    setTableColumnWidthDraft(tableId, { columnIndex, width });
  };

  const finish = (event: PointerEvent<HTMLButtonElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const draft = getTableColumnWidthDraft(tableId);
    if (draft === null || draft.columnIndex !== columnIndex) {
      setTableColumnWidthDraft(tableId, null);
      setTableColumnResizeHover(tableId, null);
      return;
    }
    const table = editor.getBlock(tableId);
    if (table?.type === "table") {
      new EditorTableManager(editor, table).resizeColumn(columnIndex, draft.width);
    }
    setTableColumnWidthDraft(tableId, null);
    setTableColumnResizeHover(tableId, null);
  };

  return (
    <button
      type="button"
      className="editor-table-resize"
      data-testid="editor-table-resize"
      data-highlight={highlighted ? "" : undefined}
      aria-label={copy.resizeColumn}
      title={copy.resizeColumn}
      onPointerEnter={() => setTableColumnResizeHover(tableId, columnIndex)}
      onPointerLeave={() => clearTableColumnResizeHoverSoon(tableId, columnIndex)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  );
}

function TableBlockView({
  block,
  editor,
}: {
  readonly block: { readonly id: string };
  readonly editor: unknown;
}) {
  const tableEditor = editor as TableEditorApi;
  const table = useLiveTableBlock(tableEditor, block.id);
  const hover = useTableHover(block.id);
  const draft = useTableColumnWidthDraft(block.id);
  const copy = FR_COPY.editor.richBlocks.table;

  useLayoutEffect(() => {
    setTableLayout(block.id, table === undefined ? null : editorTableLayout(table));
  }, [block.id, table]);
  useEffect(() => () => setTableLayout(block.id, null), [block.id]);

  if (table === undefined) return null;
  const manager = new EditorTableManager(tableEditor, table);
  const template = editorTableGridTemplate(manager.columns, manager.columnCount, draft);

  return (
    <div
      className="editor-table-chrome"
      contentEditable={false}
      data-testid="editor-table-chrome"
      data-resizing={draft !== null ? "" : undefined}
    >
      <style>{editorTableTrackRule(block.id, template)}</style>
      <button
        type="button"
        className="editor-table-rail editor-table-rail--column"
        data-testid="editor-table-add-column"
        aria-label={copy.addColumn}
        title={copy.addColumn}
        disabled={!manager.canAddColumn}
        onPointerDown={preventEditorSelection}
        onClick={() => manager.insertColumn(manager.columnCount, hover?.rowIndex ?? 0)}
      >
        <AppIcon name="add" size="small" />
      </button>
      <button
        type="button"
        className="editor-table-rail editor-table-rail--row"
        data-testid="editor-table-add-row"
        aria-label={copy.addRow}
        title={copy.addRow}
        disabled={!manager.canAddRow}
        onPointerDown={preventEditorSelection}
        onClick={() => manager.insertRow(manager.rows.length)}
      >
        <AppIcon name="add" size="small" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// `⋯` handles + native popover menus (AFFiNE `popMenu`)

interface TableMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon: AppIconName;
  readonly run: () => void;
  readonly disabled?: boolean;
  readonly tone?: "danger";
  readonly separatorBefore?: boolean;
}

interface AxisGeometry {
  /** Leading edge of every track plus the trailing edge of the last one. */
  readonly edges: readonly number[];
  /** Viewport box of the dragged row/column. */
  readonly source: DOMRect;
}

function blockOuters(group: Element | null | undefined): HTMLElement[] {
  return group === null || group === undefined
    ? []
    : Array.from(group.children).filter((child): child is HTMLElement =>
        child.classList.contains("bn-block-outer"),
      );
}

/**
 * Reads (never writes) the BlockNote DOM of one table to place the drag
 * preview and the drop indicator in viewport coordinates.
 */
function axisGeometry(tableId: string, axis: "row" | "column", index: number): AxisGeometry | null {
  const id = tableId.replace(/["\\]/g, "");
  const block = document.querySelector<HTMLElement>(`.page-editor .bn-block[data-id="${id}"]`);
  const rowsGroup = block?.querySelector<HTMLElement>(":scope > .bn-block-group") ?? null;
  const rows = blockOuters(rowsGroup);
  const lastRow = rows.at(-1);
  if (rowsGroup === null || lastRow === undefined) return null;
  if (axis === "row") {
    const source = rows[index]?.getBoundingClientRect();
    if (source === undefined) return null;
    return {
      edges: [
        ...rows.map((row) => row.getBoundingClientRect().top),
        lastRow.getBoundingClientRect().bottom,
      ],
      source,
    };
  }
  const cells = blockOuters(rows[0]?.querySelector(":scope > .bn-block > .bn-block-group"));
  const lastCell = cells.at(-1);
  const sourceCell = cells[index]?.getBoundingClientRect();
  if (lastCell === undefined || sourceCell === undefined) return null;
  const groupRect = rowsGroup.getBoundingClientRect();
  return {
    edges: [
      ...cells.map((cell) => cell.getBoundingClientRect().left),
      lastCell.getBoundingClientRect().right,
    ],
    source: new DOMRect(sourceCell.left, groupRect.top, sourceCell.width, groupRect.height),
  };
}

interface AxisDrag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  geometry: AxisGeometry | null;
  target: number | null;
}

function TableAxisHandle({
  axis,
  tableId,
  index,
  label,
  active,
  items,
  onMove,
}: {
  readonly axis: "row" | "column";
  readonly tableId: string;
  readonly index: number;
  readonly label: string;
  readonly active: boolean;
  readonly items: readonly TableMenuItem[];
  readonly onMove: (fromIndex: number, toIndex: number) => void;
}) {
  const menuId = useId();
  const copy = FR_COPY.editor.richBlocks.table;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<AxisDrag | null>(null);
  const suppressClick = useRef(false);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const endDrag = useCallback(
    (commit: boolean): void => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag === null) return;
      const button = buttonRef.current;
      if (button?.hasPointerCapture(drag.pointerId) === true) {
        button.releasePointerCapture(drag.pointerId);
      }
      if (drag.geometry === null) return;
      // The click that follows this pointerup must not reopen the menu.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      setDragging(false);
      const layer = layerRef.current;
      if (layer?.matches(":popover-open") === true) layer.hidePopover();
      if (commit && drag.target !== null && !isNoopTableMove(index, drag.target)) {
        onMove(index, drag.target);
      }
    },
    [index, onMove],
  );

  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") endDrag(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragging, endDrag]);

  const paintDrag = (drag: AxisDrag, event: PointerEvent<HTMLButtonElement>): void => {
    const geometry = drag.geometry;
    const ghost = ghostRef.current;
    const indicator = indicatorRef.current;
    if (geometry === null || ghost === null || indicator === null || drag.target === null) return;
    const { source, edges } = geometry;
    const edge = edges[drag.target] ?? 0;
    if (axis === "column") {
      const offset = event.clientX - drag.startX;
      ghost.style.transform = `translate(${Math.round(source.left + offset)}px, ${Math.round(source.top)}px)`;
      ghost.style.width = `${Math.round(source.width)}px`;
      ghost.style.height = `${Math.round(source.height)}px`;
      indicator.style.transform = `translate(${Math.round(edge - 1)}px, ${Math.round(source.top)}px)`;
      indicator.style.width = "2px";
      indicator.style.height = `${Math.round(source.height)}px`;
    } else {
      const offset = event.clientY - drag.startY;
      ghost.style.transform = `translate(${Math.round(source.left)}px, ${Math.round(source.top + offset)}px)`;
      ghost.style.width = `${Math.round(source.width)}px`;
      ghost.style.height = `${Math.round(source.height)}px`;
      indicator.style.transform = `translate(${Math.round(source.left)}px, ${Math.round(edge - 1)}px)`;
      indicator.style.width = `${Math.round(source.width)}px`;
      indicator.style.height = "2px";
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    preventEditorSelection(event);
    if (event.button !== 0 || open) return;
    buttonRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry: null,
      target: null,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (drag.geometry === null) {
      const travelled = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (travelled < TABLE_DRAG_THRESHOLD_PX) return;
      const geometry = axisGeometry(tableId, axis, index);
      if (geometry === null) {
        dragRef.current = null;
        return;
      }
      drag.geometry = geometry;
      setDragging(true);
      layerRef.current?.showPopover();
    }
    const pointer = axis === "column" ? event.clientX : event.clientY;
    drag.target = tableDropIndex(drag.geometry.edges, pointer);
    paintDrag(drag, event);
  };

  const openMenu = (): void => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (button === null || menu === null) return;
    const anchor = button.getBoundingClientRect();
    menu.style.top = "0px";
    menu.style.left = "0px";
    menu.showPopover();
    const size = menu.getBoundingClientRect();
    const margin = 8;
    let top = axis === "column" ? anchor.bottom + 4 : anchor.top;
    let left = axis === "column" ? anchor.left : anchor.right + 4;
    if (top + size.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - size.height - margin);
    }
    if (left + size.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - size.width - margin);
    }
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  };

  const closeMenu = (): void => {
    const menu = menuRef.current;
    if (menu === null) return;
    if (menu.matches(":popover-open")) menu.hidePopover();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const menu = menuRef.current;
    if (menu === null) return;
    const focusable = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
    const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      focusable.at((index + step) % focusable.length)?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      focusable[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      closeMenu();
    }
  };

  const onToggle = (event: ToggleEvent<HTMLDivElement>): void => {
    const isOpen = event.newState === "open";
    setOpen(isOpen);
    if (!isOpen && menuRef.current?.contains(document.activeElement) === true) {
      buttonRef.current?.focus();
    }
  };

  const onClick = (): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (open) closeMenu();
    else openMenu();
  };

  return (
    <div className="editor-table-handle-slot" data-axis={axis} contentEditable={false}>
      <button
        ref={buttonRef}
        type="button"
        className="editor-table-handle"
        data-axis={axis}
        data-testid={`editor-table-${axis}-handle`}
        data-active={active || open || undefined}
        data-dragging={dragging || undefined}
        aria-label={label}
        title={`${label} · ${copy.dragToMove}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        onClick={onClick}
      >
        <i aria-hidden="true" />
        <i aria-hidden="true" />
        <i aria-hidden="true" />
      </button>
      <div
        ref={layerRef}
        className="editor-table-drag"
        data-axis={axis}
        popover="manual"
        aria-hidden="true"
      >
        <div ref={ghostRef} className="editor-table-drag__ghost" />
        <div ref={indicatorRef} className="editor-table-drag__indicator" />
      </div>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={label}
        className="editor-table-menu"
        popover="auto"
        onToggle={onToggle}
        onKeyDown={onMenuKeyDown}
      >
        {items.map((item) => (
          <TableMenuEntry key={item.key} item={item} close={closeMenu} />
        ))}
      </div>
    </div>
  );
}

function TableMenuEntry({
  item,
  close,
}: {
  readonly item: TableMenuItem;
  readonly close: () => void;
}): ReactNode {
  return (
    <>
      {item.separatorBefore === true && <hr className="editor-table-menu__separator" />}
      <button
        type="button"
        role="menuitem"
        className="editor-table-menu__item"
        data-tone={item.tone}
        disabled={item.disabled === true}
        onClick={() => {
          close();
          item.run();
        }}
      >
        <AppIcon name={item.icon} size="small" />
        <span>{item.label}</span>
      </button>
    </>
  );
}

function ColumnHandle({
  editor,
  tableId,
  columnIndex,
}: {
  readonly editor: TableEditorApi;
  readonly tableId: string;
  readonly columnIndex: number;
}) {
  const hover = useTableHover(tableId);
  const copy = FR_COPY.editor.richBlocks.table;
  const withManager = (action: (manager: EditorTableManager) => void): void => {
    const table = editor.getBlock(tableId);
    if (table !== undefined) action(new EditorTableManager(editor, table));
  };
  const snapshot = editor.getBlock(tableId);
  const manager = snapshot === undefined ? null : new EditorTableManager(editor, snapshot);
  const columnCount = manager?.columnCount ?? 0;
  const items: TableMenuItem[] = [
    {
      key: "insert-left",
      label: copy.insertColumnLeft,
      icon: "add",
      disabled: manager?.canAddColumn === false,
      run: () => withManager((m) => m.insertColumn(columnIndex)),
    },
    {
      key: "insert-right",
      label: copy.insertColumnRight,
      icon: "add",
      disabled: manager?.canAddColumn === false,
      run: () => withManager((m) => m.insertColumn(columnIndex + 1)),
    },
    {
      key: "move-left",
      label: copy.moveColumnLeft,
      icon: "arrowLeft",
      disabled: columnIndex === 0,
      run: () => withManager((m) => m.moveColumn(columnIndex, columnIndex - 1)),
    },
    {
      key: "move-right",
      label: copy.moveColumnRight,
      icon: "arrowRight",
      disabled: columnIndex >= columnCount - 1,
      run: () => withManager((m) => m.moveColumn(columnIndex, columnIndex + 2)),
    },
    {
      key: "clear",
      label: copy.clearColumn,
      icon: "remove",
      separatorBefore: true,
      run: () => withManager((m) => m.clearColumn(columnIndex)),
    },
    {
      key: "delete",
      label: copy.deleteColumn,
      icon: "delete",
      tone: "danger",
      disabled: manager?.canDeleteColumn === false,
      run: () => withManager((m) => m.deleteColumn(columnIndex)),
    },
  ];
  return (
    <TableAxisHandle
      axis="column"
      tableId={tableId}
      index={columnIndex}
      label={copy.columnMenu}
      active={hover?.columnIndex === columnIndex}
      items={items}
      onMove={(from, to) => withManager((m) => m.moveColumn(from, to))}
    />
  );
}

function RowHandle({
  editor,
  tableId,
  rowIndex,
}: {
  readonly editor: TableEditorApi;
  readonly tableId: string;
  readonly rowIndex: number;
}) {
  const hover = useTableHover(tableId);
  const copy = FR_COPY.editor.richBlocks.table;
  const withManager = (action: (manager: EditorTableManager) => void): void => {
    const table = editor.getBlock(tableId);
    if (table !== undefined) action(new EditorTableManager(editor, table));
  };
  const snapshot = editor.getBlock(tableId);
  const manager = snapshot === undefined ? null : new EditorTableManager(editor, snapshot);
  const rowCount = manager?.rows.length ?? 0;
  const items: TableMenuItem[] = [
    {
      key: "insert-above",
      label: copy.insertRowAbove,
      icon: "add",
      disabled: manager?.canAddRow === false,
      run: () => withManager((m) => m.insertRow(rowIndex)),
    },
    {
      key: "insert-below",
      label: copy.insertRowBelow,
      icon: "add",
      disabled: manager?.canAddRow === false,
      run: () => withManager((m) => m.insertRow(rowIndex + 1)),
    },
    {
      key: "duplicate",
      label: copy.duplicateRow,
      icon: "copy",
      disabled: manager?.canAddRow === false,
      run: () => withManager((m) => m.duplicateRow(rowIndex)),
    },
    {
      key: "move-up",
      label: copy.moveRowUp,
      icon: "arrowUp",
      disabled: rowIndex === 0,
      run: () => withManager((m) => m.moveRow(rowIndex, rowIndex - 1)),
    },
    {
      key: "move-down",
      label: copy.moveRowDown,
      icon: "arrowDown",
      disabled: rowIndex >= rowCount - 1,
      run: () => withManager((m) => m.moveRow(rowIndex, rowIndex + 2)),
    },
    {
      key: "clear",
      label: copy.clearRow,
      icon: "remove",
      separatorBefore: true,
      run: () => withManager((m) => m.clearRow(rowIndex)),
    },
    {
      key: "delete",
      label: copy.deleteRow,
      icon: "delete",
      tone: "danger",
      disabled: manager?.canDeleteRow === false,
      run: () => withManager((m) => m.deleteRow(rowIndex)),
    },
  ];
  return (
    <TableAxisHandle
      axis="row"
      tableId={tableId}
      index={rowIndex}
      label={copy.rowMenu}
      active={hover?.rowIndex === rowIndex}
      items={items}
      onMove={(from, to) => withManager((m) => m.moveRow(from, to))}
    />
  );
}

// ---------------------------------------------------------------------------
// Cell node view — AFFiNE `TableCell`

function useOwningTableId(editor: TableEditorApi, cellId: string): string | null {
  // A cell never moves between tables while it exists; resolve once per cell.
  const cache = useRef<{ cellId: string; tableId: string | null } | null>(null);
  if (cache.current === null || cache.current.cellId !== cellId) {
    const row = editor.getParentBlock(cellId);
    const table = row?.type === "tableRow" ? editor.getParentBlock(row.id) : undefined;
    cache.current = { cellId, tableId: table?.type === "table" ? table.id : null };
  }
  return cache.current.tableId;
}

function TableCellView({
  block,
  editor,
  contentRef,
}: {
  readonly block: { readonly id: string };
  readonly editor: unknown;
  readonly contentRef: (element: HTMLElement | null) => void;
}) {
  const tableEditor = editor as TableEditorApi;
  const tableId = useOwningTableId(tableEditor, block.id);
  const layout = useTableLayout(tableId);
  const rowIndex = layout?.rowIndexByCell.get(block.id);
  const columnIndex = layout?.columnIndexByCell.get(block.id);
  const copy = FR_COPY.editor.richBlocks.table;

  const publishHover = (): void => {
    if (tableId === null) return;
    const current = getTableLayout(tableId);
    const row = current?.rowIndexByCell.get(block.id);
    const column = current?.columnIndexByCell.get(block.id);
    if (row === undefined || column === undefined) return;
    setTableHover(tableId, { rowIndex: row, columnIndex: column });
  };
  const releaseHover = (): void => {
    if (tableId === null) return;
    const current = getTableLayout(tableId);
    const row = current?.rowIndexByCell.get(block.id);
    const column = current?.columnIndexByCell.get(block.id);
    if (row === undefined || column === undefined) return;
    clearTableHoverSoon(tableId, { rowIndex: row, columnIndex: column });
  };

  return (
    <div className="editor-table-cell" onPointerEnter={publishHover} onPointerLeave={releaseHover}>
      {/* biome-ignore lint/a11y/useSemanticElements: BlockNote requires its rich contentRef on a contenteditable div, not an input or textarea. */}
      <div
        className="editor-table-cell__content"
        role="textbox"
        aria-label={copy.cell}
        aria-multiline="false"
        tabIndex={0}
        ref={contentRef}
      />
      {tableId !== null && rowIndex === 0 && columnIndex !== undefined && (
        <ColumnHandle editor={tableEditor} tableId={tableId} columnIndex={columnIndex} />
      )}
      {tableId !== null && columnIndex === 0 && rowIndex !== undefined && (
        <RowHandle editor={tableEditor} tableId={tableId} rowIndex={rowIndex} />
      )}
      {tableId !== null && columnIndex !== undefined && (
        <ColumnResizeHandle editor={tableEditor} tableId={tableId} columnIndex={columnIndex} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block specs

export const tableBlockSpec = createReactBlockSpec(
  {
    type: "table",
    propSchema: { [TABLE_COLUMNS_PROP]: { default: "[]" } },
    content: "none",
  } as const,
  {
    meta: { isolating: true },
    render: ({ block, editor }) => <TableBlockView block={block} editor={editor} />,
    toExternalHTML: () => <div>Tableau MyOwnNotion</div>,
  },
);

export const tableRowBlockSpec = createReactBlockSpec(
  { type: "tableRow", propSchema: {}, content: "none" } as const,
  {
    meta: { isolating: true },
    render: () => <div className="editor-table-row-marker" aria-hidden="true" />,
    toExternalHTML: () => <div data-table-row="true" />,
  },
);

export const tableCellBlockSpec = createReactBlockSpec(
  { type: "tableCell", propSchema: {}, content: "inline" } as const,
  {
    meta: { isolating: false, hardBreakShortcut: "shift+enter" },
    render: ({ block, contentRef, editor }) => (
      <TableCellView block={block} editor={editor} contentRef={contentRef} />
    ),
    toExternalHTML: ({ contentRef }) => <div data-table-cell="true" ref={contentRef} />,
  },
);
