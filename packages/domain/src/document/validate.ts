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
  BLOCK_FIELD_ORDER_V3,
  type Block,
  type CanonicalBlockV3,
  COLOR_TOKENS,
  type ColorToken,
  EMBED_PROVIDERS,
  type EmbedProvider,
  type Inline,
  type InlineV3,
  isKnownBlockType,
  isKnownBlockTypeV3,
  type JsonObject,
  type JsonValue,
  type KnownMarkTypeV3,
  MARK_ORDER_V3,
  type Mark,
  type MarkV3,
  type TableCellV3,
  type TableColumnV3,
  type TableRowV3,
  type UnknownBlock,
} from "./block.ts";
import {
  type BlockDocument,
  type BlockDocumentV3,
  DOCUMENT_FORMAT,
  DOCUMENT_FORMAT_VERSION_V3,
  type PageDocumentEnvelopeV3,
} from "./document.ts";

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
 *
 * Parsing is idempotent: a block that already carries the canonical unknown
 * wrapper (an envelope round-tripped through a client that had parsed it
 * before) unwraps to itself instead of nesting a wrapper inside itself. A
 * nested wrapper would change the canonical bytes — serialisation emits the
 * `raw` payload alone — and silently break every digest computed over the
 * document.
 */
function parseUnknownBlock(value: JsonObject, declaredType: string): UnknownBlock {
  const storedId = value["id"];
  const usable = typeof storedId === "string" && isUuid(storedId);
  if (declaredType === "unknown") {
    const innerDeclaredType = value["declaredType"];
    const innerRaw = value["raw"];
    if (typeof innerDeclaredType === "string" && isJsonObject(innerRaw)) {
      return {
        type: "unknown",
        id: usable ? (storedId as Uuid) : generateUuidV7(),
        declaredType: innerDeclaredType,
        raw: innerRaw,
        syntheticId: !usable,
      };
    }
  }
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

// ---------------------------------------------------------------------------
// Canonical document v3 validation
// ---------------------------------------------------------------------------

export type ValidationResultV3 =
  | { readonly ok: true; readonly document: BlockDocumentV3 }
  | { readonly ok: false; readonly problems: readonly ValidationProblem[] };

export type EnvelopeValidationResultV3 =
  | { readonly ok: true; readonly envelope: PageDocumentEnvelopeV3 }
  | { readonly ok: false; readonly problems: readonly ValidationProblem[] };

const MAX_DOCUMENT_BYTES_V3 = 16 * 1024 * 1024;
const MAX_INLINE_BYTES_V3 = 1024 * 1024;
const MAX_URL_LENGTH_V3 = 2_048;
const MAX_BLOCK_DEPTH_V3 = 32;
const MAX_CODE_LANGUAGE_LENGTH_V3 = 100;
const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(COLOR_TOKENS);
const EMBED_PROVIDER_SET: ReadonlySet<string> = new Set(EMBED_PROVIDERS);
const KNOWN_MARK_TYPE_V3_SET: ReadonlySet<string> = new Set(MARK_ORDER_V3);
const UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const SECRET_QUERY_PARAMETER = /^(?:access[_-]?token|api[_-]?key|auth|key|secret|token)$/iu;

interface V3ValidationContext {
  readonly problems: ValidationProblem[];
  readonly identityPaths: Map<string, string>;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function addProblem(context: V3ValidationContext, path: string, message: string): void {
  context.problems.push({ path, message });
}

function hasForbiddenControlCharacter(value: string, codeBlock: boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f && (!codeBlock || (codePoint !== 0x09 && codePoint !== 0x0a))) {
      return true;
    }
  }
  return false;
}

function validateStringV3(
  value: unknown,
  path: string,
  context: V3ValidationContext,
  options: { readonly maxBytes?: number; readonly code?: boolean } = {},
): value is string {
  if (typeof value !== "string") {
    addProblem(context, path, "must be a string");
    return false;
  }
  if (UNPAIRED_SURROGATE.test(value)) {
    addProblem(context, path, "must contain valid Unicode scalar values");
    return false;
  }
  if (hasForbiddenControlCharacter(value, options.code === true)) {
    addProblem(context, path, "contains a forbidden control character");
    return false;
  }
  if (options.maxBytes !== undefined && utf8Length(value) > options.maxBytes) {
    addProblem(context, path, `must not exceed ${options.maxBytes} UTF-8 bytes`);
    return false;
  }
  return true;
}

