/**
 * Parse-or-explain for stored document bodies (T008, T009, FR-006).
 *
 * Two rules govern this module, and the distinction between them is the design:
 *
 *   - **An unknown block type is never a failure.** Forward compatibility is
 *     the requirement in FR-006. A document written by a newer client must
 *     open, or an owner with two devices discovers that the older one turns
 *     their notes into an error page.
 *   - **A malformed *known* block is a failure.** A heading at level 9, a
 *     checkbox with no `checked`, a link to a `javascript:` URL — these are
 *     corruption or attack, not the future. Normalising them into something
 *     plausible would hide the first and execute the second.
 *
 * Permissive about what we do not recognise, strict about what we do.
 *
 * Nothing here throws for content reasons. A caller handling an owner's stored
 * document needs an explanation it can show, not an exception it must catch.
 */

import { generateUuidV7, isUuid, type Uuid } from "../ids/uuid.ts";
import {
  type Block,
  type Inline,
  isKnownBlockType,
  type JsonObject,
  type JsonValue,
  type Mark,
  type UnknownBlock,
} from "./block.ts";
import type { BlockDocument } from "./document.ts";

export interface ValidationProblem {
  /** Where the problem is, e.g. `blocks[2].children[0].level`. */
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly document: BlockDocument }
  | { readonly ok: false; readonly problems: readonly ValidationProblem[] };

/** The URL schemes a stored link may use. */
const ALLOWED_LINK_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a `formatVersion: 2` body.
 *
 * Returns every problem found rather than the first, because an owner shown one
 * problem at a time learns their document is broken in an unbounded number of
 * ways.
 */
export function validateDocument(body: unknown): ValidationResult {
  const problems: ValidationProblem[] = [];

  if (!isJsonObject(body)) {
    return { ok: false, problems: [{ path: "", message: "the body is not an object" }] };
  }

  const rawBlocks = body["blocks"];
  if (!Array.isArray(rawBlocks)) {
    return { ok: false, problems: [{ path: "blocks", message: "`blocks` must be an array" }] };
  }

  const blocks = rawBlocks.map((value, index) => parseBlock(value, `blocks[${index}]`, problems));

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    document: { blocks: blocks.filter((block): block is Block => block !== null) },
  };
}

function parseBlock(value: JsonValue, path: string, problems: ValidationProblem[]): Block | null {
  if (!isJsonObject(value)) {
    problems.push({ path, message: "a block must be an object" });
    return null;
  }

  const declaredType = value["type"];
  if (typeof declaredType !== "string") {
    problems.push({ path: `${path}.type`, message: "a block must declare a string `type`" });
    return null;
  }

  if (!isKnownBlockType(declaredType)) {
    return parseUnknownBlock(value, declaredType);
  }

  const id = parseId(value["id"], `${path}.id`, problems);
  if (id === null) {
    return null;
  }

  switch (declaredType) {
    case "paragraph":
      return { type: "paragraph", id, content: parseContent(value, path, problems) };

    case "heading": {
      const level = value["level"];
      if (level !== 1 && level !== 2 && level !== 3) {
        problems.push({ path: `${path}.level`, message: "a heading level must be 1, 2, or 3" });
        return null;
      }
      return { type: "heading", id, level, content: parseContent(value, path, problems) };
    }

    case "checkbox": {
      const checked = value["checked"];
      if (typeof checked !== "boolean") {
        problems.push({ path: `${path}.checked`, message: "a checkbox must declare `checked`" });
        return null;
      }
      return {
        type: "checkbox",
        id,
        checked,
        content: parseContent(value, path, problems),
        ...childrenField(value, path, problems),
      };
    }

    case "code": {
      const text = value["text"];
      if (typeof text !== "string") {
        problems.push({ path: `${path}.text`, message: "a code block must declare `text`" });
        return null;
      }
      const language = value["language"];
      if (language !== null && typeof language !== "string" && language !== undefined) {
        problems.push({
          path: `${path}.language`,
          message: "`language` must be a string or null",
        });
        return null;
      }
      return { type: "code", id, text, language: language ?? null };
    }

    case "divider":
      return { type: "divider", id };

    case "fileEmbed": {
      const fileItemId = parseId(value["fileItemId"], `${path}.fileItemId`, problems);
      if (fileItemId === null) {
        // Refused rather than dropped. An embed pointing nowhere is not a
        // harmless malformation: the usage index is built from these, and a
        // silently discarded one is a file that later reports itself unused
        // while a page still shows it.
        return null;
      }
      const caption = value["caption"];
      if (caption !== null && caption !== undefined && typeof caption !== "string") {
        problems.push({ path: `${path}.caption`, message: "`caption` must be a string or null" });
        return null;
      }
      return { type: "fileEmbed", id, fileItemId, caption: caption ?? null };
    }

    case "bulletedListItem":
    case "numberedListItem":
    case "quote":
      return {
        type: declaredType,
        id,
        content: parseContent(value, path, problems),
        ...childrenField(value, path, problems),
      };
  }
}

