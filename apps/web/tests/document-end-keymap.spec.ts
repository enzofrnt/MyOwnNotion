// @vitest-environment jsdom
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, Selection, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";
import { createDocumentEndPlugin } from "../src/features/editor/document-end-keymap.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});
const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    const host = view.dom.parentElement;
    view.destroy();
    host?.remove();
  }
});

function setup() {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("Avant")),
    schema.node("paragraph", null, schema.text("Fin")),
  ]);
  const host = document.body.appendChild(document.createElement("div"));
  const terminal = document.createElement("div");
  terminal.className = "bn-trailing-block";
  terminal.contentEditable = "false";
  const view = new EditorView(host, {
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2, 4),
      plugins: [
        createDocumentEndPlugin(),
        new Plugin({
          props: {
            decorations: (state) =>
              DecorationSet.create(state.doc, [
                Decoration.widget(state.doc.content.size, terminal, { side: 1 }),
              ]),
          },
        }),
      ],
    }),
    // jsdom cannot lay out a scrollport; the native journeys verify scrolling.
    handleScrollToSelection: () => true,
  });
  views.push(view);
  view.focus();
  return view;
}

function end(view: EditorView, init: KeyboardEventInit = { ctrlKey: true }) {
  const event = new KeyboardEvent("keydown", {
    key: "End",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  view.dom.dispatchEvent(event);
  return event;
}

describe("document end beside the terminal widget", () => {
  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "owns %j before the browser can place the caret after the widget",
    (modifier) => {
      const view = setup();
      const event = end(view, modifier);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.selection.eq(Selection.atEnd(view.state.doc))).toBe(true);
      expect(window.getSelection()?.anchorNode?.textContent).toBe("Fin");
      expect(window.getSelection()?.anchorOffset).toBe(3);
      view.dispatch(view.state.tr.insertText("/tab"));
      expect(view.state.doc.childCount).toBe(2);
      expect(view.state.doc.lastChild?.textContent).toBe("Fin/tab");
    },
  );

  it("restores the DOM caret even when the model already points to the end", () => {
    const view = setup();
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
    window.getSelection()?.collapse(view.dom, view.dom.childNodes.length);
    expect(window.getSelection()?.anchorNode).toBe(view.dom);
    expect(end(view).defaultPrevented).toBe(true);
    expect(window.getSelection()?.anchorNode?.textContent).toBe("Fin");
    expect(window.getSelection()?.anchorOffset).toBe(3);
  });

  it("yields readonly, composition, plain End and modified selection shortcuts", () => {
    const view = setup();
    const initial = view.state.selection;
    for (const init of [
      {},
      { ctrlKey: true, shiftKey: true },
      { ctrlKey: true, altKey: true },
      { ctrlKey: true, isComposing: true },
    ]) {
      expect(end(view, init).defaultPrevented).toBe(false);
      expect(view.state.selection.eq(initial)).toBe(true);
    }
    const otherKey = new KeyboardEvent("keydown", {
      key: "Home",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(otherKey);
    expect(otherKey.defaultPrevented).toBe(false);
    expect(view.state.selection.eq(initial)).toBe(true);
    Object.defineProperty(view, "composing", { configurable: true, value: true });
    expect(end(view).defaultPrevented).toBe(false);
    expect(view.state.selection.eq(initial)).toBe(true);
    Object.defineProperty(view, "composing", { configurable: true, value: false });
    view.setProps({ editable: () => false });
    expect(end(view).defaultPrevented).toBe(false);
    expect(view.state.selection.eq(initial)).toBe(true);
  });
});
