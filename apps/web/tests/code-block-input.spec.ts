// @vitest-environment jsdom
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";
import {
  createCodeBlockInputPlugin,
  handleCodeLineBreak,
} from "../src/features/editor/code-block-input.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    codeBlock: { group: "block", content: "text*", code: true },
    paragraph: { group: "block", content: "text*" },
  },
});

function setup(type = "codeBlock") {
  const doc = schema.node("doc", null, [schema.node(type, null, schema.text("abcd"))]);
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 2, 4) });
  const view: Pick<EditorView, "editable" | "composing" | "state" | "dispatch"> = {
    editable: true,
    composing: false,
    get state() {
      return state;
    },
    dispatch(transaction) {
      state = state.apply(transaction);
    },
  };
  return view;
}

describe("native code line breaks", () => {
  it("consumes the iOS synthetic fallback once and allows the next DOM Enter", () => {
    const plugin = createCodeBlockInputPlugin();
    const view = setup() as EditorView;
    const beforeinput = () =>
      new InputEvent("beforeinput", { inputType: "insertParagraph", cancelable: true });
    const enter = () => new KeyboardEvent("keydown", { key: "Enter" });
    expect(plugin.props.handleDOMEvents?.beforeinput?.call(plugin, view, beforeinput())).toBe(true);
    expect(plugin.props.handleKeyDown?.call(plugin, view, enter())).toBe(true);
    expect(view.state.doc.textContent).toBe("a\nd");
    expect(plugin.props.handleKeyDown?.call(plugin, view, enter())).toBe(false);
    expect(plugin.props.handleDOMEvents?.beforeinput?.call(plugin, view, beforeinput())).toBe(true);
    plugin.props.handleDOMEvents?.keydown?.call(plugin, view, enter());
    expect(plugin.props.handleKeyDown?.call(plugin, view, enter())).toBe(false);
    expect(view.state.doc.textContent).toBe("a\n\nd");
  });
  it.each(["insertParagraph", "insertLineBreak"])(
    "replaces the selected code with a newline for %s",
    (inputType) => {
      const view = setup();
      const event = new InputEvent("beforeinput", { inputType, cancelable: true });
      expect(handleCodeLineBreak(view, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.textContent).toBe("a\nd");
      expect(view.state.selection.from).toBe(3);
    },
  );

  it("leaves composition, readonly and other native inputs to the editor", () => {
    const combinations = [
      { view: { ...setup(), composing: true }, event: { inputType: "insertParagraph" } },
      { view: { ...setup(), editable: false }, event: { inputType: "insertParagraph" } },
      { view: setup(), event: { inputType: "insertParagraph", isComposing: true } },
      { view: setup(), event: { inputType: "insertText" } },
      { view: setup("paragraph"), event: { inputType: "insertParagraph" } },
    ];
    for (const { view, event: init } of combinations) {
      const event = new InputEvent("beforeinput", { ...init, cancelable: true });
      expect(handleCodeLineBreak(view, event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(view.state.doc.textContent).toBe("abcd");
    }
  });
});
