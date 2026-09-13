import type { Inline, JsonObject, Mark, PageDocument, Uuid } from "@myownnotion/domain";
import type { Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parseDocument } from "yaml";
import { type ImportIssue, type ImportLink, importId } from "./model.ts";
import { NotionImportError } from "./source.ts";

const MAX_FRONTMATTER_DEPTH = 64;
const MAX_FRONTMATTER_NODES = 100_000;

function validateYamlShape(document: { contents: unknown }): void {
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object") return;
    if (++nodes > MAX_FRONTMATTER_NODES || depth > MAX_FRONTMATTER_DEPTH)
      throw new NotionImportError("import.invalid-yaml");
    const node = value as Record<string, unknown>;
    if ("contents" in node) visit(node["contents"], depth + 1);
    if (Array.isArray(node["items"])) for (const item of node["items"]) visit(item, depth + 1);
    if ("key" in node) visit(node["key"], depth + 1);
    if (node["value"] !== null && typeof node["value"] === "object")
      visit(node["value"], depth + 1);
  };
  visit(document.contents, 0);
}

export function safeYaml(text: string): unknown {
  try {
    const document = parseDocument(text, { uniqueKeys: true, strict: true, intAsBigInt: true });
    if (document.errors.length || document.warnings.length) throw new Error();
    validateYamlShape(document);
    const normalize = (value: unknown): unknown => {
      if (typeof value === "bigint")
        return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
          ? Number(value)
          : value.toString();
      if (typeof value === "number" && !Number.isFinite(value)) return String(value);
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, part]) => [key, normalize(part)]),
        );
      return value;
    };
    return normalize(document.toJS({ maxAliasCount: 0 }));
  } catch {
    throw new NotionImportError("import.invalid-yaml");
  }
}
export function frontmatter(text: string): { body: string; properties: Record<string, unknown> } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { body: text, properties: {} };
  const properties = safeYaml(match[1] ?? "") ?? {};
  if (!properties || typeof properties !== "object" || Array.isArray(properties))
    throw new NotionImportError("import.invalid-frontmatter");
  return { body: text.slice(match[0].length), properties: properties as Record<string, unknown> };
}
export interface LinkResolution {
  id: Uuid | null;
  kind?: "page" | "file" | "base";
  status: ImportLink["status"];
}
/** Wiki embeds are considered only in prose, never literal code examples. */
export function markdownEmbeds(markdown: string): string[] {
  const references: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "text")
      for (const match of node.value.matchAll(/!\[\[([^\]\r\n]+)\]\]/g))
        references.push(match[1] ?? "");
    if (node.type === "image") references.push(node.url);
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }));
  return references;
}
export function convertMarkdown(input: {
  jobId: Uuid;
  path: string;
  markdown: string;
  resolve: (target: string) => LinkResolution;
  issues: ImportIssue[];
  links: ImportLink[];
}): PageDocument {
  const markdown = input.markdown;
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  let counter = 0;
  const id = () => importId(input.jobId, `block:${input.path}:${counter++}`);
  const report = (code: string) => input.issues.push({ code, sourcePath: input.path });
  const definitions = new Map(
    tree.children
      .filter((node) => node.type === "definition")
      .map((node) => [node.identifier, node.url]),
  );
  const resolved = (target: string) => {
    const result = input.resolve(target);
    input.links.push({
      sourcePath: input.path,
      sourceTarget: target,
      targetId: result.id,
      status: result.status,
    });
    if (["missing", "ambiguous", "unsafe"].includes(result.status))
      report(`import.link-${result.status}`);
    if (target.includes("#") && result.id) report("import.link-anchor-preserved-in-source");
    return result;
  };
  const source = (node: Nodes) => {
    const raw = (node.data as { importRaw?: unknown } | undefined)?.importRaw;
    return typeof raw === "string"
      ? raw
      : markdown.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
  };
  const inline = (
    nodes: readonly Nodes[],
    marks: readonly Mark[] = [],
    attachments: JsonObject[] = [],
  ): Inline[] =>
    nodes.flatMap((node): Inline[] => {
      if (node.type === "text") {
        const result: Inline[] = [];
        let offset = 0;
        for (const match of node.value.matchAll(/(!?)\[\[([^\]\r\n]+)\]\]/g)) {
          const prefix = node.value.slice(offset, match.index);
          if (prefix) result.push({ text: prefix, ...(marks.length ? { marks } : {}) });
          const [target = "", label] = (match[2] ?? "").split("|");
          const data = { importRaw: match[0] };
          result.push(
            ...inline(
              [
                match[1]
                  ? { type: "image", url: target, alt: label ?? target, data }
                  : {
                      type: "link",
                      url: target,
                      children: [{ type: "text", value: label ?? target }],
                      data,
                    },
              ],
              marks,
              attachments,
            ),
          );
          offset = (match.index ?? 0) + match[0].length;
        }
        const tail = node.value.slice(offset);
        if (tail) result.push({ text: tail, ...(marks.length ? { marks } : {}) });
        return result;
      }
      if (node.type === "break") return [{ text: "\n", ...(marks.length ? { marks } : {}) }];
      if (node.type === "inlineCode")
        return [{ text: node.value, marks: [...marks, { type: "code" }] }];
      if (node.type === "strong" || node.type === "emphasis" || node.type === "delete")
        return inline(
          node.children,
          [
            ...marks,
            {
              type:
                node.type === "strong"
                  ? "bold"
                  : node.type === "emphasis"
                    ? "italic"
                    : "strikethrough",
            },
          ],
          attachments,
        );
      if (node.type === "link" || node.type === "linkReference") {
        const target =
          node.type === "link" ? node.url : (definitions.get(node.identifier) ?? node.identifier);
        const result = resolved(target);
        if (result.id && result.kind === "file")
          attachments.push({ type: "fileEmbed", id: id(), fileItemId: result.id, caption: null });
        const mark: Mark[] =
          result.id && result.kind === "page"
            ? [{ type: "pageLink", targetItemId: result.id }]
            : result.status === "external"
              ? [{ type: "link", href: target }]
              : [];
        return inline(node.children, [...marks, ...mark], attachments);
      }
      if (node.type === "image" || node.type === "imageReference") {
        const target =
          node.type === "image" ? node.url : (definitions.get(node.identifier) ?? node.identifier);
        const result = resolved(target);
        if (result.id && result.kind === "file") {
          attachments.push({
            type: "fileEmbed",
            id: id(),
            fileItemId: result.id,
            caption: node.alt ?? null,
          });
          return [];
        }
        // Database embeds are materialized from the source definition separately.
        if (result.id && result.kind === "base") return [];
        return [{ text: source(node) }];
      }
      if (node.type === "html") {
        report("import.html-preserved-as-text");
        return [{ text: node.value }];
      }
      report(`import.markdown-${node.type}-preserved`);
      return [{ text: source(node) }];
    });
  const blocks = (nodes: readonly RootContent[]): JsonObject[] =>
    nodes.flatMap((node): JsonObject[] => {
      const attachments: JsonObject[] = [];
      if (node.type === "definition") return [];
      if (node.type === "paragraph" || node.type === "heading") {
        const content = inline(node.children, [], attachments);
        if (node.type === "heading" && node.depth > 3) report("import.heading-level-normalized");
        return [
          ...(content.length
            ? [
                {
                  id: id(),
                  type: node.type,
                  ...(node.type === "heading" ? { level: Math.min(node.depth, 3) } : {}),
                  content,
                } as unknown as JsonObject,
              ]
            : []),
          ...attachments,
        ];
      }
      if (node.type === "code")
        return [{ id: id(), type: "code", text: node.value, language: node.lang ?? null }];
      if (node.type === "thematicBreak") return [{ id: id(), type: "divider" }];
      if (node.type === "blockquote")
        return [{ id: id(), type: "quote", content: [], children: blocks(node.children) }];
      if (node.type === "list")
        return node.children.map((entry) => {
          const first = entry.children[0];
          const content =
            first?.type === "paragraph" ? inline(first.children, [], attachments) : [];
          return {
            id: id(),
            type:
              entry.checked === null || entry.checked === undefined
                ? node.ordered
                  ? "numberedListItem"
                  : "bulletedListItem"
                : "checkbox",
            ...(typeof entry.checked === "boolean" ? { checked: entry.checked } : {}),
            content,
            children: [
              ...blocks(entry.children.slice(first?.type === "paragraph" ? 1 : 0)),
              ...attachments.splice(0),
            ],
          } as unknown as JsonObject;
        });
      report(`import.markdown-${node.type}-preserved`);
      return [
        {
          id: id(),
          type: "code",
          language: node.type === "html" ? "html" : "markdown",
          text: source(node),
        },
      ];
    });
  return {
    format: "myownnotion.document+json",
    formatVersion: 2,
    body: { blocks: blocks(tree.children) },
  };
}
