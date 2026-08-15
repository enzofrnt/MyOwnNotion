/**
 * The mounted editor (T022, US1).
 *
 * Split out of `EditorView` for one reason, and it is a correctness reason
 * rather than a tidiness one. `useEditor` takes a dependency array, and
 * changing it **destroys and recreates the editor**. Passing the loaded
 * document through that array meant the editor was rebuilt the moment loading
 * finished — and during that window `BlockControls` was still subscribed to the
 * old instance, called `can()` on an editor whose view had been torn down, and
 * threw `Cannot read properties of null (reading 'can')`. React unmounted the
 * whole workspace, so the symptom was the sidebar vanishing on click, which
 * looks like anything except an editor bug.
 *
 * The fix is structural: this component is only ever rendered with a document
 * already in hand, so the editor is created once, with no dependency array and
 * nothing to invalidate. Switching pages remounts it through a `key`, which is
 * a remount rather than a rebuild-in-place and has no half-destroyed state for
 * anything to observe.
 */

import type { BlockDocument } from "@myownnotion/domain";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useImperativeHandle } from "react";
import { BlockControls } from "./block-controls.tsx";
import { fromTiptap } from "./from-tiptap.ts";
import { SlashMenu } from "./slash-menu.tsx";
import { editorExtensions } from "./tiptap-schema.ts";
import { toTiptap } from "./to-tiptap.ts";

export interface EditorSurfaceHandle {
  /** The current document, converted back out of the editor. */
  read(): BlockDocument | null;
}

export function EditorSurface({
  document,
  editable,
  handleRef,
}: {
  readonly document: BlockDocument;
  readonly editable: boolean;
  readonly handleRef: React.RefObject<EditorSurfaceHandle | null>;
}) {
  const editor = useEditor({
    extensions: editorExtensions(),
    content: toTiptap(document),
    editable,
    editorProps: {
      attributes: {
        class: "editor-surface",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Page content",
      },
    },
  });

  const read = useCallback(
    () => (editor === null || editor.isDestroyed ? null : fromTiptap(editor.getJSON())),
    [editor],
  );

  useImperativeHandle(handleRef, () => ({ read }), [read]);

  if (editor === null) {
    return (
      <div data-testid="block-editor" aria-busy="true">
        <p className="muted" role="status">
          Preparing the editor…
        </p>
      </div>
    );
  }

  return (
    <>
      <BlockControls editor={editor} />
      <SlashMenu editor={editor} />
      {/* The test id sits on a wrapper: Tiptap renders its own container and
          does not forward arbitrary DOM props, so an attribute placed on
          `EditorContent` never reaches the document. */}
      <div data-testid="block-editor">
        <EditorContent editor={editor} />
      </div>
    </>
  );
}
