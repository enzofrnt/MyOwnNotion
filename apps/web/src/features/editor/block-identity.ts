/**
 * Block identity across the conversion boundary (T017, US1, FR-025).
 *
 * The model gives every block a UUIDv7 that is stable for its life. ProseMirror
 * silently ignores attributes a node type has not declared, so without this
 * extension every `blockId` set on the way in would vanish, and the trip back
 * would mint new identities for blocks that had not changed.
 *
 * That would be more than untidy. Identity is what the round-trip property
 * compares, what a future feature would use to anchor a comment or a backlink,
 * and what feature 001 established as never derived from position or content.
 * A block that silently changes id every time the page is opened is a block
 * nothing else can refer to.
 */

import { Extension } from "@tiptap/core";

/** The node types that carry a model-level block identity. */
const IDENTIFIED_NODES = [
  "paragraph",
  "heading",
  "codeBlock",
  "horizontalRule",
  "blockquote",
  "listItem",
  "taskItem",
];

export const BlockIdentity = Extension.create({
  name: "blockIdentity",

  addGlobalAttributes() {
    return [
      {
        types: IDENTIFIED_NODES,
        attributes: {
          blockId: {
            default: null,
            // Not written to the DOM: it is model state travelling through the
            // editor, not presentation, and putting it in the markup would
            // invite a paste to carry one block's identity onto another.
            rendered: false,
          },
        },
      },
    ];
  },
});
