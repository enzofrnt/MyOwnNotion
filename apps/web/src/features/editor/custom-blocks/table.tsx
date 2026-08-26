import type { PartialBlock } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { generateUuidV7, isUuid, type TableColumnV3 } from "@myownnotion/domain";
import { FR_COPY } from "../../../ui/copy/fr.ts";

export const TABLE_COLUMNS_PROP = "columnsJson";

interface TableEditorBlock {
  readonly id: string;
  readonly type: string;
  readonly children: readonly TableEditorBlock[];
}

interface TableEditorApi {
  insertBlocks(blocks: unknown[], reference: string, placement: "before" | "after"): unknown;
  removeBlocks(blockIds: string[]): unknown;
  updateBlock(blockId: string, update: unknown): unknown;
  getParentBlock(blockId: string): TableEditorBlock | undefined;
  setTextCursorPosition(blockId: string, placement: "start" | "end"): unknown;
  nestBlock(): unknown;
  transact(apply: () => void): unknown;
}

export function serialiseEditorTableColumns(columns: readonly TableColumnV3[]): string {
  return JSON.stringify(columns);
}

export function parseEditorTableColumns(value: unknown): readonly TableColumnV3[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 50) return null;
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
          (typeof width !== "number" || !Number.isInteger(width) || width < 80 || width > 1_200))
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

function newCell(): Record<string, unknown> {
  return { id: generateUuidV7(), type: "tableCell", content: [] };
}

function newRow(columnCount: number): Record<string, unknown> {
  return {
    id: generateUuidV7(),
    type: "tableRow",
    children: Array.from({ length: columnCount }, newCell),
  };
}

export function createEditorTable(rowCount = 2, columnCount = 3): PartialBlock {
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 10_000) {
    throw new RangeError("A table must contain between 1 and 10000 rows.");
  }
  if (!Number.isInteger(columnCount) || columnCount < 1 || columnCount > 50) {
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

export const tableBlockSpec = createReactBlockSpec(
  {
    type: "table",
    propSchema: { [TABLE_COLUMNS_PROP]: { default: "[]" } },
    content: "none",
  } as const,
  {
    meta: { isolating: true },
    render: ({ block, editor }) => {
      const table = block as unknown as TableEditorBlock;
      const tableEditor = editor as unknown as TableEditorApi;
      const columns = parseEditorTableColumns(block.props[TABLE_COLUMNS_PROP]) ?? [];
      const rows = table.children.filter((child) => child.type === "tableRow");

      const addRow = (): void => {
        if (rows.length >= 10_000) return;
        const row = newRow(Math.max(1, columns.length));
        const last = rows.at(-1);
        tableEditor.insertBlocks([row], last?.id ?? block.id, "after");
        if (last === undefined) {
          tableEditor.setTextCursorPosition(row["id"] as string, "start");
          tableEditor.nestBlock();
        }
      };

      const addColumn = (): void => {
        if (columns.length >= 50) return;
        const next = [...columns, { id: generateUuidV7(), width: null }];
        tableEditor.transact(() => {
          tableEditor.updateBlock(block.id, {
            props: { [TABLE_COLUMNS_PROP]: serialiseEditorTableColumns(next) },
          });
          for (const row of rows) {
            const lastCell = row.children.filter((child) => child.type === "tableCell").at(-1);
            if (lastCell !== undefined) {
              tableEditor.insertBlocks([newCell()], lastCell.id, "after");
            }
          }
        });
      };

      const removeLastRow = (): void => {
        const last = rows.at(-1);
        if (rows.length > 1 && last !== undefined) tableEditor.removeBlocks([last.id]);
      };

      const removeLastColumn = (): void => {
        if (columns.length <= 1) return;
        tableEditor.transact(() => {
          tableEditor.updateBlock(block.id, {
            props: {
              [TABLE_COLUMNS_PROP]: serialiseEditorTableColumns(columns.slice(0, -1)),
            },
          });
          const cellIds = rows
            .map((row) => row.children.filter((child) => child.type === "tableCell").at(-1)?.id)
            .filter((id): id is string => id !== undefined);
          if (cellIds.length > 0) tableEditor.removeBlocks(cellIds);
        });
      };

      return (
        <div
          className="editor-table-toolbar"
          contentEditable={false}
          role="toolbar"
          aria-label={FR_COPY.editor.richBlocks.table.actions}
        >
          <span>
            {FR_COPY.editor.richBlocks.table.name} · {rows.length}{" "}
            {rows.length > 1
              ? FR_COPY.editor.richBlocks.table.rows
              : FR_COPY.editor.richBlocks.table.row}{" "}
            · {columns.length}{" "}
            {columns.length > 1
              ? FR_COPY.editor.richBlocks.table.columns
              : FR_COPY.editor.richBlocks.table.column}
          </span>
          <button type="button" disabled={rows.length >= 10_000} onClick={addRow}>
            {FR_COPY.editor.richBlocks.table.addRow}
          </button>
          <button type="button" disabled={columns.length >= 50} onClick={addColumn}>
            {FR_COPY.editor.richBlocks.table.addColumn}
          </button>
          <button type="button" disabled={rows.length <= 1} onClick={removeLastRow}>
            {FR_COPY.editor.richBlocks.table.removeLastRow}
          </button>
          <button type="button" disabled={columns.length <= 1} onClick={removeLastColumn}>
            {FR_COPY.editor.richBlocks.table.removeLastColumn}
          </button>
        </div>
      );
    },
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
    meta: { isolating: false },
    render: ({ block, contentRef, editor }) => {
      const tableEditor = editor as unknown as TableEditorApi;
      const moveByTab = (backwards: boolean): boolean => {
        const row = tableEditor.getParentBlock(block.id);
        const table = row === undefined ? undefined : tableEditor.getParentBlock(row.id);
        if (row?.type !== "tableRow" || table?.type !== "table") return false;
        const cells = table.children
          .filter((candidate) => candidate.type === "tableRow")
          .flatMap((candidate) =>
            candidate.children.filter((candidateCell) => candidateCell.type === "tableCell"),
          );
        const index = cells.findIndex(({ id }) => id === block.id);
        const target = cells[index + (backwards ? -1 : 1)];
        if (target !== undefined) {
          tableEditor.setTextCursorPosition(target.id, backwards ? "end" : "start");
          return true;
        }
        if (backwards || index < 0 || row.id !== table.children.at(-1)?.id) return false;
        if (table.children.filter((candidate) => candidate.type === "tableRow").length >= 10_000) {
          return false;
        }
        const appended = newRow(Math.max(1, row.children.length));
        tableEditor.insertBlocks([appended], row.id, "after");
        const firstCell = (appended["children"] as Array<Record<string, unknown>> | undefined)?.[0];
        if (typeof firstCell?.["id"] === "string") {
          tableEditor.setTextCursorPosition(firstCell["id"], "start");
        }
        return true;
      };

      return (
        // biome-ignore lint/a11y/useSemanticElements: BlockNote requires its rich contentRef on a contenteditable div, not an input or textarea.
        <div
          className="editor-table-cell"
          role="textbox"
          aria-label={FR_COPY.editor.richBlocks.table.cell}
          aria-multiline="false"
          tabIndex={0}
          ref={contentRef}
          onKeyDown={(event) => {
            if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
            if (moveByTab(event.shiftKey)) event.preventDefault();
          }}
        />
      );
    },
    toExternalHTML: ({ contentRef }) => <div data-table-cell="true" ref={contentRef} />,
  },
);
