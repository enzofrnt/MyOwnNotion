import { createExtension } from "@blocknote/core";
import { insertTableCellHardBreak, moveTableCellByTab } from "./custom-blocks/table.tsx";

/**
 * Tab / Shift+Tab inside a table cell move between cells (and append a row
 * after the last one) instead of BlockNote's indent behaviour, which would
 * try to nest a cell under its neighbour. Shift+Enter inserts a hard break
 * so the cell grows in height. Custom shortcuts run before BlockNote's keymap
 * (priority 50), and each handler yields outside tables.
 */
export const TableKeymapExtension = createExtension({
  key: "tableKeymap",
  keyboardShortcuts: {
    Tab: ({ editor }) => moveTableCellByTab(editor, false),
    "Shift-Tab": ({ editor }) => moveTableCellByTab(editor, true),
    "Shift-Enter": ({ editor }) => insertTableCellHardBreak(editor),
  },
});
