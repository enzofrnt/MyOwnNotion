/**
 * The editor schema, and the one place Tiptap's shape is allowed to differ
 * from ours (T017, US1).
 *
 * The model nests list items directly: a `bulletedListItem` may carry
 * `children`, and there is no list container. ProseMirror conventionally wraps
 * items in one — `bulletList > listItem` — and every list command Tiptap ships
 * (indent, outdent, toggle, split) assumes that shape.
 *
 * Rather than fight it, the schema here is conventional and the conversion
 * boundary reconciles the two: `to-tiptap.ts` groups adjacent items of the same
 * kind into a container, `from-tiptap.ts` flattens containers back into items.
 * That keeps the model free of a container node it does not need — one that
 * would introduce an empty list, a list of one, and a list containing only a
 * list as three new states the round-trip property would have to pin down —
 * while still getting working list behaviour for free.
 *
 * This asymmetry is the reason the boundary exists at all. It is not overhead
 * around a format that would otherwise match; it is what lets the stored format
 * answer to the product and the editor format answer to the editor.
 */

import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { BlockIdentity } from "./block-identity.ts";
import { PageLink } from "./page-link.ts";
import { UnknownBlock } from "./unknown-block.ts";

/**
 * The extensions the editor runs with.
 *
 * StarterKit supplies paragraph, heading, lists, blockquote, code block,
 * horizontal rule, the bold/italic/strike/code marks, links, history, and the
 * input rules behind the Markdown-style shortcuts — all of FR-002 through
 * FR-004 that is genuinely hard and genuinely not our product.
 */
export function editorExtensions() {
  return [
    StarterKit.configure({
      // The model defines exactly three heading levels, so the editor must not
      // be able to produce a fourth: a document the schema allows and the model
      // rejects is a save that fails after the owner has already typed.
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        // Matches the model's validation rather than merely resembling it. An
        // href the editor accepts and the model refuses is a document that
        // cannot be saved, and the owner would have no way to know why.
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    BlockIdentity,
    PageLink,
    UnknownBlock,
  ];
}
