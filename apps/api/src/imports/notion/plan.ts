import {
  type DatabaseProperty,
  generateUuidV7,
  type NonRelationPropertyValue,
  type Uuid,
  validateDatabaseDefinition,
  validatePageDocumentEnvelopeV3,
} from "@myownnotion/domain";
import { object, objects, parentId, sourceId, string, title } from "./api-client.ts";
import { convertNotionDocument } from "./blocks.ts";
import type { NotionCollection } from "./collect.ts";
import {
  type ImportDatabase,
  type ImportFile,
  type ImportPage,
  type ImportPlan,
  importId,
} from "./model.ts";
import { convertProperty, convertValue, position, relationIds } from "./properties.ts";
import { digest, NotionImportError, SOURCE_LIMITS, type SourceFile } from "./source.ts";
import { convertViews } from "./views.ts";

export interface NotionPlanOptions {
  readonly excludedDatabaseIds?: readonly string[];
}

/** A database/page can belong to a layout block rather than directly to a page. */
export function notionBlockOwners(collection: NotionCollection): Map<string, string> {
  const owners = new Map<string, string>();
  const walk = (blocks: NotionCollection["pages"], owner: string) => {
    for (const block of blocks) {
      owners.set(sourceId(block["id"]), owner);
      walk(objects(block["import_children"]), owner);
    }
  };
  for (const page of collection.pages) {
    const id = sourceId(page["id"]);
    walk(collection.blocks[id] ?? [], id);
  }
  return owners;
}

