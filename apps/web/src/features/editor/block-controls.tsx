/**
 * Block controls (T025, US1, FR-002, FR-003, FR-004, FR-017).
 *
 * The visible insertion control FR-002 requires alongside the slash menu and
 * the Markdown shortcuts, and the select/move/transform/duplicate/delete
 * operations of FR-003.
 *
 * They are real `<button>` elements with text labels, not icons carrying a
 * `title`. FR-017 requires every core journey to be completable from the
 * keyboard, and an icon with a tooltip is reachable by a pointer and by nothing
 * else. Each one is also an ordinary editor command, which is what makes FR-004
 * hold without further work: Tiptap's history covers them because they go
 * through the same transaction pipeline as typing does.
 */

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { moveBlock } from "./move-block.ts";

export function BlockControls({ editor }: { readonly editor: Editor }) {
  // Subscribed rather than read once: a control that cannot show whether it is
  // active is one an owner has to guess at.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      // A destroyed editor still reaches this selector for one render, and
      // `can()` on one throws `Cannot read properties of null`, which took
      // React's whole tree down with it — the sidebar disappeared and the crash
      // looked like anything but an editor bug. `EditorSurface` now makes that
      // window structurally impossible; this guard means a future change that
      // reopens it degrades to disabled buttons instead of a blank workspace.
      if (current.isDestroyed) {
        return null;
      }
      return {
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        isBulletList: current.isActive("bulletList"),
        isOrderedList: current.isActive("orderedList"),
        isTaskList: current.isActive("taskList"),
        isQuote: current.isActive("blockquote"),
        isCode: current.isActive("codeBlock"),
      };
    },
  });

  return (
    <div className="block-controls" role="toolbar" aria-label="Block controls">
      <button
        type="button"
        data-testid="insert-block"
        onClick={() => editor.chain().focus().insertContent({ type: "paragraph" }).run()}
      >
        Insert block
      </button>

      <button
        type="button"
        data-testid="toggle-heading"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        Heading
      </button>
      <button
        type="button"
        data-testid="toggle-bulleted-list"
        aria-pressed={state?.isBulletList ?? false}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        Bulleted list
      </button>
      <button
        type="button"
        data-testid="toggle-numbered-list"
        aria-pressed={state?.isOrderedList ?? false}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        Numbered list
      </button>
      <button
        type="button"
        data-testid="toggle-checkbox"
        aria-pressed={state?.isTaskList ?? false}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        Checkbox
      </button>
      <button
        type="button"
        data-testid="toggle-quote"
        aria-pressed={state?.isQuote ?? false}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        Quote
      </button>
      <button
        type="button"
        data-testid="toggle-code"
        aria-pressed={state?.isCode ?? false}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        Code
      </button>
      <button
        type="button"
        data-testid="insert-divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        Divider
      </button>

      <button type="button" data-testid="move-block-up" onClick={() => moveBlock(editor, "up")}>
        Move up
      </button>
      <button type="button" data-testid="move-block-down" onClick={() => moveBlock(editor, "down")}>
        Move down
      </button>
      <button
        type="button"
        data-testid="duplicate-block"
        onClick={() => {
          // Tiptap has no `duplicateNode` command, so the node is re-inserted
          // immediately after itself. Going through `insertContentAt` rather
          // than a raw transaction keeps it inside the history stack, which is
          // what FR-004 requires of every action in FR-003.
          const { $anchor } = editor.state.selection;
          const node = $anchor.node($anchor.depth);
          editor.chain().focus().insertContentAt($anchor.after($anchor.depth), node.toJSON()).run();
        }}
      >
        Duplicate
      </button>
      <button
        type="button"
        data-testid="delete-block"
        onClick={() =>
          editor.chain().focus().deleteNode(editor.state.selection.$anchor.parent.type.name).run()
        }
      >
        Delete block
      </button>

      <button
        type="button"
        data-testid="undo"
        disabled={!(state?.canUndo ?? false)}
        onClick={() => editor.chain().focus().undo().run()}
      >
        Undo
      </button>
      <button
        type="button"
        data-testid="redo"
        disabled={!(state?.canRedo ?? false)}
        onClick={() => editor.chain().focus().redo().run()}
      >
        Redo
      </button>
    </div>
  );
}
