import type {
  BlockDocument,
  BlockDocumentV3,
  CanonicalBlockV3,
  EmbedProvider,
  Inline,
  InlineV3,
  JsonObject,
  Mark,
  MarkV3,
  Uuid,
} from "@myownnotion/domain";
import {
  COLOR_TOKENS,
  childrenOfV3,
  EMBED_PROVIDERS,
  generateUuidV7,
  normaliseDocument,
  normaliseDocumentV3,
  normaliseInlineV3,
  serialiseDocumentV3,
  validateDocumentV3,
} from "@myownnotion/domain";
import type { EditorBlock, EditorPartialBlock } from "./blocknote-schema.ts";
import {
  parseEditorTableColumns,
  serialiseEditorTableColumns,
  TABLE_COLUMNS_PROP,
} from "./custom-blocks/table.tsx";
import { pageLinkTargetFromHref } from "./page-link-href.ts";

type VisibleBlock = EditorBlock | EditorPartialBlock;
type VisibleInline = {
  readonly type?: string;
  readonly text?: string;
  readonly styles?: Record<string, unknown>;
  readonly props?: Record<string, unknown>;
  readonly href?: string;
  readonly content?: readonly VisibleInline[];
};

function rawBlock(block: CanonicalBlockV3): JsonObject {
  const blocks = serialiseDocumentV3({ blocks: [block] })["blocks"];
  const raw = Array.isArray(blocks) ? blocks[0] : undefined;
  if (raw === null || Array.isArray(raw) || typeof raw !== "object") {
    throw new TypeError(`block ${block.id} cannot be serialised as canonical JSON`);
  }
  return raw;
}

function stylesForMarks(marks: readonly MarkV3[] | undefined): Record<string, boolean | string> {
  const styles: Record<string, boolean | string> = {};
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
      case "italic":
      case "underline":
      case "code":
        styles[mark.type] = true;
        break;
      case "strikethrough":
        styles["strike"] = true;
        break;
      case "textColor":
      case "backgroundColor":
        styles[mark.type] = mark.color;
        break;
      case "link":
      case "pageLink":
      case "unknown":
        break;
    }
  }
  return styles;
}

function inlineToBlockNote(content: readonly InlineV3[]): unknown[] {
  const result: unknown[] = [];
  for (const inline of normaliseInlineV3(content)) {
    const styles = stylesForMarks(inline.marks);
    const link = inline.marks?.find((mark) => mark.type === "link" || mark.type === "pageLink");
    const text = { type: "text", text: inline.text, styles };
    if (link?.type === "link") {
      result.push({ type: "link", href: link.href, content: [text] });
    } else if (link?.type === "pageLink") {
      result.push({
        type: "pageLink",
        props: { targetItemId: link.targetItemId },
        content: [text],
      });
    } else {
      result.push(text);
    }
  }
  return result;
}

function partialBlock(value: unknown): EditorPartialBlock {
  return value as EditorPartialBlock;
}

function opaqueBlock(block: CanonicalBlockV3): EditorPartialBlock {
  const raw = block.type === "unknown" ? block.raw : rawBlock(block);
  const declaredType = block.type === "unknown" ? block.declaredType : block.type;
  return partialBlock({
    id: block.id,
    type: "unknown",
    props: {
      declaredType,
      rawJson: JSON.stringify(raw),
      syntheticId: block.type === "unknown" && block.syntheticId,
    },
  });
}

function hasUnknownMark(content: readonly InlineV3[]): boolean {
  return content.some((inline) => inline.marks?.some((mark) => mark.type === "unknown") === true);
}

/** Known future fields/marks are readable but not safely editable by this client. */
function requiresOpaqueProjection(block: CanonicalBlockV3): boolean {
  if (block.type === "unknown") return true;
  if (block.rawExtraProperties !== undefined && Object.keys(block.rawExtraProperties).length > 0) {
    return true;
  }
  if ("content" in block && hasUnknownMark(block.content)) return true;
  if (block.type === "table") {
    return block.rows.some((row) => row.cells.some((cell) => hasUnknownMark(cell.content)));
  }
  return false;
}