export function planNotionImport(
  originalCollection: NotionCollection,
  jobId = generateUuidV7(),
  options: NotionPlanOptions = {},
): ImportPlan {
  const blockOwners = notionBlockOwners(originalCollection);
  const resolvedParent = (value: NotionCollection["pages"][number]) => {
    const id = parentId(value);
    return id === null
      ? null
      : object(value["parent"])["type"] === "block_id"
        ? (blockOwners.get(id) ?? id)
        : id;
  };
  const excluded = new Set((options.excludedDatabaseIds ?? []).map(sourceId));
  for (const id of excluded)
    if (!originalCollection.databases.some((value) => sourceId(value["id"]) === id))
      throw new NotionImportError("import.excluded-database-missing");
  let grew = true;
  while (grew) {
    grew = false;
    for (const value of [
      ...originalCollection.databases,
      ...originalCollection.sources,
      ...originalCollection.pages,
    ]) {
      const parent = resolvedParent(value),
        id = sourceId(value["id"]);
      if (parent && excluded.has(parent) && !excluded.has(id)) {
        excluded.add(id);
        grew = true;
      }
    }
  }
  const included = (value: NotionCollection["pages"][number]) =>
    !excluded.has(sourceId(value["id"]));
  const collection: NotionCollection = {
    ...originalCollection,
    pages: originalCollection.pages.filter(included),
    databases: originalCollection.databases.filter(included),
    sources: originalCollection.sources.filter(included),
    media: originalCollection.media.filter((media) => !excluded.has(media.ownerId)),
    views: originalCollection.views.filter(
      (view) =>
        !excluded.has(string(view["data_source_id"])) && !excluded.has(resolvedParent(view) ?? ""),
    ),
  };
  const rootId = importId(jobId, "root");
  const issues = [
    ...collection.issues,
    ...(options.excludedDatabaseIds ?? []).map((id) => ({
      code: "import.database-excluded",
      sourcePath: sourceId(id),
    })),
  ];
  const identities = new Map<string, Uuid>();
  const titles = new Map<string, string>();
  for (const value of [...collection.pages, ...collection.databases, ...collection.sources]) {
    const id = sourceId(value["id"]);
    identities.set(id, importId(jobId, `${string(value["object"])}:${id}`));
    titles.set(id, title(value));
    if (title(value).length > 255) issues.push({ code: "import.name-shortened", sourcePath: id });
  }
  const destination = (id: string) => {
    const value = identities.get(id);
    if (!value) throw new NotionImportError("import.identity-missing");
    return value;
  };
  const files: ImportFile[] = [];
  const media = new Map<string, Uuid>();
  const assets = new Map<string, Uuid>();
  const snapshotFiles: SourceFile[] = [];
  const includedMedia = collection.media.filter((entry) => !entry.key.startsWith("cover:"));
  for (const entry of includedMedia) {
    const bytes = new Uint8Array(Buffer.from(entry.base64, "base64"));
    const hash = digest(bytes);
    const existingAsset = assets.get(hash);
    if (existingAsset) {
      media.set(entry.key, existingAsset);
      continue;
    }
    const id = importId(jobId, `media:${hash}`),
      path = `media/${id}`;
    media.set(entry.key, id);
    assets.set(hash, id);
    snapshotFiles.push({ path, bytes, sha256: digest(bytes) });
    // Files cannot be direct children of a database page; attach those under
    // the import root. Editorial media stays beside its page content.
    const owner = collection.pages.some((page) => sourceId(page["id"]) === entry.ownerId)
      ? destination(entry.ownerId)
      : rootId;
    files.push({
      id,
      path,
      name: entry.name,
      parentId: owner,
      mediaType: entry.mediaType,
      original: false,
    });
  }
  const original = new TextEncoder().encode(
    JSON.stringify({
      ...originalCollection,
      media: originalCollection.media.filter((entry) => !entry.key.startsWith("cover:")),
    }),
  );
  if (original.length > SOURCE_LIMITS.totalBytes)
    throw new NotionImportError("import.source-too-large");
  snapshotFiles.push({ path: "notion-snapshot.json", bytes: original, sha256: digest(original) });
  const dbBySource = new Map<string, ImportDatabase>();
  const propMaps = new Map<string, Map<string, DatabaseProperty>>();
  const databases = collection.databases.map((raw, index): ImportDatabase => {
    const nid = sourceId(raw["id"]),
      id = destination(nid),
      parent = resolvedParent(raw);
    const icon = string(object(raw["icon"])["emoji"]);
    if (parent && collection.databases.some((database) => sourceId(database["id"]) === parent))
      issues.push({ code: "import.nested-database-page-membership", sourcePath: nid });
    if (raw["icon"] && !icon)
      issues.push({ code: "import.page-icon-as-attachment", sourcePath: nid });
    const database: ImportDatabase = {
      id,
      path: nid,
      name: title(raw).slice(0, 255),
      ...(icon ? { icon } : {}),
      parentId: parent && identities.has(parent) ? destination(parent) : rootId,
      sources: [],
      views: [],
      positionKey: position(index),
    };
    for (const [sourceIndex, rawSource] of collection.sources
      .filter((value) => parentId(value) === nid)
      .entries()) {
      const sid = sourceId(rawSource["id"]),
        sourceTargetId = destination(sid);
      const rows = collection.pages.filter((page) => parentId(page) === sid);
      const map = new Map<string, DatabaseProperty>();
      const properties = Object.entries(object(rawSource["properties"])).flatMap(
        ([name, raw], i) => {
          if (["people", "created_by", "last_edited_by"].includes(string(object(raw)["type"]))) {
            issues.push({ code: "import.property-people-ignored", sourcePath: sid });
            return [];
          }
          const prop = convertProperty(jobId, sid, name, object(raw), i, rows, issues);
          map.set(string(object(raw)["id"]), prop);
          try {
            map.set(decodeURIComponent(string(object(raw)["id"])), prop);
          } catch {
            /* Retain the raw ID. */
          }
          map.set(name, prop);
          return [prop];
        },
      );
      const titleProp = properties.find((prop) => prop.type === "title");
      if (!titleProp) throw new NotionImportError("import.title-property-missing");
      const views = convertViews(
        jobId,
        sid,
        properties,
        map,
        collection.views.filter((view) => view["data_source_id"] === sid && parentId(view) === nid),
        issues,
      );
      const view = views[0];
      if (!view) throw new NotionImportError("import.view-missing");
      const definition = {
        format: "myownnotion.database-definition+json" as const,
        formatVersion: 1 as const,
        databaseId: id,
        name: title(rawSource).slice(0, 255),
        properties,
        views,
        taskRoles: null,
      };
      if (!validateDatabaseDefinition(definition).ok)
        throw new NotionImportError("import.invalid-definition", sid);
      database.sources.push({
        id: sourceTargetId,
        name: title(rawSource).slice(0, 255),
        titlePropertyId: titleProp.id,
        initialViewId: view.id,
        definition,
      });
      database.views.push(
        ...views.map((view) => ({
          ...view,
          positionKey: position(sourceIndex * 100 + views.indexOf(view)),
          sourceId: sourceTargetId,
        })),
      );
      dbBySource.set(sid, database);
      propMaps.set(sid, map);
    }
    if (!database.sources.length) issues.push({ code: "import.empty-database", sourcePath: nid });
    return database;
  });
  // Linked views belong to their display container, while their properties
  // belong to the referenced source. Build them after all source maps exist.
  for (const database of databases) {
    const rawViews = collection.views.filter((view) => parentId(view) === database.path);
    for (const rawView of rawViews) {
      const sid = string(rawView["data_source_id"]);
      if (dbBySource.get(sid)?.id === database.id) continue;
      const map = propMaps.get(sid);
      const source = dbBySource
        .get(sid)
        ?.sources.find((source) => source.id === identities.get(sid));
      if (!map || !source) {
        issues.push({
          code: "import.view-source-outside-selection",
          sourcePath: string(rawView["id"]),
        });
        continue;
      }
      const views = convertViews(jobId, sid, source.definition.properties, map, [rawView], issues);
      database.views.push(
        ...views.map((view) => ({
          ...view,
          positionKey: position(database.views.length),
          sourceId: source.id,
        })),
      );
    }
  }
  const databaseViews = new Map(
    databases.flatMap((db) => {
      const raw = collection.databases.find((row) => sourceId(row["id"]) === db.path);
      if (typeof raw?.["is_inline"] !== "boolean")
        issues.push({ code: "import.database-presentation-unknown", sourcePath: db.path });
      return raw?.["is_inline"] === true && db.views[0]
        ? [[db.path, { containerItemId: db.id, viewId: db.views[0].id }] as const]
        : [];
    }),
  );
  const pages = collection.pages.map((raw, index): ImportPage => {
    const nid = sourceId(raw["id"]),
      id = destination(nid),
      parent = resolvedParent(raw);
    const database = parent ? dbBySource.get(parent) : undefined;
    const values: Record<Uuid, NonRelationPropertyValue> = {},
      relations: Record<Uuid, Uuid[]> = {};
    const map = parent ? propMaps.get(parent) : undefined;
    for (const [name, rawValue] of Object.entries(object(raw["properties"]))) {
      const value = object(rawValue),
        prop = map?.get(string(value["id"])) ?? map?.get(name);
      if (!prop) continue;
      if (prop.type === "relation")
        relations[prop.id] = relationIds(value, identities, issues, nid);
      else {
        const converted = convertValue(prop, value, issues, nid);
        if (converted) values[prop.id] = converted;
      }
    }
    const document = convertNotionDocument(collection.blocks[nid] ?? [], {
      jobId,
      identities,
      titles,
      media,
      databaseViews,
      issues,
      path: nid,
    });
    if (!validatePageDocumentEnvelopeV3(document).ok)
      throw new NotionImportError("import.invalid-document", nid);
    const icon = string(object(raw["icon"])["emoji"]);
    if (raw["icon"] && !icon)
      issues.push({ code: "import.page-icon-as-attachment", sourcePath: nid });
    if (!database && parent && !identities.has(parent))
      issues.push({ code: "import.parent-outside-selection", sourcePath: nid });
    return {
      id,
      path: nid,
      title: title(raw).slice(0, 255),
      parentId: database?.id ?? (parent && identities.has(parent) ? destination(parent) : rootId),
      document,
      positionKey: position(index),
      ...(icon ? { icon } : {}),
      ...(database && parent
        ? {
            databaseId: database.id,
            sourceId: destination(parent),
            values,
            relationTargets: relations,
          }
        : {}),
    };
  });
  const totalBytes = snapshotFiles.reduce((sum, file) => sum + file.bytes.length, 0);
  if (totalBytes > SOURCE_LIMITS.totalBytes) throw new NotionImportError("import.source-too-large");
  const snapshot = {
    files: snapshotFiles,
    totalBytes,
    digest: digest(snapshotFiles.map((file) => `${file.path}:${file.sha256}`).join("\n")),
  };
  const folders = [{ id: rootId, name: "Import Notion", parentId: null }];
  const report = {
    adapter: "notion-api" as const,
    importId: jobId,
    snapshotDigest: snapshot.digest,
    totals: {
      pages: pages.length,
      databases: databases.length,
      sources: collection.sources.length,
      memberships: pages.filter((page) => page.databaseId).length,
      attachments: assets.size,
      originals: 1,
      sourceBytes: totalBytes,
      issues: issues.length,
    },
    identities: [...identities].map(([sourceId, targetId]) => ({
      sourceId,
      targetId,
      kind: collection.sources.some((source) => source["id"] === sourceId)
        ? "source"
        : collection.databases.some((db) => db["id"] === sourceId)
          ? "database"
          : "page",
    })),
    issues,
  };
  const plan: ImportPlan = {
    version: 2,
    excludedDatabaseIds: (options.excludedDatabaseIds ?? []).map(sourceId),
    id: jobId,
    rootId,
    fingerprint: digest(JSON.stringify({ pages, databases, files, snapshot: snapshot.digest })),
    snapshot,
    folders,
    pages,
    files,
    databases,
    report,
  };
  creationOrder(plan);
  return plan;
}
export function creationOrder(
  plan: Pick<ImportPlan, "pages" | "databases" | "folders">,
): Array<{ kind: "page" | "database"; id: Uuid }> {
  const created = new Set(plan.folders.map((folder) => folder.id));
  const pending = [
    ...plan.pages.map((page) => ({ kind: "page" as const, id: page.id, parentId: page.parentId })),
    ...plan.databases.map((db) => ({
      kind: "database" as const,
      id: db.id,
      parentId: db.parentId,
    })),
  ];
  const order: Array<{ kind: "page" | "database"; id: Uuid }> = [];
  while (pending.length) {
    const index = pending.findIndex((value) => created.has(value.parentId));
    if (index < 0) throw new NotionImportError("import.cyclic-dependencies");
    const value = pending.splice(index, 1)[0];
    if (!value) throw new NotionImportError("import.invalid-plan");
    order.push({ kind: value.kind, id: value.id });
    created.add(value.id);
  }
  return order;
}
