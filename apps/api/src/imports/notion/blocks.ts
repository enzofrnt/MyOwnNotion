import {
  COLOR_TOKENS,
  type InlineV3,
  isSafeHref,
  type JsonObject,
  type MarkV3,
  type PageDocument,
  type Uuid,
  validatePageDocumentEnvelopeV3,
} from "@myownnotion/domain";
import { type NotionObject, object, objects, plainText, sourceId, string } from "./api-client.ts";
import { fileUrl } from "./media.ts";
import { type ImportIssue, importId } from "./model.ts";

export interface BlockConversion {
  jobId: Uuid;
  identities: Map<string, Uuid>;
  titles?: Map<string, string>;
  media: Map<string, Uuid>;
  databaseViews: Map<string, { containerItemId: Uuid; viewId: Uuid }>;
  issues: ImportIssue[];
  path: string;
  inlineScope?: string;
}
function referenceId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      !["notion.so", "www.notion.so", "notion.com", "www.notion.com", "app.notion.com"].includes(
        url.hostname,
      ) &&
      !url.hostname.endsWith(".notion.site")
    )
      return null;
    const peek = url.searchParams.get("p");
    if (peek && /^[a-f0-9]{32}$|^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(peek))
      return sourceId(peek);
    const match = url.pathname.match(
      /([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/|$)/i,
    );
    return match ? sourceId(match[1]) : null;
  } catch {
    return null;
  }
}
export function convertRichText(value: unknown, context: BlockConversion) {
  return objects(value).map((part, index) => {
    const annotations = object(part["annotations"]),
      marks: MarkV3[] = [];
    for (const type of ["bold", "italic", "underline", "strikethrough", "code"] as const)
      if (annotations[type] === true) marks.push({ type });
    const rawColor = string(annotations["color"]),
      color = rawColor.replace(/_background$/, "");
    if (COLOR_TOKENS.includes(color as (typeof COLOR_TOKENS)[number]) && color !== "default")
      marks.push({
        type: rawColor.endsWith("_background") ? "backgroundColor" : "textColor",
        color: color as (typeof COLOR_TOKENS)[number],
      });
    const mention = object(part["mention"]),
      mentionType = string(mention["type"]);
    const mentionedId = object(mention[mentionType])["id"];
    const href = string(part["href"]) || string(object(object(part["text"])["link"])["url"]);
    const ref =
      typeof mentionedId === "string" && ["page", "database"].includes(mentionType)
        ? sourceId(mentionedId)
        : referenceId(href);
    const target = ref ? context.identities.get(ref) : null;
    if (target) marks.push({ type: "pageLink", targetItemId: target });
    else if (href && href.length <= 2048 && isSafeHref(href)) marks.push({ type: "link", href });
    else if (href)
      context.issues.push({ code: "import.unsafe-link-preserved", sourcePath: context.path });
    if (ref && !target)
      context.issues.push({ code: "import.link-outside-selection", sourcePath: context.path });
    const equation =
      part["type"] === "equation" ? string(object(part["equation"])["expression"]) : null;
    if (equation !== null)
      marks.push({
        type: "equation",
        equationId: importId(
          context.jobId,
          `inline-equation:${context.path}:${context.inlineScope ?? "rich-text"}:${index}`,
        ),
        expression: equation,
      });
    if (part["type"] === "mention" && !["page", "database"].includes(mentionType))
      context.issues.push({ code: "import.mention-as-text", sourcePath: context.path });
    const text = readableText(
      equation === null
        ? plainText([part]) || (typeof mentionedId === "string" ? mentionedId : "")
        : equation.replace(/[\r\n\t]/g, " ") || "\uFFFC",
      context,
    );
    const code = marks.find((mark) => mark.type === "code");
    if (code && marks.length > 1)
      context.issues.push({
        code: "import.inline-code-format-preserved",
        sourcePath: context.path,
      });
    const nativeMarks =
      equation !== null ? marks.filter((mark) => mark.type !== "code") : code ? [code] : marks;
    return { text, ...(nativeMarks.length ? { marks: nativeMarks } : {}) };
  });
}
function readableText(value: string, context: BlockConversion): string {
  const normalized = [...value.replace(/\r\n?/g, "\n")]
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point < 32 && point !== 9 && point !== 10 ? "\uFFFD" : character;
    })
    .join("");
  if (normalized !== value)
    context.issues.push({ code: "import.text-controls-normalized", sourcePath: context.path });
  return normalized;
}
function contentLines(content: readonly InlineV3[], context: BlockConversion): InlineV3[][] {
  const lines: InlineV3[][] = [[]];
  for (const inline of content) {
    const parts = inline.text.replace(/\t/g, "    ").split("\n");
    if (inline.text.includes("\t"))
      context.issues.push({ code: "import.text-controls-normalized", sourcePath: context.path });
    for (const [index, text] of parts.entries()) {
      if (index) lines.push([]);
      lines[lines.length - 1]?.push({ ...inline, text });
    }
  }
  if (lines.length > 1)
    context.issues.push({ code: "import.soft-break-as-paragraph", sourcePath: context.path });
  return lines;
}
export function convertBlocks(
  values: readonly NotionObject[],
  context: BlockConversion,
): JsonObject[] {
  return values.flatMap((block): JsonObject[] => {
    const bid = sourceId(block["id"]),
      id = importId(context.jobId, `block:${context.path}:${bid}`);
    const type = string(block["type"]),
      data = object(block[type]);
    const content =
      type === "code" ? [] : convertRichText(data["rich_text"], { ...context, inlineScope: bid });
    const lines = type === "code" ? [content] : contentLines(content, context);
    const paragraphLines = (values: readonly InlineV3[][]): JsonObject[] =>
      values.map((content, index) => ({
        id: importId(id, `line:${index + 1}`),
        type: "paragraph",
        content: content as unknown as JsonObject[],
      }));
    const children = () =>
      convertBlocks(objects(block["import_children"]), {
        ...context,
        path: `${context.path}/${bid}`,
      });
    const notice = (code: string) => context.issues.push({ code, sourcePath: bid });
    if (type !== "callout" && data["color"] && data["color"] !== "default")
      notice("import.block-color-preserved");
    const text = (text: string, target?: Uuid): JsonObject[] => {
      const values = contentLines(
        [
          {
            text: readableText(text, context),
            ...(target ? { marks: [{ type: "pageLink" as const, targetItemId: target }] } : {}),
          },
        ],
        context,
      );
      return values.map((content, index) => ({
        id: index ? importId(id, `line:${index}`) : id,
        type: "paragraph",
        content: content as unknown as JsonObject[],
      }));
    };
    const nestedTypes: Record<string, string> = {
      bulleted_list_item: "bulletedListItem",
      numbered_list_item: "numberedListItem",
      to_do: "checkbox",
      quote: "quote",
      toggle: "toggle",
      callout: "callout",
    };
    if (type === "paragraph" || /^heading_[123]$/.test(type)) {
      if (data["is_toggleable"] === true) notice("import.toggle-heading-flattened");
      return [
        {
          id,
          type: type === "paragraph" ? "paragraph" : "heading",
          ...(type === "paragraph" ? {} : { level: Number(type.at(-1)) }),
          content: lines[0] as unknown as JsonObject[],
        },
        ...paragraphLines(lines.slice(1)),
        ...children(),
      ];
    }
    if (nestedTypes[type]) {
      const rawTone = string(data["color"]),
        tone = rawTone.replace(/_background$/, "");
      const rawIcon = string(object(data["icon"])["emoji"]);
      const icon =
        rawIcon &&
        [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(rawIcon)].length ===
          1 &&
        /\p{Extended_Pictographic}/u.test(rawIcon)
          ? rawIcon
          : null;
      if (type === "callout" && data["icon"] && !icon) notice("import.callout-icon-preserved");
      return [
        {
          id,
          type: nestedTypes[type] as string,
          content: lines[0] as unknown as JsonObject[],
          children: [...paragraphLines(lines.slice(1)), ...children()],
          ...(type === "to_do" ? { checked: data["checked"] === true } : {}),
          ...(type === "callout"
            ? {
                icon,
                tone: COLOR_TOKENS.includes(tone as (typeof COLOR_TOKENS)[number])
                  ? tone
                  : "default",
              }
            : {}),
        },
      ];
    }
    if (type === "code")
      return [
        {
          id,
          type: "code",
          text: readableText(plainText(data["rich_text"]), context),
          language: string(data["language"]) || null,
        },
      ];
    if (type === "divider") return [{ id, type: "divider" }];
    if (type === "table") {
      const rows = objects(block["import_children"]),
        width = Number(data["table_width"]);
      if (!Number.isSafeInteger(width) || width < 1 || width > 50 || !rows.length) {
        notice("import.table-preserved");
        return text("Tableau Notion conservé dans les sources");
      }
      if (data["has_column_header"] || data["has_row_header"])
        notice("import.table-header-style-preserved");
      return [
        {
          id,
          type: "table",
          columns: Array.from({ length: width }, (_, i) => ({
            id: importId(id, `column:${i}`),
            width: null,
          })),
          rows: rows.map((row) => ({
            id: importId(id, `row:${string(row["id"])}`),
            cells: Array.from({ length: width }, (_, i) => ({
              id: importId(id, `cell:${string(row["id"])}:${i}`),
              content: convertRichText(
                (object(row["table_row"])["cells"] as unknown[] | undefined)?.[i],
                { ...context, inlineScope: `${bid}:${string(row["id"])}:${i}` },
              ) as unknown as JsonObject[],
            })),
          })),
        },
      ];
    }
    if (type === "child_page" || type === "link_to_page") {
      const link = type === "child_page" ? bid : sourceId(data[string(data["type"])]);
      const target = context.identities.get(link);
      if (!target) notice("import.link-outside-selection");
      return text(string(data["title"]) || context.titles?.get(link) || "Page Notion", target);
    }
    if (type === "child_database") {
      const view = context.databaseViews.get(bid);
      return view
        ? [{ id, type: "databaseView", ...view }]
        : text(
            string(data["title"]) || context.titles?.get(bid) || "Base Notion",
            context.identities.get(bid),
          );
    }
    if (["image", "file", "pdf", "video", "audio"].includes(type)) {
      const fileItemId = context.media.get(`block:${bid}`),
        caption = plainText(data["caption"]) || null;
      if (fileItemId)
        return [
          {
            id,
            type: type === "image" ? "image" : "fileEmbed",
            fileItemId,
            caption,
            ...(type === "image" ? { altText: caption, displayWidth: null } : {}),
          },
        ];
      const url = fileUrl(data);
      return [
        {
          id,
          type: "paragraph",
          content: [
            {
              text: caption || url || "Fichier Notion",
              ...(url.length <= 2048 && isSafeHref(url)
                ? { marks: [{ type: "link", href: url }] }
                : {}),
            },
          ],
        },
      ];
    }
    if (type === "bookmark" || type === "embed" || type === "link_preview") {
      const url = string(data["url"]);
      const candidate = {
        id,
        type: "embed",
        provider: "bookmark",
        sourceUrl: url,
        caption: plainText(data["caption"]) || null,
      };
      const parsed = validatePageDocumentEnvelopeV3({
        format: "myownnotion.document+json",
        formatVersion: 3,
        body: { blocks: [candidate] },
      });
      if (parsed.ok) return [candidate];
      notice("import.embed-as-link");
      return [
        {
          id,
          type: "paragraph",
          content: [
            {
              text: url,
              ...(url.length <= 2048 && isSafeHref(url)
                ? { marks: [{ type: "link", href: url }] }
                : {}),
            },
          ],
        },
      ];
    }
    if (type === "equation")
      return [{ id, type: "equation", expression: string(data["expression"]) }];
    if (type === "table_of_contents") return [{ id, type: "tableOfContents" }];
    if (type === "synced_block") {
      if (block["import_source_unavailable"] === true)
        return text("Bloc synchronisé Notion inaccessible — original conservé dans les sources");
      notice("import.synced-block-materialized");
      return children();
    }
    if (type === "column_list" || type === "column") {
      notice("import.columns-flattened");
      return children();
    }
    notice(`import.block-${type || "unknown"}-preserved`);
    return [
      ...text(
        plainText(data["rich_text"]) ||
          string(data["expression"]) ||
          `Bloc Notion ${type} conservé dans les sources`,
      ),
      ...children(),
    ];
  });
}
export function convertNotionDocument(
  values: readonly NotionObject[],
  context: BlockConversion,
): PageDocument {
  return {
    format: "myownnotion.document+json",
    formatVersion: 3,
    body: { blocks: convertBlocks(values, context) },
  };
}