function validateOpaqueJsonV3(
  value: unknown,
  path: string,
  context: V3ValidationContext,
): value is JsonValue {
  if (typeof value === "string") {
    return validateStringV3(value, path, context);
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return true;
    addProblem(context, path, "must contain a finite JSON number");
    return false;
  }
  if (value === null || typeof value === "boolean") return true;
  if (Array.isArray(value)) {
    let valid = true;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        addProblem(context, `${path}[${index}]`, "must not be a sparse JSON array entry");
        valid = false;
        continue;
      }
      valid = validateOpaqueJsonV3(value[index], `${path}[${index}]`, context) && valid;
    }
    const extraKeys = Reflect.ownKeys(value).filter(
      (key) => key !== "length" && !(typeof key === "string" && /^(?:0|[1-9]\d*)$/u.test(key)),
    );
    if (extraKeys.length > 0) {
      addProblem(context, path, "must not contain non-index JSON array properties");
      valid = false;
    }
    return valid;
  }
  if (typeof value === "object") {
    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      addProblem(context, path, "must be a plain JSON object");
      return false;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      addProblem(context, path, "must be a plain JSON object");
      return false;
    }
    let valid = true;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        addProblem(context, path, "must not contain symbol JSON keys");
        valid = false;
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        addProblem(context, `${path}.${key}`, "must be an enumerable JSON data property");
        valid = false;
        continue;
      }
      valid = validateStringV3(key, `${path}.${key}`, context) && valid;
      valid = validateOpaqueJsonV3(descriptor.value, `${path}.${key}`, context) && valid;
    }
    return valid;
  }
  addProblem(context, path, "must contain only JSON values");
  return false;
}

function registerIdentityV3(id: Uuid, path: string, context: V3ValidationContext): void {
  const previous = context.identityPaths.get(id);
  if (previous !== undefined) {
    addProblem(context, path, `duplicates the identity already used at ${previous}`);
    return;
  }
  context.identityPaths.set(id, path);
}

function parseIdentityV3(
  value: JsonValue | undefined,
  path: string,
  context: V3ValidationContext,
): Uuid | null {
  if (typeof value !== "string" || !isUuid(value)) {
    addProblem(context, path, "must be a UUID");
    return null;
  }
  const id = value as Uuid;
  registerIdentityV3(id, path, context);
  return id;
}

function parseUuidReferenceV3(
  value: JsonValue | undefined,
  path: string,
  context: V3ValidationContext,
): Uuid | null {
  if (typeof value !== "string" || !isUuid(value)) {
    addProblem(context, path, "must be a UUID");
    return null;
  }
  return value as Uuid;
}

function rawExtraPropertiesV3(
  value: JsonObject,
  knownKeys: readonly string[],
  path: string,
  context: V3ValidationContext,
): JsonObject | undefined {
  const known = new Set(knownKeys);
  const extra: JsonObject = {};
  for (const key of Object.keys(value)) {
    if (known.has(key)) continue;
    const candidate: unknown = value[key];
    if (validateOpaqueJsonV3(candidate, `${path}.${key}`, context)) {
      extra[key] = candidate;
    }
  }
  return Object.keys(extra).length === 0 ? undefined : extra;
}

function withRawExtraV3<T extends CanonicalBlockV3>(
  parsed: T,
  rawExtraProperties: JsonObject | undefined,
): CanonicalBlockV3 {
  return rawExtraProperties === undefined
    ? parsed
    : ({ ...parsed, rawExtraProperties } as CanonicalBlockV3);
}

function parseNullableTextV3(
  value: JsonValue | undefined,
  path: string,
  context: V3ValidationContext,
): string | null | undefined {
  if (value === null) return null;
  return validateStringV3(value, path, context, { maxBytes: MAX_INLINE_BYTES_V3 })
    ? value
    : undefined;
}

function parseColorTokenV3(
  value: JsonValue | undefined,
  path: string,
  context: V3ValidationContext,
): ColorToken | null {
  if (typeof value !== "string" || !COLOR_TOKEN_SET.has(value)) {
    addProblem(context, path, "must be a canonical color token");
    return null;
  }
  return value as ColorToken;
}

