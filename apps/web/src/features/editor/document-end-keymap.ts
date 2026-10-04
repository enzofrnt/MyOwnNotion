import { createExtension } from "@blocknote/core";
import { Plugin, Selection } from "@tiptap/pm/state";

export function createDocumentEndPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (
          !view.editable ||
          view.composing ||
          event.isComposing ||
          event.key !== "End" ||
          (!event.ctrlKey && !event.metaKey) ||
          event.shiftKey ||
          event.altKey
        ) {
          return false;
        }
        // The trailing widget is outside the text model. Native Ctrl/Meta+End
        // can put the DOM caret after it until selectionchange is processed;
        // typing in that window inserts a browser paragraph and bypasses the
        // slash trigger. Own this movement and reconcile the DOM synchronously,
        // including when the model selection was already at the document end.
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
        view.focus();
        event.preventDefault();
        return true;
      },
    },
  });
}

export const DocumentEndExtension = createExtension({
  key: "documentEnd",
  prosemirrorPlugins: [createDocumentEndPlugin()],
});