/**
 * Wraps an unrecognised block, keeping the parsed value untouched.
 *
 * The `raw` reference is the same object the caller's `JSON.parse` produced. It
 * is not copied, rewritten, or key-sorted, which is what lets serialisation
 * emit the original bytes rather than an equivalent-looking reconstruction.
 */
function parseUnknownBlock(value: JsonObject, declaredType: string): UnknownBlock {
  const storedId = value["id"];
  const usable = typeof storedId === "string" && isUuid(storedId);
  return {
    type: "unknown",
    id: usable ? (storedId as Uuid) : generateUuidV7(),
    declaredType,
    raw: value,
    syntheticId: !usable,
  };
}

function parseId(
  value: JsonValue | undefined,
  path: string,
  problems: ValidationProblem[],
): Uuid | null {
  if (typeof value !== "string" || !isUuid(value)) {
    problems.push({ path, message: "a block must declare a UUID `id`" });
    return null;
  }
  return value as Uuid;
}

function parseContent(
  value: JsonObject,
  path: string,
  problems: ValidationProblem[],
): readonly Inline[] {
  const content = value["content"];
  if (content === undefined) {
    return [];
  }
  if (!Array.isArray(content)) {
    problems.push({ path: `${path}.content`, message: "`content` must be an array" });
    return [];
  }
  return content.map((node, index) => parseInline(node, `${path}.content[${index}]`, problems));
}

function parseInline(value: JsonValue, path: string, problems: ValidationProblem[]): Inline {
  if (!isJsonObject(value)) {
    problems.push({ path, message: "an inline node must be an object" });
    return { text: "" };
  }
  const text = value["text"];
  if (typeof text !== "string") {
    problems.push({ path: `${path}.text`, message: "an inline node must declare `text`" });
    return { text: "" };
  }

  const rawMarks = value["marks"];
  if (rawMarks === undefined) {
    return { text };
  }
  if (!Array.isArray(rawMarks)) {
    problems.push({ path: `${path}.marks`, message: "`marks` must be an array" });
    return { text };
  }

  const marks: Mark[] = [];
  for (const [index, mark] of rawMarks.entries()) {
    const parsed = parseMark(mark, `${path}.marks[${index}]`, problems);
    if (parsed !== null) {
      marks.push(parsed);
    }
  }
  return marks.length === 0 ? { text } : { text, marks };
}

function parseMark(value: JsonValue, path: string, problems: ValidationProblem[]): Mark | null {
  if (!isJsonObject(value)) {
    problems.push({ path, message: "a mark must be an object" });
    return null;
  }
  const type = value["type"];
  switch (type) {
    case "bold":
    case "italic":
    case "strikethrough":
    case "code":
      return { type };
    case "link": {
      const href = value["href"];
      if (typeof href !== "string" || !isSafeHref(href)) {
        // Rejected at validation rather than merely unrendered. An href that
        // only fails to render is one that survives into the stored document
        // and waits for the next reader with a different renderer.
        problems.push({
          path: `${path}.href`,
          message: "a link must be an absolute http, https, or mailto URL",
        });
        return null;
      }
      return { type: "link", href };
    }
    case "pageLink": {
      const targetItemId = value["targetItemId"];
      if (typeof targetItemId !== "string" || !isUuid(targetItemId)) {
        problems.push({
          path: `${path}.targetItemId`,
          message: "an internal page link must declare a target UUID",
        });
        return null;
      }
      return { type: "pageLink", targetItemId: targetItemId as Uuid };
    }
    default:
      // An unrecognised mark is dropped rather than failing the document: it
      // carries no content of its own, and its text survives either way.
      return null;
  }
}

export function isSafeHref(href: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  return ALLOWED_LINK_SCHEMES.has(parsed.protocol);
}

function childrenField(
  value: JsonObject,
  path: string,
  problems: ValidationProblem[],
): { children?: readonly Block[] } {
  const children = value["children"];
  if (children === undefined) {
    return {};
  }
  if (!Array.isArray(children)) {
    problems.push({ path: `${path}.children`, message: "`children` must be an array" });
    return {};
  }
  if (children.length === 0) {
    return {};
  }
  const parsed = children
    .map((child, index) => parseBlock(child, `${path}.children[${index}]`, problems))
    .filter((block): block is Block => block !== null);
  return parsed.length === 0 ? {} : { children: parsed };
}
