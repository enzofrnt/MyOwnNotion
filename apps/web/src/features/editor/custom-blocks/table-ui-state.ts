/**
 * Per-table UI state shared by the table node view and its cells — the
 * BlockNote analogue of AFFiNE's `hoverRowIndex$` / `hoverColumnIndex$`
 * signals plus the row/column indices the `TableCell` reads from its
 * `TableDataManager`.
 *
 * Lives outside React and outside the ProseMirror DOM. The table node view is
 * the only writer of `layout`; cells publish `hover` on pointer enter/leave.
 * Nothing here ever touches a DOM attribute of a ProseMirror node, so the
 * editor's DOMObserver never re-renders a block because of it.
 */
export interface TableHoverPosition {
  readonly rowIndex: number;
  readonly columnIndex: number;
}

export interface TableLayout {
  readonly rowCount: number;
  readonly columnCount: number;
  /** Row index of each cell, keyed by cell block id. */
  readonly rowIndexByCell: ReadonlyMap<string, number>;
  /** Column index of each cell, keyed by cell block id. */
  readonly columnIndexByCell: ReadonlyMap<string, number>;
}

export interface TableColumnWidthDraft {
  readonly columnIndex: number;
  readonly width: number;
}

type Listener = () => void;

interface Channel<T> {
  readonly values: Map<string, T>;
  readonly listeners: Map<string, Set<Listener>>;
}

function channel<T>(): Channel<T> {
  return { values: new Map(), listeners: new Map() };
}

const hover = channel<TableHoverPosition>();
const layout = channel<TableLayout>();
const widthDraft = channel<TableColumnWidthDraft>();
/** Column index whose right edge is highlighted for resize (full table height). */
const resizeHover = channel<number>();
const pendingHoverClears = new Map<string, number>();
const pendingResizeHoverClears = new Map<string, number>();

function notify<T>(bucket: Channel<T>, tableId: string): void {
  const listeners = bucket.listeners.get(tableId);
  if (listeners === undefined) return;
  for (const listener of listeners) listener();
}