function blockToBlockNote(block: CanonicalBlockV3): EditorPartialBlock {
  if (requiresOpaqueProjection(block)) return opaqueBlock(block);
  const children = childrenOfV3(block).map(blockToBlockNote);
  const withChildren = children.length === 0 ? {} : { children };
  switch (block.type) {
    case "paragraph":
      return partialBlock({
        id: block.id,
        type: "paragraph",
        content: inlineToBlockNote(block.content),
      });
    case "heading":
      return partialBlock({
        id: block.id,
        type: "heading",
        props: { level: block.level },
        content: inlineToBlockNote(block.content),
      });
    case "bulletedListItem":
      return partialBlock({
        id: block.id,
        type: "bulletListItem",
        content: inlineToBlockNote(block.content),
        ...withChildren,
      });
    case "numberedListItem":
      return partialBlock({
        id: block.id,
        type: "numberedListItem",
        content: inlineToBlockNote(block.content),
        ...withChildren,
      });
    case "checkbox":
      return partialBlock({
        id: block.id,
        type: "checkListItem",
        props: { checked: block.checked },
        content: inlineToBlockNote(block.content),
        ...withChildren,
      });
    case "quote":
      return partialBlock({
        id: block.id,
        type: "quote",
        content: inlineToBlockNote(block.content),
        ...withChildren,
      });
    case "code":
      return partialBlock({
        id: block.id,
        type: "codeBlock",
        props: { language: block.language ?? "" },
        content: block.text,
      });
    case "divider":
      return partialBlock({ id: block.id, type: "divider" });
    case "toggle":
      return partialBlock({
        id: block.id,
        type: "toggleListItem",
        content: inlineToBlockNote(block.content),
        ...withChildren,
      });
    case "callout":
      return partialBlock({
        id: block.id,
        type: "callout",
        props: { icon: block.icon ?? "", tone: block.tone },
        content: inlineToBlockNote(block.content),
        ...withChildren,
      });
    case "table":
      return partialBlock({
        id: block.id,
        type: "table",
        props: { [TABLE_COLUMNS_PROP]: serialiseEditorTableColumns(block.columns) },
        children: block.rows.map((row) =>
          partialBlock({
            id: row.id,
            type: "tableRow",
            children: row.cells.map((cell) =>
              partialBlock({
                id: cell.id,
                type: "tableCell",
                content: inlineToBlockNote(cell.content),
                ...(cell.children === undefined
                  ? {}
                  : { children: cell.children.map(blockToBlockNote) }),
              }),
            ),
          }),
        ),
      });
    case "image":
      return partialBlock({
        id: block.id,
        type: "image",
        props: {
          fileItemId: block.fileItemId,
          caption: block.caption ?? "",
          altText: block.altText ?? "",
          displayWidth: block.displayWidth ?? 0,
        },
      });
    case "fileEmbed":
      return partialBlock({
        id: block.id,
        type: "fileEmbed",
        props: { fileItemId: block.fileItemId, caption: block.caption ?? "" },
      });
    case "embed":
      return partialBlock({
        id: block.id,
        type: "embed",
        props: {
          provider: block.provider,
          sourceUrl: block.sourceUrl,
          caption: block.caption ?? "",
        },
      });
    case "unknown":
      return opaqueBlock(block);
  }
}

export function canonicalDocumentToBlockNote(document: BlockDocumentV3): EditorPartialBlock[] {
  return normaliseDocumentV3(document).blocks.map(blockToBlockNote);
}

/** Gives an empty page one stable canonical identity before BlockNote mounts. */
export function ensureEditableDocument(document: BlockDocumentV3): BlockDocumentV3 {
  if (document.blocks.length > 0) return document;
  return {
    blocks: [{ type: "paragraph", id: generateUuidV7(), content: [] }],
  };
}

