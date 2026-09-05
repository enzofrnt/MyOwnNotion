import { createExtension } from "@blocknote/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** Android Enter may bypass keymaps and split the React contentDOM wrapper.
 * Keep that native input as plain source through the normal editor transaction.
 */
export function handleCodeLineBreak(
  view: Pick<EditorView, "editable" | "composing" | "state" | "dispatch">,
  event: InputEvent,
): boolean {
  const { $from, $to } = view.state.selection;
  if (
    !view.editable ||
    view.composing ||
    event.isComposing ||
    event.defaultPrevented ||
    !event.cancelable ||
    (event.inputType !== "insertParagraph" && event.inputType !== "insertLineBreak") ||
    $from.parent.type.name !== "codeBlock" ||
    !$from.sameParent($to)
  ) {
    return false;
  }
  event.preventDefault();
  view.dispatch(view.state.tr.insertText("\n").scrollIntoView());
  return true;
}

export function createCodeBlockInputPlugin(): Plugin {
  const nativeLineBreaks = new WeakSet<EditorView>();
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        // ProseMirror's iOS fallback dispatches a synthetic Enter after
        // native beforeinput. That newline is already in the transaction.
        if (event.key === "Enter" && !event.isTrusted && nativeLineBreaks.has(view)) {
          nativeLineBreaks.delete(view);
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        keydown(view) {
          // A fresh DOM key gesture must always be allowed, including two
          // rapid Enter presses. The iOS fallback never dispatches a DOM key.
          nativeLineBreaks.delete(view);
          return false;
        },
        beforeinput(view, event) {
          const handled = handleCodeLineBreak(view, event);
          if (handled) nativeLineBreaks.add(view);
          return handled;
        },
      },
    },
  });
}

export const CodeBlockInputExtension = createExtension({
  key: "codeBlockInput",
  prosemirrorPlugins: [createCodeBlockInputPlugin()],
});
