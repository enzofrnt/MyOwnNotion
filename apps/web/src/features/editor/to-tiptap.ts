/**
 * Model → editor (T019, US1, FR-006).
 *
 * Two things happen here, and the order between them is what matters.
 *
 * **Unrecognised blocks are routed to the opaque node before ProseMirror sees
 * anything.** By the time content reaches the schema it is too late: unknown
 * node types are discarded, or throw. Deciding here is what makes preservation
 * possible at all.
 *
 * **Adjacent list items are grouped into containers.** The model nests items
 * directly; ProseMirror wants `bulletList > listItem`. The grouping is done by
 * scanning runs of same-kind siblings, which is exactly reversible — see
 * `from-tiptap.ts`, where the containers are flattened back out.
 */

import type { Block, BlockDocument, Inline, Mark } from "@myownnotion/domain";
import { childrenOf, isUnknownBlock, normaliseDocument } from "@myownnotion/domain";
import type { JSONContent } from "@tiptap/core";
import { UNKNOWN_BLOCK_NODE } from "./unknown-block.ts";

/** The container each nesting block type lives in, and the item node inside it. */
const LIST_SHAPES = {
  bulletedListItem: { container: "bulletList", item: "listItem" },
  numberedListItem: { container: "orderedList", item: "listItem" },
  checkbox: { container: "taskList", item: "taskItem" },
} as const;

type ListBlockType = keyof typeof LIST_SHAPES;

function isListBlock(block: Block): block is Extract<Block, { type: ListBlockType }> {
  return block.type in LIST_SHAPES;
}

export function toTiptap(input: BlockDocument): JSONContent {
  // Normalised on the way in, because the editor's schema is stricter than the
  // model's parser is. A stored document may hold mark combinations the schema
  // refuses — written by an older client, or by hand — and handing them to
  // ProseMirror throws rather than degrading. Normalising first turns "this
  // document cannot be opened" into "this document opens, canonically".
  const document = normaliseDocument(input);
  const content = convertBlocks(document.blocks);
  // ProseMirror's `doc` requires at least one block: `validContent(empty)` is
  // false and mounting an editor on an empty document throws
  // `RangeError: Invalid content for node doc`. So a document with no blocks
  // becomes one empty paragraph — the only valid representation, and also the
  // one an owner needs, since a document with nowhere to type is not editable.
  //
  // This is the single point where the round trip is deliberately not the
  // identity: an empty document saved back becomes a document holding one
  // empty paragraph. Nothing is lost, and the alternative is an editor that
  // cannot open a new page.
  return { type: "doc", content: content.length === 0 ? [{ type: "paragraph" }] : content };
}

function convertBlocks(blocks: readonly Block[]): JSONContent[] {
  const output: JSONContent[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];
    if (block === undefined) {
      index += 1;
      continue;
    }

    if (!isListBlock(block)) {
      output.push(convertBlock(block));
      index += 1;
      continue;
    }

    // Take the whole run of same-kind siblings as one container. Splitting it
    // any other way would render two adjacent bullets as two separate lists,
    // which reads differently and, worse, does not survive the trip back.
    const kind = block.type;
    const run: Extract<Block, { type: ListBlockType }>[] = [];
    while (index < blocks.length) {
      const candidate = blocks[index];
      if (candidate === undefined || !isListBlock(candidate) || candidate.type !== kind) {
        break;
      }
      run.push(candidate);
      index += 1;
    }

    const shape = LIST_SHAPES[kind];
    output.push({
      type: shape.container,
      content: run.map((item) => convertListItem(item, shape.item)),
    });
  }

  return output;
}

function convertListItem(
  block: Extract<Block, { type: ListBlockType }>,
  itemNode: string,
): JSONContent {
  const content: JSONContent[] = [{ type: "paragraph", ...inlineContent(block.content) }];
  const children = childrenOf(block);
  if (children.length > 0) {
    content.push(...convertBlocks(children));
  }

  // The identity goes on the *item*, not on the paragraph inside it: the item
  // is the model's block, and the paragraph is how the editor holds its text.
  return itemNode === "taskItem"
    ? {
        type: "taskItem",
        attrs: {
          checked: block.type === "checkbox" ? block.checked : false,
          blockId: block.id,
        },
        content,
      }
    : { type: itemNode, attrs: { blockId: block.id }, content };
}

function convertBlock(block: Block): JSONContent {
  if (isUnknownBlock(block)) {
    return {
      type: UNKNOWN_BLOCK_NODE,
      attrs: {
        declaredType: block.declaredType,
        // Carried as the live object. Serialising it here and parsing it back
        // later would re-key it, and re-keying is what stops the byte-for-byte
        // guarantee from holding.
        raw: block.raw,
        syntheticId: block.syntheticId,
        blockId: block.id,
      },
    };
  }

  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", attrs: { blockId: block.id }, ...inlineContent(block.content) };

    case "heading":
      return {
        type: "heading",
        attrs: { level: block.level, blockId: block.id },
        ...inlineContent(block.content),
      };

    case "quote":
      return {
        type: "blockquote",
        attrs: { blockId: block.id },
        content: [
          { type: "paragraph", ...inlineContent(block.content) },
          ...convertBlocks(childrenOf(block)),
        ],
      };

    case "code":
      return {
        type: "codeBlock",
        attrs: { language: block.language, blockId: block.id },
        // An empty code block must have no content array at all: ProseMirror
        // rejects a text node with an empty string.
        ...(block.text === "" ? {} : { content: [{ type: "text", text: block.text }] }),
      };

    case "divider":
      return { type: "horizontalRule", attrs: { blockId: block.id } };

    default:
      // Unreachable for known types; list items are handled by convertBlocks.
      return { type: "paragraph" };
  }
}

/** Omits `content` entirely when empty — ProseMirror rejects empty text nodes. */
function inlineContent(content: readonly Inline[]): { content?: JSONContent[] } {
  const nodes = content
    .filter((node) => node.text !== "")
    .map((node) => ({ type: "text", text: node.text, ...convertMarks(node.marks) }));
  return nodes.length === 0 ? {} : { content: nodes };
}

type MarkNodes = NonNullable<JSONContent["marks"]>;

// The return type is a union rather than an optional field: under
// `exactOptionalPropertyTypes`, `{ marks?: T }` still permits `marks: undefined`,
// which is not the same as an absent key and is not what ProseMirror accepts.
function convertMarks(
  marks: readonly Mark[] | undefined,
): Record<string, never> | { marks: MarkNodes } {
  if (marks === undefined || marks.length === 0) {
    return {};
  }
  return {
    marks: marks.map((mark) => {
      switch (mark.type) {
        case "bold":
          return { type: "bold" };
        case "italic":
          return { type: "italic" };
        case "strikethrough":
          return { type: "strike" };
        case "code":
          return { type: "code" };
        default:
          return { type: "link", attrs: { href: mark.href } };
      }
    }),
  };
}