function marksFromStyles(styles: Record<string, unknown> | undefined): MarkV3[] {
  const result: MarkV3[] = [];
  if (styles?.["bold"] === true) result.push({ type: "bold" });
  if (styles?.["italic"] === true) result.push({ type: "italic" });
  if (styles?.["underline"] === true) result.push({ type: "underline" });
  if (styles?.["strike"] === true) result.push({ type: "strikethrough" });
  if (styles?.["code"] === true) result.push({ type: "code" });
  for (const type of ["textColor", "backgroundColor"] as const) {
    const color = styles?.[type];
    if (typeof color === "string" && COLOR_TOKENS.includes(color as never)) {
      result.push({ type, color: color as (typeof COLOR_TOKENS)[number] });
    }
  }
  return result;
}

export function blockNoteInlineToCanonical(content: unknown): readonly InlineV3[] {
  if (typeof content === "string") {
    return content === "" ? [] : [{ text: content }];
  }
  if (!Array.isArray(content)) return [];
  const result: InlineV3[] = [];
  for (const entry of content as VisibleInline[]) {
    if (entry === null || typeof entry !== "object") continue;
    if (entry.type === "text") {
      const text = "text" in entry && typeof entry.text === "string" ? entry.text : "";
      const styles = "styles" in entry ? (entry.styles as Record<string, unknown>) : undefined;
      const marks = marksFromStyles(styles);
      if (text !== "") result.push(marks.length === 0 ? { text } : { text, marks });
      continue;
    }
    if (entry.type === "link") {
      const href = "href" in entry && typeof entry.href === "string" ? entry.href : "";
      const pageTarget = pageLinkTargetFromHref(href);
      const linkMark: MarkV3 =
        pageTarget === null
          ? { type: "link", href }
          : { type: "pageLink", targetItemId: pageTarget };
      const linkedContent = "content" in entry && Array.isArray(entry.content) ? entry.content : [];
      for (const child of linkedContent) {
        if (child === null || typeof child !== "object" || !("text" in child)) continue;
        const text = typeof child.text === "string" ? child.text : "";
        const styles = "styles" in child ? (child.styles as Record<string, unknown>) : undefined;
        const marks = [...marksFromStyles(styles), linkMark];
        if (text !== "") result.push({ text, marks });
      }
      continue;
    }
    if (entry.type === "pageLink") {
      const rawTarget = entry.props?.["targetItemId"];
      const pageTarget = pageLinkTargetFromHref(
        typeof rawTarget === "string" ? `#page=${rawTarget}` : null,
      );
      if (pageTarget === null) continue;
      const linkedContent = "content" in entry && Array.isArray(entry.content) ? entry.content : [];
      for (const child of linkedContent) {
        if (child === null || typeof child !== "object" || !("text" in child)) continue;
        const text = typeof child.text === "string" ? child.text : "";
        const styles = "styles" in child ? (child.styles as Record<string, unknown>) : undefined;
        const marks: MarkV3[] = [
          ...marksFromStyles(styles),
          { type: "pageLink", targetItemId: pageTarget },
        ];
        if (text !== "") result.push({ text, marks });
      }
    }
  }
  return normaliseInlineV3(result);
}

function propsOf(block: VisibleBlock): Record<string, unknown> {
  return (block.props ?? {}) as Record<string, unknown>;
}

function childrenOfVisible(block: VisibleBlock): readonly VisibleBlock[] {
  return (block.children ?? []) as readonly VisibleBlock[];
}

function opaqueFromBlockNote(block: VisibleBlock): CanonicalBlockV3 {
  const props = propsOf(block);
  const declaredType =
    typeof props["declaredType"] === "string" ? props["declaredType"] : "unknown";
  const rawJson = typeof props["rawJson"] === "string" ? props["rawJson"] : "{}";
  let raw: JsonObject;
  try {
    const parsed: unknown = JSON.parse(rawJson);
    raw =
      parsed !== null && !Array.isArray(parsed) && typeof parsed === "object"
        ? (parsed as JsonObject)
        : { type: declaredType };
  } catch {
    raw = { type: declaredType };
  }

  const validated = validateDocumentV3({ blocks: [raw] });
  const candidate = validated.ok ? validated.document.blocks[0] : undefined;
  if (candidate !== undefined && candidate.type !== "unknown") return candidate;
  return {
    type: "unknown",
    id: block.id as Uuid,
    declaredType,
    raw,
    syntheticId: props["syntheticId"] === true,
  };
}

