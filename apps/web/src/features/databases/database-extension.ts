import { createEmptyDatabaseAttributes, generateUuidV7 } from "@myownnotion/domain";
import { type Editor, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DatabaseNodeView } from "./database-node-view.tsx";

export const DatabaseBlock = Node.create({
  name: "databaseBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      databaseId: { default: null },
      schemaVersion: { default: 1 },
      properties: { default: [] },
      records: { default: [] },
      view: { default: createEmptyDatabaseAttributes(generateUuidV7()).view },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-database-block]" }];
  },

  renderHTML({ node }) {
    return ["div", { "data-database-block": "", "data-database-id": node.attrs["databaseId"] }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseNodeView);
  },
});

export function insertDatabaseBlock(editor: Editor): boolean {
  const attrs = createEmptyDatabaseAttributes(generateUuidV7());
  return editor.chain().focus().insertContent({ type: "databaseBlock", attrs }).run();
}