function parseMarkV3(value: JsonValue, path: string, context: V3ValidationContext): MarkV3 | null {
  if (!isJsonObject(value)) {
    addProblem(context, path, "a mark must be an object");
    return null;
  }
  const type = value["type"];
  if (typeof type !== "string") {
    addProblem(context, `${path}.type`, "a mark must declare a string type");
    return null;
  }

  if (!KNOWN_MARK_TYPE_V3_SET.has(type)) {
    validateOpaqueJsonV3(value, path, context);
    return { type: "unknown", declaredType: type, raw: value };
  }

  const rejectExtra = (knownKeys: readonly string[]): void => {
    for (const key of Object.keys(value)) {
      if (!knownKeys.includes(key))
        addProblem(context, `${path}.${key}`, "is not valid for this mark");
    }
  };

  const knownType = type as KnownMarkTypeV3;
  switch (knownType) {
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "code":
      rejectExtra(["type"]);
      return { type: knownType };
    case "link": {
      rejectExtra(["type", "href"]);
      const href = value["href"];
      if (
        !validateStringV3(href, `${path}.href`, context, { maxBytes: MAX_URL_LENGTH_V3 }) ||
        href.length > MAX_URL_LENGTH_V3 ||
        !isSafeHref(href)
      ) {
        addProblem(context, `${path}.href`, "must be a safe absolute http, https, or mailto URL");
        return null;
      }
      return { type: "link", href };
    }
    case "pageLink": {
      rejectExtra(["type", "targetItemId"]);
      const target = value["targetItemId"];
      if (typeof target !== "string" || !isUuid(target)) {
        addProblem(context, `${path}.targetItemId`, "must be a target UUID");
        return null;
      }
      return { type: "pageLink", targetItemId: target as Uuid };
    }
    case "textColor":
    case "backgroundColor": {
      rejectExtra(["type", "color"]);
      const color = parseColorTokenV3(value["color"], `${path}.color`, context);
      return color === null ? null : { type: knownType, color };
    }
  }
}

function parseContentV3(
  value: JsonValue | undefined,
  path: string,
  context: V3ValidationContext,
): readonly InlineV3[] {
  if (!Array.isArray(value)) {
    addProblem(context, path, "must be an array");
    return [];
  }
  const content: InlineV3[] = [];
  for (const [index, rawInline] of value.entries()) {
    const inlinePath = `${path}[${index}]`;
    if (!isJsonObject(rawInline)) {
      addProblem(context, inlinePath, "an inline run must be an object");
      continue;
    }
    const text = rawInline["text"];
    if (!validateStringV3(text, `${inlinePath}.text`, context, { maxBytes: MAX_INLINE_BYTES_V3 })) {
      continue;
    }
    for (const key of Object.keys(rawInline)) {
      if (key !== "text" && key !== "marks") {
        addProblem(context, `${inlinePath}.${key}`, "is not valid for an inline run");
      }
    }
    const rawMarks = rawInline["marks"];
    if (rawMarks === undefined) {
      content.push({ text });
      continue;
    }
    if (!Array.isArray(rawMarks)) {
      addProblem(context, `${inlinePath}.marks`, "must be an array");
      continue;
    }
    const marks: MarkV3[] = [];
    const knownTypes = new Set<KnownMarkTypeV3>();
    for (const [markIndex, rawMark] of rawMarks.entries()) {
      const mark = parseMarkV3(rawMark, `${inlinePath}.marks[${markIndex}]`, context);
      if (mark === null) continue;
      if (mark.type !== "unknown") {
        if (knownTypes.has(mark.type)) {
          addProblem(
            context,
            `${inlinePath}.marks[${markIndex}]`,
            `duplicates the ${mark.type} mark`,
          );
        }
        knownTypes.add(mark.type);
      }
      marks.push(mark);
    }
    if (knownTypes.has("code") && knownTypes.size > 1) {
      addProblem(context, `${inlinePath}.marks`, "code is exclusive with every other known mark");
    }
    content.push(marks.length === 0 ? { text } : { text, marks });
  }
  return content;
}

function parseChildrenV3(
  value: JsonValue | undefined,
  path: string,
  depth: number,
  context: V3ValidationContext,
  insideTableCell = false,
): readonly CanonicalBlockV3[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    addProblem(context, path, "must be an array");
    return undefined;
  }
  if (value.length === 0) return undefined;
  return value
    .map((child, index) =>
      parseBlockV3(child, `${path}[${index}]`, depth + 1, context, insideTableCell),
    )
    .filter((block): block is CanonicalBlockV3 => block !== null);
}