function unknownVisibleBlock(
  block: VisibleBlock,
  declaredType = String(block.type),
): CanonicalBlockV3 {
  const id = typeof block.id === "string" ? (block.id as Uuid) : generateUuidV7();
  return {
    type: "unknown",
    id,
    declaredType,
    raw: {
      type: declaredType,
      id,
      editorProps: JSON.parse(JSON.stringify(propsOf(block))) as JsonObject,
    },
    syntheticId: false,
  };
}

function tableFromBlockNote(block: VisibleBlock): CanonicalBlockV3 {
  const columns = parseEditorTableColumns(propsOf(block)[TABLE_COLUMNS_PROP]);
  if (columns === null) return unknownVisibleBlock(block, "table");
  const rowBlocks = childrenOfVisible(block);
  if (rowBlocks.length < 1 || rowBlocks.some((row) => row.type !== "tableRow")) {
    return unknownVisibleBlock(block, "table");
  }
  const rows = [];
  for (const row of rowBlocks) {
    const cellBlocks = childrenOfVisible(row);
    if (
      cellBlocks.length !== columns.length ||
      cellBlocks.some((cell) => cell.type !== "tableCell")
    ) {
      return unknownVisibleBlock(block, "table");
    }
    rows.push({
      id: row.id as Uuid,
      cells: cellBlocks.map((cell) => {
        const children = childrenOfVisible(cell).map(blockNoteBlockToCanonical);
        return {
          id: cell.id as Uuid,
          content: blockNoteInlineToCanonical("content" in cell ? cell.content : undefined),
          ...(children.length === 0 ? {} : { children }),
        };
      }),
    });
  }
  return { type: "table", id: block.id as Uuid, columns, rows };
}

export function blockNoteBlockToCanonical(block: VisibleBlock): CanonicalBlockV3 {
  const id = block.id as Uuid;
  const children = childrenOfVisible(block).map(blockNoteBlockToCanonical);
  const withChildren = children.length === 0 ? {} : { children };
  const content = blockNoteInlineToCanonical("content" in block ? block.content : undefined);
  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", id, content };
    case "heading": {
      const level = propsOf(block)["level"];
      return {
        type: "heading",
        id,
        level: level === 2 || level === 3 ? level : 1,
        content,
      };
    }
    case "bulletListItem":
      return { type: "bulletedListItem", id, content, ...withChildren };
    case "numberedListItem":
      return { type: "numberedListItem", id, content, ...withChildren };
    case "checkListItem":
      return {
        type: "checkbox",
        id,
        checked: propsOf(block)["checked"] === true,
        content,
        ...withChildren,
      };
    case "quote":
      return { type: "quote", id, content, ...withChildren };
    case "codeBlock": {
      const language = propsOf(block)["language"];
      return {
        type: "code",
        id,
        text: content.map((inline) => inline.text).join(""),
        language: typeof language === "string" && language !== "" ? language : null,
      };
    }
    case "divider":
      return { type: "divider", id };
    case "toggleListItem":
      return { type: "toggle", id, content, ...withChildren };
    case "callout": {
      const icon = propsOf(block)["icon"];
      const tone = propsOf(block)["tone"];
      return {
        type: "callout",
        id,
        content,
        icon: typeof icon === "string" && icon !== "" ? icon : null,
        tone:
          typeof tone === "string" && COLOR_TOKENS.includes(tone as never)
            ? (tone as (typeof COLOR_TOKENS)[number])
            : "default",
        ...withChildren,
      };
    }
    case "table":
      return tableFromBlockNote(block);
    case "image": {
      const props = propsOf(block);
      const displayWidth = props["displayWidth"];
      return {
        type: "image",
        id,
        fileItemId: String(props["fileItemId"] ?? "") as Uuid,
        caption:
          typeof props["caption"] === "string" && props["caption"] !== "" ? props["caption"] : null,
        altText:
          typeof props["altText"] === "string" && props["altText"] !== "" ? props["altText"] : null,
        displayWidth: typeof displayWidth === "number" && displayWidth > 0 ? displayWidth : null,
      };
    }
    case "fileEmbed": {
      const props = propsOf(block);
      return {
        type: "fileEmbed",
        id,
        fileItemId: String(props["fileItemId"] ?? "") as Uuid,
        caption:
          typeof props["caption"] === "string" && props["caption"] !== "" ? props["caption"] : null,
      };
    }
    case "embed": {
      const props = propsOf(block);
      const provider = props["provider"];
      if (typeof provider !== "string" || !EMBED_PROVIDERS.includes(provider as EmbedProvider)) {
        return unknownVisibleBlock(block, "embed");
      }
      return {
        type: "embed",
        id,
        provider: provider as EmbedProvider,
        sourceUrl: String(props["sourceUrl"] ?? ""),
        caption:
          typeof props["caption"] === "string" && props["caption"] !== "" ? props["caption"] : null,
      };
    }
    case "unknown":
      return opaqueFromBlockNote(block);
    case "tableRow":
    case "tableCell":
      return unknownVisibleBlock(block);
    default:
      return unknownVisibleBlock(block);
  }
}

