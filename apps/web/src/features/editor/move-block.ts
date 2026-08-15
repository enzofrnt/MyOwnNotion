/**
 * Moving a block (T025, US1, FR-003, FR-004).
 *
 * Tiptap 3 ships no `moveNode` command, so this is written directly against
 * ProseMirror. It goes through `editor.commands.command`, which means the
 * change travels the same transaction pipeline as typing does — and therefore
 * lands in the undo stack without further work. That is what FR-004 requires:
 * every action in FR-003 must be undoable, and a move implemented as a raw
 * document replacement would silently not be.
 *
 * Only top-level blocks move. Moving a nested list item is a different
 * operation with different rules (it can change its parent, and its own
 * children come with it), and Tiptap already provides indent and outdent for
 * that case.
 */

import type { Editor } from "@tiptap/react";

export function moveBlock(editor: Editor, direction: "up" | "down"): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const { $from } = state.selection;
      if ($from.depth < 1) {
        return false;
      }

      const doc = state.doc;
      const index = $from.index(0);
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= doc.childCount) {
        // Already at the edge. Returning false leaves the document untouched
        // and, importantly, records nothing in the history: an undo should not
        // have to step over moves that did not happen.
        return false;
      }

      const node = doc.child(index);
      const neighbour = doc.child(target);
      const start = $from.before(1);
      const end = start + node.nodeSize;

      if (dispatch === undefined) {
        // A `can()` probe: report that the move is possible, change nothing.
        return true;
      }

      tr.delete(start, end);
      // After the delete, positions before `start` are unmoved and the
      // following node now begins at `start`.
      const insertAt = direction === "up" ? start - neighbour.nodeSize : start + neighbour.nodeSize;
      tr.insert(insertAt, node);
      return true;
    })
    .run();
}