function parseTableCellV3(
  value: JsonValue,
  path: string,
  depth: number,
  context: V3ValidationContext,
): TableCellV3 | null {
  if (!isJsonObject(value)) {
    addProblem(context, path, "a table cell must be an object");
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!["id", "content", "children"].includes(key)) {
      addProblem(context, `${path}.${key}`, "is not valid for a table cell");
    }
  }
  const id = parseIdentityV3(value["id"], `${path}.id`, context);
  if (id === null) return null;
  const content = parseContentV3(value["content"], `${path}.content`, context);
  const children = parseChildrenV3(value["children"], `${path}.children`, depth, context, true);
  return children === undefined ? { id, content } : { id, content, children };
}

function isSafeEmbedUrlV3(provider: EmbedProvider, sourceUrl: string): boolean {
  if (sourceUrl.length > MAX_URL_LENGTH_V3) return false;
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0) {
    return false;
  }
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_PARAMETER.test(key)) return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  const hostAllowed = (suffix: string): boolean =>
    hostname === suffix || hostname.endsWith(`.${suffix}`);
  switch (provider) {
    case "bookmark":
      return true;
    case "youtube":
      return hostAllowed("youtube.com") || hostname === "youtu.be";
    case "vimeo":
      return hostAllowed("vimeo.com");
    case "figma":
      return hostAllowed("figma.com");
    case "github":
      return hostAllowed("github.com");
  }
}

