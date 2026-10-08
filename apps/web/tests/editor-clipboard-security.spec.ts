// @vitest-environment jsdom
import { type Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    quotation: {
      group: "block",
      content: "block+",
      attrs: {
        source: {
          default: "https://example.org",
          validate(value: unknown) {
            if (typeof value !== "string" || !value.startsWith("https://")) {
              throw new RangeError("Untrusted quotation source");
            }
          },
        },
      },
      toDOM: (node) => ["blockquote", { "data-source": node.attrs.source }, 0],
    },
    text: { group: "inline" },
  },
});

function pasteContext(source: string) {
  const host = document.createElement("div");
  document.body.append(host);
  let pasted: ProseMirrorNode | undefined;
  const view = new EditorView(host, {
    state: EditorState.create({ schema }),
    handlePaste(_view, _event, slice) {
      pasted = schema.topNodeType.create(null, slice.content);
      return true;
    },
  });
  try {
    const paragraph = document.createElement("p");
    paragraph.setAttribute("data-pm-slice", `0 0 ${JSON.stringify(["quotation", { source }])}`);
    paragraph.textContent = "Clipboard text survives";
    // JSDOM does not expose ClipboardEvent; the parser only needs this event
    // as paste metadata, with the clipboard HTML passed explicitly.
    expect(view.pasteHTML(paragraph.outerHTML, new Event("paste") as ClipboardEvent)).toBe(true);
    if (pasted === undefined) throw new Error("Paste parser was not called");
    return pasted;
  } finally {
    view.destroy();
    host.remove();
  }
}

describe("clipboard context attribute validation (GHSA-c8x8-7fp4-3x9w)", () => {
  it("keeps a valid declared context and its text", () => {
    const doc = pasteContext("https://example.org/source");
    expect(doc.textContent).toBe("Clipboard text survives");
    expect(doc.firstChild?.type.name).toBe("quotation");
    expect(doc.firstChild?.attrs.source).toBe("https://example.org/source");
  });

  it("refuses untrusted context attributes while preserving the pasted text", () => {
    const doc = pasteContext("javascript:alert(1)");
    expect(doc.textContent).toBe("Clipboard text survives");
    expect(doc.firstChild?.type.name).toBe("paragraph");
    expect(JSON.stringify(doc.toJSON())).not.toContain("javascript:");
  });
});