export function blockNoteDocumentToCanonical(blocks: readonly VisibleBlock[]): BlockDocumentV3 {
  return normaliseDocumentV3({ blocks: blocks.map(blockNoteBlockToCanonical) });
}

function inlineV3ToV2(content: readonly InlineV3[]): Inline[] {
  return content.map((inline) => {
    const marks: Mark[] = [];
    for (const mark of inline.marks ?? []) {
      switch (mark.type) {
        case "bold":
        case "italic":
        case "code":
          marks.push({ type: mark.type });
          break;
        case "strikethrough":
          marks.push({ type: "strikethrough" });
          break;
        case "link":
          marks.push({ type: "link", href: mark.href });
          break;
        case "pageLink":
          marks.push({ type: "pageLink", targetItemId: mark.targetItemId });
          break;
        case "underline":
        case "textColor":
        case "backgroundColor":
        case "unknown":
          break;
      }
    }
    return marks.length === 0 ? { text: inline.text } : { text: inline.text, marks };
  });
}

function blockV3ToV2(block: CanonicalBlockV3): BlockDocument["blocks"][number] {
  if (block.type === "unknown") return block;
  const children = childrenOfV3(block).map(blockV3ToV2);
  const withChildren = children.length === 0 ? {} : { children };
  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", id: block.id, content: inlineV3ToV2(block.content) };
    case "heading":
      return {
        type: "heading",
        id: block.id,
        level: block.level,
        content: inlineV3ToV2(block.content),
      };
    case "bulletedListItem":
    case "numberedListItem":
    case "quote":
      return {
        type: block.type,
        id: block.id,
        content: inlineV3ToV2(block.content),
        ...withChildren,
      };
    case "checkbox":
      return {
        type: "checkbox",
        id: block.id,
        checked: block.checked,
        content: inlineV3ToV2(block.content),
        ...withChildren,
      };
    case "code":
      return { type: "code", id: block.id, text: block.text, language: block.language };
    case "divider":
      return { type: "divider", id: block.id };
    case "fileEmbed":
      return {
        type: "fileEmbed",
        id: block.id,
        fileItemId: block.fileItemId,
        caption: block.caption,
      };
    case "toggle":
    case "callout":
    case "table":
    case "image":
    case "embed":
      return {
        type: "unknown",
        id: block.id,
        declaredType: block.type,
        raw: rawBlock(block),
        syntheticId: false,
      };
  }
}

/** Temporary v2 projection used only by the legacy save bridge until US5. */
export function canonicalV3ToLegacyV2(document: BlockDocumentV3): BlockDocument {
  return normaliseDocument({ blocks: document.blocks.map(blockV3ToV2) });
}