function parseBlockV3(
  value: JsonValue,
  path: string,
  depth: number,
  context: V3ValidationContext,
  insideTableCell = false,
): CanonicalBlockV3 | null {
  if (depth > MAX_BLOCK_DEPTH_V3) {
    addProblem(context, path, `block depth must not exceed ${MAX_BLOCK_DEPTH_V3}`);
    return null;
  }
  if (!isJsonObject(value)) {
    addProblem(context, path, "a block must be an object");
    return null;
  }
  const declaredType = value["type"];
  if (typeof declaredType !== "string") {
    addProblem(context, `${path}.type`, "a block must declare a string type");
    return null;
  }
  if (!isKnownBlockTypeV3(declaredType)) {
    validateOpaqueJsonV3(value, path, context);
    const unknown = parseUnknownBlock(value, declaredType);
    registerIdentityV3(unknown.id, `${path}.id`, context);
    return unknown;
  }
  if (insideTableCell && declaredType === "table") {
    addProblem(context, `${path}.type`, "nested tables are outside the V1 schema");
    return null;
  }

  const id = parseIdentityV3(value["id"], `${path}.id`, context);
  if (id === null) return null;
  const rawExtraProperties = rawExtraPropertiesV3(
    value,
    BLOCK_FIELD_ORDER_V3[declaredType],
    path,
    context,
  );
  const withExtras = (parsed: CanonicalBlockV3): CanonicalBlockV3 =>
    withRawExtraV3(parsed, rawExtraProperties);
  const content = (): readonly InlineV3[] =>
    parseContentV3(value["content"], `${path}.content`, context);
  const children = (): readonly CanonicalBlockV3[] | undefined =>
    parseChildrenV3(value["children"], `${path}.children`, depth, context, insideTableCell);

  switch (declaredType) {
    case "paragraph":
      return withExtras({ type: "paragraph", id, content: content() });
    case "heading": {
      const level = value["level"];
      if (level !== 1 && level !== 2 && level !== 3) {
        addProblem(context, `${path}.level`, "must be 1, 2, or 3");
        return null;
      }
      return withExtras({ type: "heading", id, level, content: content() });
    }
    case "bulletedListItem":
    case "numberedListItem":
    case "quote":
    case "toggle": {
      const nested = children();
      const parsed =
        nested === undefined
          ? { type: declaredType, id, content: content() }
          : { type: declaredType, id, content: content(), children: nested };
      return withExtras(parsed);
    }
    case "checkbox": {
      const checked = value["checked"];
      if (typeof checked !== "boolean") {
        addProblem(context, `${path}.checked`, "must be a boolean");
        return null;
      }
      const nested = children();
      const parsed =
        nested === undefined
          ? { type: "checkbox" as const, id, checked, content: content() }
          : { type: "checkbox" as const, id, checked, content: content(), children: nested };
      return withExtras(parsed);
    }
    case "code": {
      const text = value["text"];
      const language = value["language"];
      if (
        !validateStringV3(text, `${path}.text`, context, {
          maxBytes: MAX_INLINE_BYTES_V3,
          code: true,
        })
      ) {
        return null;
      }
      if (
        language !== null &&
        !validateStringV3(language, `${path}.language`, context, { code: true })
      ) {
        return null;
      }
      if (typeof language === "string" && language.length > MAX_CODE_LANGUAGE_LENGTH_V3) {
        addProblem(context, `${path}.language`, "is too long");
        return null;
      }
      return withExtras({ type: "code", id, text, language });
    }
    case "divider":
      return withExtras({ type: "divider", id });
    case "callout": {
      const iconValue = value["icon"];
      let icon: string | null = null;
      if (iconValue !== null) {
        if (!validateStringV3(iconValue, `${path}.icon`, context)) return null;
        const graphemes = [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(iconValue),
        ];
        if (graphemes.length !== 1 || !/\p{Extended_Pictographic}/u.test(iconValue)) {
          addProblem(context, `${path}.icon`, "must be one emoji grapheme or null");
          return null;
        }
        icon = iconValue;
      }
      const tone = parseColorTokenV3(value["tone"], `${path}.tone`, context);
      if (tone === null) return null;
      const nested = children();
      const parsed =
        nested === undefined
          ? { type: "callout" as const, id, content: content(), icon, tone }
          : { type: "callout" as const, id, content: content(), icon, tone, children: nested };
      return withExtras(parsed);
    }
    case "table": {
      const rawColumns = value["columns"];
      const rawRows = value["rows"];
      if (!Array.isArray(rawColumns) || rawColumns.length < 1 || rawColumns.length > 50) {
        addProblem(context, `${path}.columns`, "must contain between 1 and 50 columns");
        return null;
      }
      if (!Array.isArray(rawRows) || rawRows.length < 1 || rawRows.length > 10_000) {
        addProblem(context, `${path}.rows`, "must contain between 1 and 10000 rows");
        return null;
      }
      const columns: TableColumnV3[] = [];
      for (const [columnIndex, rawColumn] of rawColumns.entries()) {
        const columnPath = `${path}.columns[${columnIndex}]`;
        if (!isJsonObject(rawColumn)) {
          addProblem(context, columnPath, "a column must be an object");
          continue;
        }
        for (const key of Object.keys(rawColumn)) {
          if (key !== "id" && key !== "width")
            addProblem(context, `${columnPath}.${key}`, "is not valid for a column");
        }
        const columnId = parseIdentityV3(rawColumn["id"], `${columnPath}.id`, context);
        const width = rawColumn["width"];
        if (
          width !== null &&
          (typeof width !== "number" || !Number.isInteger(width) || width < 80 || width > 1_200)
        ) {
          addProblem(context, `${columnPath}.width`, "must be null or an integer from 80 to 1200");
          continue;
        }
        if (columnId !== null) columns.push({ id: columnId, width });
      }
      const rows: TableRowV3[] = [];
      for (const [rowIndex, rawRow] of rawRows.entries()) {
        const rowPath = `${path}.rows[${rowIndex}]`;
        if (!isJsonObject(rawRow)) {
          addProblem(context, rowPath, "a row must be an object");
          continue;
        }
        for (const key of Object.keys(rawRow)) {
          if (key !== "id" && key !== "cells")
            addProblem(context, `${rowPath}.${key}`, "is not valid for a row");
        }
        const rowId = parseIdentityV3(rawRow["id"], `${rowPath}.id`, context);
        const rawCells = rawRow["cells"];
        if (!Array.isArray(rawCells) || rawCells.length !== rawColumns.length) {
          addProblem(context, `${rowPath}.cells`, "must contain exactly one cell per column");
          continue;
        }
        const cells = rawCells
          .map((rawCell, cellIndex) =>
            parseTableCellV3(rawCell, `${rowPath}.cells[${cellIndex}]`, depth, context),
          )
          .filter((cell): cell is TableCellV3 => cell !== null);
        if (rowId !== null && cells.length === rawCells.length) rows.push({ id: rowId, cells });
      }
      return withExtras({ type: "table", id, columns, rows });
    }
    case "image": {
      const fileItemId = parseUuidReferenceV3(value["fileItemId"], `${path}.fileItemId`, context);
      const caption = parseNullableTextV3(value["caption"], `${path}.caption`, context);
      const altText = parseNullableTextV3(value["altText"], `${path}.altText`, context);
      const displayWidth = value["displayWidth"];
      if (
        displayWidth !== null &&
        (typeof displayWidth !== "number" ||
          !Number.isInteger(displayWidth) ||
          displayWidth < 80 ||
          displayWidth > 2_400)
      ) {
        addProblem(context, `${path}.displayWidth`, "must be null or an integer from 80 to 2400");
        return null;
      }
      if (fileItemId === null || caption === undefined || altText === undefined) return null;
      return withExtras({ type: "image", id, fileItemId, caption, altText, displayWidth });
    }
    case "fileEmbed": {
      const fileItemId = parseUuidReferenceV3(value["fileItemId"], `${path}.fileItemId`, context);
      const caption = parseNullableTextV3(value["caption"], `${path}.caption`, context);
      if (fileItemId === null || caption === undefined) return null;
      return withExtras({ type: "fileEmbed", id, fileItemId, caption });
    }
    case "embed": {
      const providerValue = value["provider"];
      if (typeof providerValue !== "string" || !EMBED_PROVIDER_SET.has(providerValue)) {
        addProblem(context, `${path}.provider`, "must be an allowed embed provider");
        return null;
      }
      const provider = providerValue as EmbedProvider;
      const sourceUrl = value["sourceUrl"];
      if (
        !validateStringV3(sourceUrl, `${path}.sourceUrl`, context, {
          maxBytes: MAX_URL_LENGTH_V3,
        }) ||
        !isSafeEmbedUrlV3(provider, sourceUrl)
      ) {
        addProblem(
          context,
          `${path}.sourceUrl`,
          "must be an allowlisted HTTPS provider URL without secrets",
        );
        return null;
      }
      const caption = parseNullableTextV3(value["caption"], `${path}.caption`, context);
      if (caption === undefined) return null;
      return withExtras({ type: "embed", id, provider, sourceUrl, caption });
    }
  }
}

