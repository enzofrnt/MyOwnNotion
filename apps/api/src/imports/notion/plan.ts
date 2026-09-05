import { posix } from "node:path";
import {
  createInitialDatabaseDefinition,
  type DatabaseDefinition,
  type DatabaseProperty,
  type NonRelationPropertyValue,
  normalizeCivilDate,
  readDocumentBody,
  type Uuid,
  validateDatabaseDefinition,
} from "@myownnotion/domain";
import { parse } from "csv-parse/sync";
import {
  convertMarkdown,
  frontmatter,
  type LinkResolution,
  markdownEmbeds,
  safeYaml,
} from "./markdown.ts";
import {
  type ImportDatabase,
  type ImportFile,
  type ImportFolder,
  type ImportIssue,
  type ImportPage,
  type ImportPlan,
  type ImportReport,
  importId,
} from "./model.ts";
import { digest, type ImportSnapshot, NotionImportError, sourceText } from "./source.ts";

const blank = () => ({
  format: "myownnotion.document+json" as const,
  formatVersion: 2,
  body: { blocks: [] },
});
const stem = (path: string) => path.replace(/\.[^./]+$/, "");
const notionTitle = (path: string) => posix.basename(stem(path)).replace(/ [a-f0-9]{32}$/i, "");
const wikiTarget = (value: string) => value.replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? value;
const canonical = (value: string) =>
  wikiTarget(value)
    .replace(/\.(?:md|base)$/i, "")
    .normalize("NFC")
    .toLowerCase();
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function mediaType(path: string): string {
  return (
    (
      {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".pdf": "application/pdf",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".md": "text/markdown",
        ".csv": "text/csv",
        ".base": "application/yaml",
        ".svg": "image/svg+xml",
        ".gif": "image/gif",
        ".webp": "image/webp",
      } as Record<string, string>
    )[posix.extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}
interface DatabaseSource {
  key: string;
  path: string;
  name: string;
  host: ImportPage;
  members: ImportPage[];
  view: Record<string, unknown> | null;
}
export function planNotionImport(
  snapshot: ImportSnapshot,
  jobId = importId("snapshot", snapshot.digest),
): ImportPlan {
  const rootId = importId(jobId, "root");
  const originalsId = importId(jobId, "originals");
  const issues: ImportIssue[] = [];
  const folders: ImportFolder[] = [
    { id: rootId, name: "Import Notion", parentId: null },
    { id: originalsId, name: "Sources importées", parentId: rootId },
  ];
  const folderIds = new Map<string, Uuid>([[".", rootId]]);
  const folder = (path: string): Uuid => {
    const existing = folderIds.get(path);
    if (existing) return existing;
    const parentId = folder(posix.dirname(path));
    const id = importId(jobId, `folder:${path}`);
    folders.push({ id, name: posix.basename(path).slice(0, 255), parentId });
    folderIds.set(path, id);
    return id;
  };
  const originalFolderIds = new Map<string, Uuid>([[".", originalsId]]);
  const originalFolder = (path: string): Uuid => {
    const existing = originalFolderIds.get(path);
    if (existing) return existing;
    const parentId = originalFolder(posix.dirname(path));
    const id = importId(jobId, `original-folder:${path}`);
    folders.push({ id, name: posix.basename(path).slice(0, 255), parentId });
    originalFolderIds.set(path, id);
    return id;
  };
  for (const path of snapshot.directories ?? []) folder(path);
  const pages: ImportPage[] = [];
  const files: ImportFile[] = [];
  const bodies = new Map<Uuid, string>();
  const report: ImportReport = {
    adapter: snapshot.files.some((file) => posix.extname(file.path).toLowerCase() === ".base")
      ? "obsidian"
      : "notion",
    snapshotDigest: snapshot.digest,
    importId: jobId,
    totals: {
      sourceFiles: snapshot.files.length,
      sourceBytes: snapshot.totalBytes,
      pages: 0,
      folders: 0,
      attachments: 0,
      originals: 0,
      databases: 0,
      memberships: 0,
      links: 0,
      issues: 0,
    },
    pages: [],
    folders: [],
    files: [],
    links: [],
    properties: [],
    databases: [],
    issues,
  };
  const byPath = new Map<string, { id: Uuid; kind: "page" | "file" | "base" }>();
  const addPage = (
    path: string,
    title: string,
    body: string,
    properties: Record<string, unknown>,
  ) => {
    if (pages.some((page) => page.path === path))
      throw new NotionImportError("import.duplicate-identity");
    if (title.length > 255) issues.push({ code: "import.title-shortened", sourcePath: path });
    const page: ImportPage = {
      id: importId(jobId, `page:${path}`),
      path,
      title: title.trim().slice(0, 255) || "Sans titre",
      parentId: folder(posix.dirname(path)),
      document: blank(),
      properties,
    };
    pages.push(page);
    bodies.set(page.id, body);
    byPath.set(path, { id: page.id, kind: "page" });
    return page;
  };
  for (const source of snapshot.files) {
    const extension = posix.extname(source.path).toLowerCase();
    const original = [".md", ".csv", ".base"].includes(extension);
    const file: ImportFile = {
      id: importId(jobId, `file:${source.path}`),
      path: source.path,
      name: posix.basename(source.path).slice(0, 255),
      parentId: original
        ? originalFolder(posix.dirname(source.path))
        : folder(posix.dirname(source.path)),
      mediaType: mediaType(source.path),
      original,
    };
    files.push(file);
    report.files.push({
      path: source.path,
      bytes: source.bytes.length,
      sha256: source.sha256,
      outcome: original ? "converted-and-original-preserved" : "file-preserved",
      canonicalId: file.id,
      parentId: file.parentId,
      original,
    });
    if (extension === ".md") {
      const parsed = frontmatter(sourceText(source));
      addPage(
        source.path,
        /^#\s+(.+)$/m.exec(parsed.body)?.[1] ?? notionTitle(source.path),
        parsed.body,
        parsed.properties,
      );
    } else if (extension === ".base")
      byPath.set(source.path, { id: importId(jobId, `database:${source.path}`), kind: "base" });
    else if (extension !== ".csv") byPath.set(source.path, { id: file.id, kind: "file" });
  }
  const resolveLink = (from: string, raw: string): LinkResolution => {
    let target: string;
    try {
      target = decodeURIComponent(wikiTarget(raw)).split("#")[0] ?? "";
    } catch {
      return { id: null, status: "unsafe" };
    }
    if (/^https?:\/\//i.test(target)) {
      const notionId = /(?:notion\.so|notion\.site)\/.+?([a-f0-9]{32})(?:\?|$)/i.exec(target)?.[1];
      if (notionId) {
        const matches = [...byPath].filter(([path]) => path.includes(notionId));
        if (matches.length === 1 && matches[0]) return { ...matches[0][1], status: "resolved" };
      }
      return { id: null, status: "external" };
    }
    if (/^mailto:/i.test(target)) return { id: null, status: "external" };
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      target.includes("\\") ||
      [...target].some((character) => character.charCodeAt(0) < 32)
    )
      return { id: null, status: "unsafe" };
    if (!target) {
      const own = byPath.get(from);
      return own ? { ...own, status: "resolved" } : { id: null, status: "missing" };
    }
    const relative = posix.normalize(posix.join(posix.dirname(from), target));
    if (relative.startsWith("../") || posix.isAbsolute(target))
      return { id: null, status: "unsafe" };
    const candidates = [
      relative,
      target,
      `${relative}.md`,
      `${target}.md`,
      `${relative}.base`,
      `${target}.base`,
    ]
      .map((path) => byPath.get(path.normalize("NFC")))
      .filter((value) => value !== undefined);
    const unique = new Map(candidates.map((value) => [value.id, value]));
    const one = [...unique.values()][0];
    if (unique.size === 1 && one) return { ...one, status: "resolved" };
    if (unique.size > 1) return { id: null, status: "ambiguous" };
    const fallback = [...byPath].filter(
      ([path]) =>
        canonical(path) === canonical(target) ||
        canonical(posix.basename(path)) === canonical(target),
    );
    if (fallback.length === 1 && fallback[0]) return { ...fallback[0][1], status: "resolved" };
    return { id: null, status: fallback.length > 1 ? "ambiguous" : "missing" };
  };
  // Notion subpage folders share their basename with the containing Markdown page.
  for (const page of pages) {
    const parent = pages.find((other) => stem(other.path) === posix.dirname(page.path));
    if (parent) page.parentId = parent.id;
  }
  for (const file of files.filter((value) => !value.original)) {
    const parent = pages.find((page) => stem(page.path) === posix.dirname(file.path));
    if (parent) file.parentId = parent.id;
  }
  const sources: DatabaseSource[] = [];
  for (const source of snapshot.files) {
    const extension = posix.extname(source.path).toLowerCase();
    if (extension !== ".base" && extension !== ".csv") continue;
    const referencedHosts = pages.filter((page) =>
      markdownEmbeds(bodies.get(page.id) ?? "").some(
        (reference) => resolveLink(page.path, reference).id === byPath.get(source.path)?.id,
      ),
    );
    const host =
      referencedHosts[0] ??
      pages.find((page) => stem(page.path) === stem(source.path)) ??
      addPage(`${stem(source.path)}.import-host.md`, notionTitle(source.path), "", {});
    let key = `csv:${source.path}`;
    const members: ImportPage[] = [];
    let view: Record<string, unknown> | null = null;
    if (extension === ".base") {
      const base = record(safeYaml(sourceText(source)));
      if (!base) throw new NotionImportError("import.invalid-base");
      const filters = record(base["filters"]);
      const expressions = Array.isArray(filters?.["and"])
        ? filters["and"]
        : typeof base["filters"] === "string"
          ? [base["filters"]]
          : [];
      const expression =
        expressions.length === 1 && typeof expressions[0] === "string" ? expressions[0] : "";
      const match =
        /^\s*note\[(?:"base"|'base')\]\s*==\s*link\((?:"([^"]+)"|'([^']+)')\)\s*$/.exec(
          expression,
        ) ?? /^\s*note\.base\s*==\s*link\((?:"([^"]+)"|'([^']+)')\)\s*$/.exec(expression);
      if (!match)
        issues.push({
          code: "import.base-filter-unsupported",
          sourcePath: source.path,
          blocking: true,
        });
      else {
        const value = match[1] ?? match[2] ?? "";
        key = `base:${canonical(value)}`;
        members.push(
          ...pages.filter(
            (page) =>
              typeof page.properties["base"] === "string" &&
              canonical(page.properties["base"]) === canonical(value),
          ),
        );
      }
      view = Array.isArray(base["views"]) ? record(base["views"][0]) : null;
      if (Array.isArray(base["views"]) && base["views"].length > 1)
        issues.push({
          code: "import.additional-views-preserved-in-source",
          sourcePath: source.path,
        });
      if (view?.["type"] !== "table") {
        issues.push({ code: "import.base-view-unsupported", sourcePath: source.path });
        view = null;
      }
      const otherSettings = [
        ...Object.keys(base).filter((key) => !["filters", "views"].includes(key)),
        ...Object.keys(view ?? {}).filter((key) => !["name", "type", "order"].includes(key)),
      ];
      if (otherSettings.length)
        issues.push({
          code: "import.base-settings-preserved-in-source",
          sourcePath: source.path,
          detail: [...new Set(otherSettings)].sort().join(", "),
        });
      if (base["formulas"] || base["summaries"])
        issues.push({ code: "import.base-formulas-preserved-in-source", sourcePath: source.path });
    } else {
      let rows: string[][];
      try {
        rows = parse(sourceText(source), {
          bom: true,
          skip_empty_lines: true,
          max_record_size: 8 * 1024 * 1024,
        }) as string[][];
      } catch {
        throw new NotionImportError("import.invalid-csv");
      }
      const header = rows[0] ?? [];
      if (
        header.length === 0 ||
        header.some((value) => !value.trim()) ||
        new Set(header).size !== header.length
      )
        throw new NotionImportError("import.invalid-csv");
      for (const [index, row] of rows.slice(1).entries()) {
        const title = row[0] ?? "Sans titre";
        const resolved = resolveLink(source.path, title);
        let page = resolved.id
          ? pages.find((candidate) => candidate.id === resolved.id)
          : undefined;
        if (!page) {
          const matched = pages.filter(
            (candidate) =>
              posix.dirname(candidate.path) === stem(source.path) && candidate.title === title,
          );
          if (matched.length > 1 || resolved.status === "ambiguous")
            issues.push({
              code: "import.csv-row-ambiguous",
              sourcePath: source.path,
              blocking: true,
            });
          page = matched.length === 1 ? matched[0] : undefined;
        }
        if (!page) {
          page = addPage(`${stem(source.path)}/row-${index + 1}.import.md`, title, "", {});
          issues.push({ code: "import.csv-page-content-unavailable", sourcePath: source.path });
        }
        if (members.some((member) => member.id === page.id))
          issues.push({
            code: "import.csv-row-ambiguous",
            sourcePath: source.path,
            blocking: true,
          });
        for (let column = 1; column < header.length; column++) {
          const name = header[column];
          if (name === undefined) throw new NotionImportError("import.invalid-csv");
          const value = row[column] ?? "";
          if (
            page.properties[name] !== undefined &&
            JSON.stringify(page.properties[name]) !== JSON.stringify(value)
          )
            issues.push({
              code: "import.csv-property-preserved-separately",
              sourcePath: page.path,
              detail: name,
            });
          page.properties[name] = value;
        }
        members.push(page);
      }
    }
    for (const displayHost of referencedHosts.length ? referencedHosts : [host])
      sources.push({
        key,
        path: source.path,
        name: notionTitle(source.path),
        host: displayHost,
        members: [...new Map(members.map((page) => [page.id, page])).values()],
        view,
      });
  }
  const groups = new Map<string, DatabaseSource[]>();
  for (const source of sources) groups.set(source.key, [...(groups.get(source.key) ?? []), source]);
  const databases: ImportDatabase[] = [];
  for (const displays of groups.values()) {
    const first = displays[0];
    if (!first) continue;
    const source = {
      ...first,
      members: [
        ...new Map(
          displays.flatMap((display) => display.members).map((page) => [page.id, page]),
        ).values(),
      ],
    };
    const id = importId(jobId, `database:${source.key}`),
      titlePropertyId = importId(id, "title"),
      initialViewId = importId(id, "view"),
      embeddingId = importId(id, "embedding");
    const initial = createInitialDatabaseDefinition({
      type: "database.create",
      id,
      name: source.name,
      titlePropertyId,
      initialViewId,
      initialViewName:
        typeof source.view?.["name"] === "string"
          ? source.view["name"]
          : "Import — table par défaut",
      placement: { id: embeddingId, parentItemId: null, positionKey: "a" },
    });
    const properties: DatabaseProperty[] = [...initial.properties];
    const fields = [...new Set(source.members.flatMap((page) => Object.keys(page.properties)))]
      .filter((name) => name !== "base")
      .sort();
    for (const page of source.members) {
      if (page.databaseId || source.host.id === page.id)
        issues.push({
          code: "import.database-membership-conflict",
          sourcePath: page.path,
          blocking: true,
        });
      if (page.properties["base"] !== undefined)
        report.properties.push({
          sourcePath: page.path,
          name: "base",
          representation: "database-membership",
        });
      page.databaseId = id;
      page.values = {};
      page.relationTargets = {};
    }
    for (const [index, name] of fields.entries()) {
      const propertyId = importId(id, `property:${name}`);
      const values = source.members
        .map((page) => page.properties[name])
        .filter((value) => value !== undefined && value !== null && value !== "");
      const every = (predicate: (value: unknown) => boolean) =>
        values.length > 0 && values.every(predicate);
      const type = every((value) => typeof value === "boolean")
        ? "checkbox"
        : every((value) => typeof value === "number" && Number.isFinite(value))
          ? "number"
          : every((value) => typeof value === "string" && normalizeCivilDate(value).ok)
            ? "date"
            : /^(status|statut|état)$/i.test(name) && every((value) => typeof value === "string")
              ? "status"
              : every(
                    (value) =>
                      Array.isArray(value) &&
                      value.every(
                        (part) => typeof part === "string" && /^\[\[.+\]\]$/.test(part),
                      ) &&
                      source.members
                        .filter((page) => page.properties[name] === value)
                        .every((page) =>
                          value.every((part) => resolveLink(page.path, part).kind === "page"),
                        ),
                  )
                ? "relation"
                : "text";
      const optionLabels = type === "status" ? [...new Set(values as string[])].sort() : [];
      const options = optionLabels.map((label, optionIndex) => ({
        id: importId(propertyId, label),
        label,
        positionKey: `a${String(optionIndex).padStart(5, "0")}`,
        tone: "default",
        state: "active" as const,
      }));
      properties.push({
        id: propertyId,
        name,
        type,
        positionKey: `a${String(index).padStart(5, "0")}`,
        state: "active",
        config:
          type === "date"
            ? { mode: "date" }
            : type === "status"
              ? { options }
              : type === "relation"
                ? { cardinality: "many" }
                : {},
      } as DatabaseProperty);
      for (const page of source.members) {
        const value = page.properties[name];
        report.properties.push({ sourcePath: page.path, name, representation: type });
        if (value === undefined || value === null || value === "") continue;
        let converted: NonRelationPropertyValue;
        if (type === "relation") {
          const targets: Uuid[] = [];
          for (const reference of value as string[]) {
            const resolved = resolveLink(page.path, reference);
            report.links.push({
              sourcePath: page.path,
              sourceTarget: reference,
              targetId: resolved.id,
              status: resolved.status,
            });
            if (resolved.id && resolved.kind === "page") targets.push(resolved.id);
            else
              issues.push({
                code: "import.property-link-unresolved",
                sourcePath: page.path,
                detail: name,
              });
          }
          (page.relationTargets as Record<Uuid, readonly Uuid[]>)[propertyId] = [
            ...new Set(targets),
          ];
          continue;
        }
        if (type === "checkbox") converted = { kind: "checkbox", checked: value as boolean };
        else if (type === "number") converted = { kind: "number", decimal: String(value) };
        else if (type === "date") converted = { kind: "date", date: value as string };
        else if (type === "status")
          converted = { kind: "status", optionId: importId(propertyId, value as string) };
        else
          converted = {
            kind: "text",
            value: typeof value === "string" ? value : JSON.stringify(value),
          };
        if (page.values === undefined) throw new NotionImportError("import.invalid-plan");
        page.values[propertyId] = converted;
      }
    }
    const displayedProperties = (view: Record<string, unknown> | null) => {
      const order = Array.isArray(view?.["order"])
        ? view["order"]
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.replace(/^note\./, ""))
        : [];
      return [...properties]
        .sort((a, b) => {
          const ai = order.indexOf(a.name),
            bi = order.indexOf(b.name);
          return (ai < 0 ? 10000 : ai) - (bi < 0 ? 10000 : bi);
        })
        .map((property, index) => ({
          propertyId: property.id,
          visible: true,
          positionKey: `a${String(index).padStart(5, "0")}`,
        }));
    };
    const views = initial.views.map((view) => ({
      ...view,
      properties: displayedProperties(source.view),
    }));
    const embeddings = displays.map((display, index) => ({
      id: index === 0 ? embeddingId : importId(id, `embedding:${display.path}:${display.host.id}`),
      hostPageId: display.host.id,
      state: "active" as const,
      views: views.map((view) => ({
        ...view,
        id: index === 0 ? initialViewId : importId(id, `view:${display.path}:${display.host.id}`),
        name:
          typeof display.view?.["name"] === "string"
            ? display.view["name"]
            : "Import — table par défaut",
        properties: displayedProperties(display.view),
      })),
    }));
    for (const display of displays) byPath.set(display.path, { id, kind: "base" });
    const definition: DatabaseDefinition = {
      ...initial,
      name: source.name,
      properties,
      views,
      embeddings,
    };
    databases.push({
      id,
      path: source.path,
      name: source.name,
      hostPageId: source.host.id,
      titlePropertyId,
      initialViewId,
      embeddingId,
      definition,
      memberIds: source.members.map((page) => page.id),
    });
    for (const [index, display] of displays.entries())
      report.databases.push({
        path: display.path,
        id,
        hostPageId: display.host.id,
        members: source.members.length,
        memberIds: source.members.map((page) => page.id),
        embeddingId: embeddings[index]?.id ?? embeddingId,
        membershipReference: source.key,
        retained: display.view ? ["first-table-name", "first-table-property-order"] : [],
        presentation: display.view ? "exported-table" : "default-table",
        missing: [
          "original-board-calendar-gallery-configuration",
          "original-previews",
          "automation",
          "permissions",
          "revision-history",
          "task-role-configuration",
        ],
      });
  }
  for (const page of pages) {
    const propertyStrings = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : Array.isArray(value)
          ? value.flatMap(propertyStrings)
          : record(value)
            ? Object.values(record(value) ?? {}).flatMap(propertyStrings)
            : [];
    for (const [name, value] of Object.entries(page.properties))
      for (const text of propertyStrings(value)) {
        for (const match of text.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
          const reference = match[0];
          // Relationship conversion already recorded these same source references.
          if (
            report.links.some(
              (link) => link.sourcePath === page.path && link.sourceTarget === reference,
            )
          )
            continue;
          const resolved = resolveLink(page.path, reference);
          report.links.push({
            sourcePath: page.path,
            sourceTarget: reference,
            targetId: resolved.id,
            status: resolved.status,
          });
          if (
            resolved.status === "missing" ||
            resolved.status === "ambiguous" ||
            resolved.status === "unsafe"
          )
            issues.push({
              code: `import.property-link-${resolved.status}`,
              sourcePath: page.path,
              detail: name,
            });
        }
      }
    page.document = convertMarkdown({
      jobId,
      path: page.path,
      markdown: bodies.get(page.id) ?? "",
      resolve: (target) => resolveLink(page.path, target),
      issues,
      links: report.links,
    });
    if (!page.databaseId && Object.keys(page.properties).length) {
      (page.document.body["blocks"] as unknown[]).push({
        id: importId(jobId, `metadata:${page.path}`),
        type: "code",
        language: "yaml",
        text: JSON.stringify(page.properties, null, 2),
      });
      for (const name of Object.keys(page.properties))
        report.properties.push({
          sourcePath: page.path,
          name,
          representation: "preserved-metadata",
        });
    }
  }
  report.pages = pages.map((page) => ({
    sourcePath: page.path,
    id: page.id,
    title: page.title,
    parentId: page.parentId,
    databaseId: page.databaseId ?? null,
    blocks: (page.document.body["blocks"] as unknown[]).length,
    synthesized: !snapshot.files.some((file) => file.path === page.path),
  }));
  report.folders = folders;
  for (const file of report.files)
    file.parentId = files.find((value) => value.id === file.canonicalId)?.parentId ?? file.parentId;
  report.totals = {
    ...report.totals,
    pages: pages.length,
    folders: folders.length,
    attachments: files.filter((file) => !file.original).length,
    originals: files.filter((file) => file.original).length,
    databases: databases.length,
    memberships: databases.reduce((sum, database) => sum + database.memberIds.length, 0),
    links: report.links.length,
    issues: issues.length,
  };
  for (const page of pages) {
    const parsed = readDocumentBody(page.document.body);
    if (parsed.kind !== "blocks" || !parsed.result.ok)
      issues.push({ code: "import.invalid-document", sourcePath: page.path, blocking: true });
  }
  for (const database of databases)
    if (!validateDatabaseDefinition(database.definition).ok)
      issues.push({ code: "import.invalid-definition", sourcePath: database.path, blocking: true });
  try {
    creationOrder({ folders, pages, databases });
  } catch (error) {
    if (!(error instanceof NotionImportError)) throw error;
    issues.push({ code: error.code, sourcePath: "", blocking: true });
  }
  report.totals.issues = issues.length;
  const fingerprint = digest(
    JSON.stringify({
      version: 1,
      id: jobId,
      snapshot: snapshot.digest,
      folders,
      pages,
      files,
      databases,
    }),
  );
  return {
    version: 1,
    id: jobId,
    rootId,
    fingerprint,
    snapshot,
    folders,
    pages,
    files,
    databases,
    report,
  };
}

/** Dependency planning happens before any target connection or backup is changed. */
export function creationOrder(
  plan: Pick<ImportPlan, "folders" | "pages" | "databases">,
): Array<{ kind: "page" | "database"; id: Uuid }> {
  const existing = new Set(plan.folders.map((folder) => folder.id));
  const pending = [
    ...plan.pages.map((page) => ({
      kind: "page" as const,
      id: page.id,
      dependencies: [page.parentId, ...(page.databaseId ? [page.databaseId] : [])],
    })),
    ...plan.databases.map((source) => ({
      kind: "database" as const,
      id: source.id,
      dependencies: [source.hostPageId],
    })),
  ];
  const order: Array<{ kind: "page" | "database"; id: Uuid }> = [];
  while (pending.length) {
    const index = pending.findIndex((item) => item.dependencies.every((id) => existing.has(id)));
    if (index < 0) throw new NotionImportError("import.cyclic-dependencies");
    const item = pending.splice(index, 1)[0];
    if (!item) throw new NotionImportError("import.invalid-plan");
    order.push(item);
    existing.add(item.id);
  }
  return order;
}
