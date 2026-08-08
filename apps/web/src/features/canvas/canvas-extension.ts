import { createEmptyCanvasAttributes, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { type Editor, Node } from "@tiptap/core";
import { type NodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { createElement } from "react";
import { CanvasNodeView, type CanvasNodeViewOptions } from "./canvas-node-view.tsx";

export interface CanvasBlockOptions extends CanvasNodeViewOptions {}

export const CanvasBlock = Node.create<CanvasBlockOptions>({
  name: "canvasBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      sourceItemId: "00000000-0000-0000-0000-000000000000" as Uuid,
      getPageCandidates: () => [],
      onNavigatePage: () => undefined,
    };
  },

  addAttributes() {
    const defaults = createEmptyCanvasAttributes(generateUuidV7());
    return {
      canvasId: { default: null },
      schemaVersion: { default: 1 },
      cards: { default: [] },
      connections: { default: [] },
      strokes: { default: [] },
      viewport: { default: defaults.viewport },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-canvas-block]" }];
  },

  renderHTML({ node }) {
    return ["div", { "data-canvas-block": "", "data-canvas-id": node.attrs["canvasId"] }];
  },

  addNodeView() {
    const options = this.options;
    return ReactNodeViewRenderer((props: NodeViewProps) =>
      createElement(CanvasNodeView, { ...props, ...options }),
    );
  },
});

export function insertCanvasBlock(editor: Editor): boolean {
  const attrs = createEmptyCanvasAttributes(generateUuidV7());
  return editor.chain().focus().insertContent({ type: "canvasBlock", attrs }).run();
}
