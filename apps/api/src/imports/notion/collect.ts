import {
  checkAbort,
  type NotionApiClient,
  type NotionObject,
  object,
  objects,
  parentId,
  sourceId,
  string,
  title,
} from "./api-client.ts";
import { downloadNotionMedia, fileUrl, notionMediaUrl } from "./media.ts";
import { digest, NotionImportError, SOURCE_LIMITS } from "./source.ts";

export interface CollectedMedia {
  key: string;
  ownerId: string;
  name: string;
  mediaType: string;
  base64: string;
}
export interface NotionCollection {
  version: 1;
  roots: string[];
  pages: NotionObject[];
  databases: NotionObject[];
  sources: NotionObject[];
  blocks: Record<string, NotionObject[]>;
  views: NotionObject[];
  media: CollectedMedia[];
  issues: Array<{ code: string; sourcePath: string }>;
}
export async function collectNotion(
  client: NotionApiClient,
  selection: {
    roots?: readonly string[];
    all?: boolean;
    signal?: AbortSignal | undefined;
    download?: typeof downloadNotionMedia;
    onProgress?: (objects: number) => void;
    onVerification?: (objects: number, total: number) => void;
  },
): Promise<NotionCollection> {
  const discovered = await client.discover();
  const catalog = new Map(discovered.map((entry) => [sourceId(entry["id"]), entry]));
  const selected = selection.all
    ? discovered
        .filter(
          (entry) =>
            object(entry["parent"])["type"] !== "data_source_id" &&
            (!parentId(entry) || !catalog.has(parentId(entry) as string)),
        )
        .map((entry) => sourceId(entry["id"]))
    : (selection.roots ?? []).map(sourceId);
  if (!selected.length) throw new NotionImportError("import.selection-required");
  const result: NotionCollection = {
    version: 1,
    roots: [...new Set(selected)].sort(),
    pages: [],
    databases: [],
    sources: [],
    blocks: {},
    views: [],
    media: [],
    issues: [],
  };
  const visited = new Set<string>();
  const activeBlocks = new Set<string>();
  const checks = new Map<string, { path: string; edited: unknown }>();
  let bytes = 0;
  let count = 0;
  const downloadCache = new Map<string, ReturnType<typeof downloadNotionMedia>>();
  const reserve = (value: unknown) => {
    checkAbort(selection.signal);
    if (++count > SOURCE_LIMITS.entries) throw new NotionImportError("import.source-too-large");
    if (count % 100 === 0) selection.onProgress?.(count);
    bytes += new TextEncoder().encode(JSON.stringify(value)).length;
    if (bytes > SOURCE_LIMITS.totalBytes) throw new NotionImportError("import.source-too-large");
  };
  const media = async (value: unknown, key: string, ownerId: string) => {
    const url = fileUrl(value);
    if (!url || result.media.some((entry) => entry.key === key)) return;
    if (object(value)["type"] !== "file" || !notionMediaUrl(url)) {
      result.issues.push({ code: "import.external-media-link-retained", sourcePath: key });
      return;
    }
    try {
      const sourceUrl = new URL(url);
      const assetKey = `${sourceUrl.origin}${sourceUrl.pathname}`;
      let download = downloadCache.get(assetKey);
      if (!download) {
        download = (selection.download ?? downloadNotionMedia)(url, { signal: selection.signal });
        downloadCache.set(assetKey, download);
      }
      const downloaded = await download;
      const originalName =
        string(object(value)["name"]) ||
        decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "fichier");
      const name =
        [...originalName]
          .map((character) =>
            character.charCodeAt(0) < 32 || character === "/" || character === "\\"
              ? "_"
              : character,
          )
          .join("")
          .slice(0, 200) || "fichier";
      if (name !== originalName)
        result.issues.push({ code: "import.media-name-adjusted", sourcePath: key });
      const entry = {
        key,
        ownerId,
        name,
        mediaType: downloaded.mediaType,
        base64: Buffer.from(downloaded.bytes).toString("base64"),
      };
      reserve(entry);
      result.media.push(entry);
    } catch (error) {
      checkAbort(selection.signal);
      if (error instanceof NotionImportError && error.code === "import.source-too-large")
        throw error;
      result.issues.push({ code: "import.media-download-failed", sourcePath: key });
    }
  };
  const blocks = async (id: string, ownerId: string, depth: number): Promise<NotionObject[]> => {
    if (depth > SOURCE_LIMITS.depth) throw new NotionImportError("import.depth-limit");
    if (activeBlocks.has(id)) {
      result.issues.push({ code: "import.synced-block-cycle", sourcePath: id });
      return [];
    }
    if (result.blocks[id]) return result.blocks[id];
    activeBlocks.add(id);
    try {
      const children = await client.paginate(`/blocks/${id}/children`);
      for (const block of children) {
        reserve(block);
        const bid = sourceId(block["id"]),
          type = string(block["type"]),
          data = object(block[type]);
        if (type === "child_page") await visit(bid, depth + 1, "page");
        else if (type === "child_database") await visit(bid, depth + 1, "database");
        else if (type === "synced_block") {
          const original = object(data["synced_from"])["block_id"];
          const origin = typeof original === "string" ? sourceId(original) : bid;
          try {
            block["import_children"] = await blocks(origin, ownerId, depth + 1);
          } catch (error) {
            if (
              origin === bid ||
              !(error instanceof NotionImportError) ||
              !["import.notion-not-found", "import.notion-forbidden"].includes(error.code) ||
              error.sourcePath !== `/blocks/${origin}/children`
            )
              throw error;
            block["import_source_unavailable"] = true;
            result.issues.push({ code: "import.synced-block-source-unavailable", sourcePath: bid });
          }
        } else if (block["has_children"] === true)
          block["import_children"] = await blocks(bid, ownerId, depth + 1);
        if (["image", "file", "pdf", "video", "audio"].includes(type))
          await media(data, `block:${bid}`, ownerId);
      }
      result.blocks[id] = children;
      return children;
    } finally {
      activeBlocks.delete(id);
    }
  };
  const visit = async (rawId: string, depth: number, hint?: string): Promise<void> => {
    checkAbort(selection.signal);
    if (depth > SOURCE_LIMITS.depth) throw new NotionImportError("import.depth-limit");
    const id = sourceId(rawId);
    if (visited.has(id)) return;
    visited.add(id);
    let kind = hint ?? string(catalog.get(id)?.["object"]);
    let value: NotionObject;
    if (!kind) {
      try {
        value = await client.request(`/pages/${id}`);
        kind = "page";
      } catch (error) {
        if (!(error instanceof NotionImportError) || error.code !== "import.notion-not-found")
          throw error;
        value = await client.request(`/databases/${id}`);
        kind = "database";
      }
    } else
      value = await client.request(
        `/${kind === "page" ? "pages" : kind === "data_source" ? "data_sources" : "databases"}/${id}`,
      );
    reserve(value);
    if (kind === "data_source") {
      const owner = parentId(value);
      if (!owner) throw new NotionImportError("import.source-owner-missing");
      // Visiting a selected source pulls its owner and sibling sources so one
      // database remains one owner, rather than synthesizing duplicate bases.
      await visit(owner, depth + 1, "database");
      if (result.sources.some((entry) => sourceId(entry["id"]) === id)) return;
      result.sources.push(value);
      checks.set(id, { path: `/data_sources/${id}`, edited: value["last_edited_time"] });
      const rows = await client.paginate(`/data_sources/${id}/query`, {});
      for (const row of rows) {
        catalog.set(sourceId(row["id"]), row);
        await visit(sourceId(row["id"]), depth + 1, "page");
      }
      // Search may expose accessible entries absent from a source query
      // (for example templates). Keep them in their source as ordinary pages.
      for (const entry of discovered)
        if (entry["object"] === "page" && parentId(entry) === id)
          await visit(sourceId(entry["id"]), depth + 1, "page");
    } else if (kind === "database") {
      result.databases.push(value);
      checks.set(id, { path: `/databases/${id}`, edited: value["last_edited_time"] });
      for (const entry of objects(value["data_sources"]))
        await visit(sourceId(entry["id"]), depth + 1, "data_source");
      try {
        const views = await client.paginate(`/views?database_id=${id}`);
        for (const view of views) {
          const full = await client.request(`/views/${sourceId(view["id"])}`);
          reserve(full);
          result.views.push(full);
          checks.set(sourceId(full["id"]), {
            path: `/views/${sourceId(full["id"])}`,
            edited: full["last_edited_time"],
          });
        }
      } catch (error) {
        if (
          !(error instanceof NotionImportError) ||
          ![
            "import.notion-not-found",
            "import.notion-forbidden",
            "import.notion-request-refused",
          ].includes(error.code)
        )
          throw error;
        result.issues.push({ code: "import.views-unavailable", sourcePath: id });
      }
      await media(value["icon"], `icon:${id}`, id);
    } else {
      result.pages.push(value);
      if (value["is_template"] === true)
        result.issues.push({ code: "import.database-template-as-page", sourcePath: id });
      checks.set(id, { path: `/pages/${id}`, edited: value["last_edited_time"] });
      if (object(value["parent"])["type"] === "data_source_id") {
        const sid = parentId(value);
        if (sid) await visit(sid, depth + 1, "data_source");
      }
      const properties = object(value["properties"]);
      for (const [name, raw] of Object.entries(properties)) {
        const prop = object(raw),
          type = string(prop["type"]);
        if (["title", "rich_text", "relation"].includes(type)) {
          const pid = string(prop["id"]);
          if (pid) {
            const full = await client.paginate(`/pages/${id}/properties/${pid}`);
            prop[type] = full.map((part) => part[type]);
            prop["has_more"] = false;
            reserve(prop);
            properties[name] = prop;
          }
        }
        if (type === "files")
          for (const [index, entry] of objects(prop["files"]).entries())
            await media(entry, `property:${id}:${name}:${index}`, id);
      }
      result.blocks[id] = await blocks(id, id, depth + 1);
      await media(value["icon"], `icon:${id}`, id);
    }
  };
  for (const id of result.roots) await visit(id, 0);
  if (selection.all) for (const entry of discovered) await visit(sourceId(entry["id"]), 0);
  let verified = 0;
  selection.onVerification?.(verified, checks.size);
  for (const { path, edited } of checks.values()) {
    const current = await client.request(path);
    if (current["last_edited_time"] !== edited)
      throw new NotionImportError("import.source-changed-during-read");
    if (++verified % 50 === 0 || verified === checks.size)
      selection.onVerification?.(verified, checks.size);
  }
  return result;
}
export const collectionDigest = (collection: NotionCollection) =>
  digest(JSON.stringify(collection));
export function discoveryReport(entries: readonly NotionObject[]) {
  return entries.map((entry) => ({
    id: sourceId(entry["id"]),
    type: string(entry["object"]),
    title: title(entry),
    parentId: parentId(entry),
  }));
}
