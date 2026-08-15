/**
 * The opaque node that makes FR-006 true (T018, T021, US1, SC-009).
 *
 * ProseMirror validates content against its schema and discards what does not
 * fit, and `Node.fromJSON` throws outright on a node type it has never seen.
 * Tiptap can *detect* that loss — `enableContentCheck` plus `onContentError` —
 * but detection is not preservation, and being told an owner's block was
 * destroyed is worse than useless.
 *
 * So preservation cannot be delegated to the library. It happens here, at the
 * boundary, before ProseMirror sees anything: every block whose type is not in
 * the model's registry becomes one of these, carrying the original JSON in an
 * attribute. On the way back out, that attribute is re-emitted — not
 * reconstructed from what was rendered, which is the difference between "the
 * block survived" and "a block that looks like it survived".
 *
 * The node is an atom because there is nothing here to edit: the content is by
 * definition something this client version does not understand. It is still
 * selectable, movable, and deletable, because an owner must be able to organise
 * a document without understanding every block in it.
 */

import type { JsonObject } from "@myownnotion/domain";
import { mergeAttributes, Node } from "@tiptap/core";

export const UNKNOWN_BLOCK_NODE = "unknownBlock";

export interface UnknownBlockAttributes {
  /** The type the stored block declared, shown in the placeholder. */
  declaredType: string;
  /** The parsed value, untouched. Written back as-is. */
  raw: JsonObject | null;
  /** True when the id was minted for this session and must not be written. */
  syntheticId: boolean;
  blockId: string | null;
}

export const UnknownBlock = Node.create({
  name: UNKNOWN_BLOCK_NODE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      declaredType: { default: "unknown" },
      // Kept as a live JavaScript value rather than a serialised string.
      // Round-tripping it through `JSON.stringify` on every editor transaction
      // would re-key the object, and re-keying is exactly what stops
      // "byte for byte" from being true.
      raw: { default: null, rendered: false },
      syntheticId: { default: false, rendered: false },
      blockId: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: `div[data-unknown-block]` }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const declaredType = String(node.attrs["declaredType"] ?? "unknown");
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-unknown-block": declaredType,
        class: "editor-unknown-block",
        // Announced rather than merely drawn: an owner using assistive
        // technology needs to know a block is here and that it is not empty.
        role: "note",
        "aria-label": `Unsupported block: ${declaredType}`,
        contenteditable: "false",
      }),
      // Displayed as unrenderable, never as an empty gap. A block that renders
      // as nothing is indistinguishable from one that was lost, which is the
      // failure FR-006 exists to prevent.
      `This client cannot display a “${declaredType}” block. It is kept unchanged when the page is saved.`,
    ];
  },
});