function subscribe<T>(bucket: Channel<T>, tableId: string, listener: Listener): () => void {
  let listeners = bucket.listeners.get(tableId);
  if (listeners === undefined) {
    listeners = new Set();
    bucket.listeners.set(tableId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = bucket.listeners.get(tableId);
    if (current === undefined) return;
    current.delete(listener);
    if (current.size === 0) bucket.listeners.delete(tableId);
  };
}

function cancelPendingHoverClear(tableId: string): void {
  const pending = pendingHoverClears.get(tableId);
  if (pending === undefined) return;
  cancelAnimationFrame(pending);
  pendingHoverClears.delete(tableId);
}

export function setTableHover(tableId: string, position: TableHoverPosition | null): void {
  cancelPendingHoverClear(tableId);
  const current = hover.values.get(tableId) ?? null;
  if (
    current === position ||
    (current !== null &&
      position !== null &&
      current.rowIndex === position.rowIndex &&
      current.columnIndex === position.columnIndex)
  ) {
    return;
  }
  if (position === null) hover.values.delete(tableId);
  else hover.values.set(tableId, position);
  notify(hover, tableId);
}

/**
 * Clears the hover on the next frame unless another cell claims it first.
 * Moving between adjacent cells fires leave-then-enter; without the deferral
 * every crossing would publish a null state and re-render the handles twice.
 */
export function clearTableHoverSoon(tableId: string, from: TableHoverPosition): void {
  const current = hover.values.get(tableId);
  if (
    current === undefined ||
    current.rowIndex !== from.rowIndex ||
    current.columnIndex !== from.columnIndex
  ) {
    return;
  }
  cancelPendingHoverClear(tableId);
  if (typeof requestAnimationFrame !== "function") {
    setTableHover(tableId, null);
    return;
  }
  pendingHoverClears.set(
    tableId,
    requestAnimationFrame(() => {
      pendingHoverClears.delete(tableId);
      const latest = hover.values.get(tableId);
      if (
        latest !== undefined &&
        latest.rowIndex === from.rowIndex &&
        latest.columnIndex === from.columnIndex
      ) {
        setTableHover(tableId, null);
      }
    }),
  );
}

export function getTableHover(tableId: string): TableHoverPosition | null {
  return hover.values.get(tableId) ?? null;
}

export function subscribeTableHover(tableId: string, listener: Listener): () => void {
  return subscribe(hover, tableId, listener);
}

export function setTableLayout(tableId: string, next: TableLayout | null): void {
  if (next === null) {
    if (!layout.values.has(tableId)) return;
    layout.values.delete(tableId);
  } else {
    layout.values.set(tableId, next);
  }
  notify(layout, tableId);
}

export function getTableLayout(tableId: string): TableLayout | null {
  return layout.values.get(tableId) ?? null;
}

export function subscribeTableLayout(tableId: string, listener: Listener): () => void {
  return subscribe(layout, tableId, listener);
}

/** Live preview while dragging a column separator — not persisted. */
export function setTableColumnWidthDraft(
  tableId: string,
  draft: TableColumnWidthDraft | null,
): void {
  if (draft === null) {
    if (!widthDraft.values.has(tableId)) return;
    widthDraft.values.delete(tableId);
  } else {
    const current = widthDraft.values.get(tableId);
    if (
      current !== undefined &&
      current.columnIndex === draft.columnIndex &&
      current.width === draft.width
    ) {
      return;
    }
    widthDraft.values.set(tableId, draft);
  }
  notify(widthDraft, tableId);
}

export function getTableColumnWidthDraft(tableId: string): TableColumnWidthDraft | null {
  return widthDraft.values.get(tableId) ?? null;
}

export function subscribeTableColumnWidthDraft(tableId: string, listener: Listener): () => void {
  return subscribe(widthDraft, tableId, listener);
}

function cancelPendingResizeHoverClear(tableId: string): void {
  const pending = pendingResizeHoverClears.get(tableId);
  if (pending === undefined) return;
  cancelAnimationFrame(pending);
  pendingResizeHoverClears.delete(tableId);
}

/** Highlights the full-height separator of one column while a resize handle is hovered. */
export function setTableColumnResizeHover(tableId: string, columnIndex: number | null): void {
  cancelPendingResizeHoverClear(tableId);
  const current = resizeHover.values.get(tableId);
  if (columnIndex === null) {
    if (current === undefined) return;
    resizeHover.values.delete(tableId);
  } else {
    if (current === columnIndex) return;
    resizeHover.values.set(tableId, columnIndex);
  }
  notify(resizeHover, tableId);
}

/**
 * Clears the resize-column highlight on the next frame unless another handle
 * on the same column claims it (leave-then-enter between stacked cells).
 */
export function clearTableColumnResizeHoverSoon(tableId: string, columnIndex: number): void {
  const current = resizeHover.values.get(tableId);
  if (current !== columnIndex) return;
  cancelPendingResizeHoverClear(tableId);
  if (typeof requestAnimationFrame !== "function") {
    setTableColumnResizeHover(tableId, null);
    return;
  }
  pendingResizeHoverClears.set(
    tableId,
    requestAnimationFrame(() => {
      pendingResizeHoverClears.delete(tableId);
      if (resizeHover.values.get(tableId) === columnIndex) {
        setTableColumnResizeHover(tableId, null);
      }
    }),
  );
}

export function getTableColumnResizeHover(tableId: string): number | null {
  return resizeHover.values.get(tableId) ?? null;
}

export function subscribeTableColumnResizeHover(tableId: string, listener: Listener): () => void {
  return subscribe(resizeHover, tableId, listener);
}

/** Test helper — forgets every table. */
export function resetTableUiState(): void {
  for (const pending of pendingHoverClears.values()) cancelAnimationFrame(pending);
  for (const pending of pendingResizeHoverClears.values()) cancelAnimationFrame(pending);
  pendingHoverClears.clear();
  pendingResizeHoverClears.clear();
  hover.values.clear();
  hover.listeners.clear();
  layout.values.clear();
  layout.listeners.clear();
  widthDraft.values.clear();
  widthDraft.listeners.clear();
  resizeHover.values.clear();
  resizeHover.listeners.clear();
}
