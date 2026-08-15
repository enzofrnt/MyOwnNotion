/**
 * Editor → model (T020, US1, FR-006, SC-009).
 *
 * The direction where content is at risk, and where the two guarantees this
 * feature makes are either kept or quietly broken.
 *
 * **An unknown block re-emits its stored value.** Not a reconstruction from the
 * rendered node, not a re-serialisation of a parsed copy — the same object that
 * came out of `JSON.parse`. That is the whole preservation mechanism, and it is
 * one line: `raw` in, `raw` out.
 *
 * **A block keeps its identity when it has one.** `blockId` survives the trip
 * because `block-identity.ts` declares it; a node arriving without one is
 * genuinely new — the owner just typed it — and gets a fresh UUIDv7.
 *
 * Containers are flattened back into direct items here, undoing the grouping
 * `to-tiptap.ts` applied. The two functions are inverses, and the property test
 * is what keeps them that way rather than the comment saying so.
 */

import type { Block, BlockDocument, Inline, JsonObject, Mark, Uuid } from "@myownnotion/domain";
import { generateUuidV7 } from "@myownnotion/domain";
import type { JSONContent } from "@tiptap/core";
import { UNKNOWN_BLOCK_NODE } from "./unknown-block.ts";

export function fromTiptap(doc: JSONContent): BlockDocument {
  return { blocks: convertNodes(doc.content ?? []) };
}

function convertNodes(nodes: readonly JSONContent[]): Block[] {
  const blocks: Block[] = [];
  for (const node of nodes) {
    blocks.push(...convertNode(node));
  }
  return blocks;
}

/** Returns a list because one container node yields several model blocks. */
function convertNode(node: JSONContent): Block[] {
  const id = identityOf(node);

  switch (node.type) {
    case UNKNOWN_BLOCK_NODE: {
      const raw = node.attrs?.["raw"];
      if (raw === null || raw === undefined || typeof raw !== "object") {
        // An unknown node that lost its payload cannot be reconstructed, and
        // guessing at one would write something the owner never had. Dropping
        // it is the honest outcome, and it cannot arise from an ordinary edit:
        // the attribute is carried by reference and never serialised.
        return [];
      }
      return [
        {
          type: "unknown",
          id: (node.attrs?.["blockId"] as Uuid | undefined) ?? generateUuidV7(),
          declaredType: String(node.attrs?.["declaredType"] ?? "unknown"),
          raw: raw as JsonObject,
          syntheticId: node.attrs?.["syntheticId"] === true,
        },
      ];
    }

    case "paragraph":
      return [{ type: "paragraph", id, content: inlineOf(node) }];

    case "heading": {
      const level = node.attrs?.["level"];
      return [
        {
          type: "heading",
          id,
          level: level === 1 || level === 2 || level === 3 ? level : 1,
          content: inlineOf(node),
        },
      ];
    }

    case "codeBlock": {
      const language = node.attrs?.["language"];
      return [
        {
          type: "code",
          id,
          text: (node.content ?? []).map((child) => child.text ?? "").join(""),
          language: typeof language === "string" && language !== "" ? language : null,
        },
      ];
    }

    case "horizontalRule":
      return [{ type: "divider", id }];

    case "blockquote": {
      const [first, ...rest] = node.content ?? [];
      const children = convertNodes(rest);
      return [
        {
          type: "quote",
          id,
          content: first === undefined ? [] : inlineOf(first),
          ...(children.length > 0 ? { children } : {}),
        },
      ];
    }

    case "bulletList":
      return flattenList(node, "bulletedListItem");

    case "orderedList":
      return flattenList(node, "numberedListItem");

    case "taskList":
      return flattenList(node, "checkbox");

    default:
      // A node type the schema produced and the model has no place for. There
      // is nothing to preserve — it came from the editor, not from storage —
      // so its children are lifted rather than dropped, which keeps the text.
      return convertNodes(node.content ?? []);
  }
}

function flattenList(
  container: JSONContent,
  type: "bulletedListItem" | "numberedListItem" | "checkbox",
): Block[] {
  const items: Block[] = [];
  for (const item of container.content ?? []) {
    const [first, ...rest] = item.content ?? [];
    const children = convertNodes(rest);
    const base = {
      id: identityOf(item),
      content: first === undefined ? [] : inlineOf(first),
      ...(children.length > 0 ? { children } : {}),
    };
    items.push(
      type === "checkbox"
        ? { type: "checkbox", checked: item.attrs?.["checked"] === true, ...base }
        : ({ type, ...base } as Block),
    );
  }
  return items;
}

/** A node's model identity, or a fresh one if the owner just created it. */
function identityOf(node: JSONContent): Uuid {
  const stored = node.attrs?.["blockId"];
  return typeof stored === "string" && stored !== "" ? (stored as Uuid) : generateUuidV7();
}

function inlineOf(node: JSONContent): Inline[] {
  return (node.content ?? [])
    .filter((child) => child.type === "text" && typeof child.text === "string")
    .map((child) => {
      const marks = convertMarks(child.marks);
      return marks.length === 0
        ? { text: child.text as string }
        : { text: child.text as string, marks };
    });
}

function convertMarks(marks: JSONContent["marks"]): Mark[] {
  if (marks === undefined) {
    return [];
  }
  const converted: Mark[] = [];
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        converted.push({ type: "bold" });
        break;
      case "italic":
        converted.push({ type: "italic" });
        break;
      case "strike":
        converted.push({ type: "strikethrough" });
        break;
      case "code":
        converted.push({ type: "code" });
        break;
      case "link": {
        const href = mark.attrs?.["href"];
        if (typeof href === "string") {
          converted.push({ type: "link", href });
        }
        break;
      }
      default:
        // A mark the model does not have. Dropped rather than carried: it holds
        // no content of its own, and the text it covers survives either way.
        break;
    }
  }
  return converted;
}