export function validateDocumentV3(body: unknown): ValidationResultV3 {
  const context: V3ValidationContext = { problems: [], identityPaths: new Map() };
  if (!isJsonObject(body)) {
    return { ok: false, problems: [{ path: "", message: "the v3 body must be an object" }] };
  }
  let byteLength: number;
  try {
    byteLength = utf8Length(JSON.stringify(body));
  } catch {
    return {
      ok: false,
      problems: [{ path: "", message: "the v3 body must be JSON serialisable" }],
    };
  }
  if (byteLength > MAX_DOCUMENT_BYTES_V3) {
    addProblem(context, "", `the v3 body must not exceed ${MAX_DOCUMENT_BYTES_V3} UTF-8 bytes`);
  }
  for (const key of Object.keys(body)) {
    if (key !== "blocks") addProblem(context, key, "is not valid at the document body level");
  }
  const rawBlocks = body["blocks"];
  if (!Array.isArray(rawBlocks)) {
    addProblem(context, "blocks", "must be an array");
    return { ok: false, problems: context.problems };
  }
  const blocks = rawBlocks
    .map((value, index) => parseBlockV3(value, `blocks[${index}]`, 1, context))
    .filter((block): block is CanonicalBlockV3 => block !== null);
  return context.problems.length === 0
    ? { ok: true, document: { blocks } }
    : { ok: false, problems: context.problems };
}

export function validatePageDocumentEnvelopeV3(value: unknown): EnvelopeValidationResultV3 {
  if (!isJsonObject(value)) {
    return { ok: false, problems: [{ path: "", message: "the envelope must be an object" }] };
  }
  const problems: ValidationProblem[] = [];
  for (const key of Object.keys(value)) {
    if (!["format", "formatVersion", "body"].includes(key)) {
      problems.push({ path: key, message: "is not valid at the envelope level" });
    }
  }
  if (value["format"] !== DOCUMENT_FORMAT) {
    problems.push({ path: "format", message: `must be ${DOCUMENT_FORMAT}` });
  }
  if (value["formatVersion"] !== DOCUMENT_FORMAT_VERSION_V3) {
    problems.push({ path: "formatVersion", message: "must be 3" });
  }
  const body = validateDocumentV3(value["body"]);
  if (!body.ok) {
    problems.push(
      ...body.problems.map((problem) => ({
        ...problem,
        path: `body${problem.path.length > 0 ? `.${problem.path}` : ""}`,
      })),
    );
  }
  if (problems.length > 0 || !body.ok) return { ok: false, problems };
  return {
    ok: true,
    envelope: {
      format: DOCUMENT_FORMAT,
      formatVersion: DOCUMENT_FORMAT_VERSION_V3,
      body: body.document,
    },
  };
}
