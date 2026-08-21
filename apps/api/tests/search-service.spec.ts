import type { SearchSourceRecord } from "@myownnotion/database";
import {
  asUuid,
  type DatabaseDefinition,
  type EntryValues,
  type SearchPathSegment,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  SearchService,
  type SearchServiceDeps,
  SearchUnavailableError,
} from "../src/search/search-service.ts";

const ids = {
  title: asUuid("018f0000-0000-7000-8000-000000000101"),
  body: asUuid("018f0000-0000-7000-8000-000000000102"),
  folder: asUuid("018f0000-0000-7000-8000-000000000103"),
  database: asUuid("018f0000-0000-7000-8000-000000000104"),
  entry: asUuid("018f0000-0000-7000-8000-000000000105"),
  titleProperty: asUuid("018f0000-0000-7000-8000-000000000106"),
  statusProperty: asUuid("018f0000-0000-7000-8000-000000000107"),
  todo: asUuid("018f0000-0000-7000-8000-000000000108"),
  done: asUuid("018f0000-0000-7000-8000-000000000109"),
  view: asUuid("018f0000-0000-7000-8000-000000000110"),
};

function source(
  itemId: Uuid,
  kind: SearchSourceRecord["kind"],
  storedName: string,
  body: Readonly<Record<string, unknown>> | null = null,
): SearchSourceRecord {
  return {
    itemId,
    revisionId: asUuid(`018f0000-0000-7000-8001-${itemId.slice(-12)}`),
    kind,
    storedName,
    pageDocument:
      kind === "page"
        ? { format: "myownnotion.document+json", formatVersion: 2, body: body ?? { blocks: [] } }
        : null,
  };
}

function dependencies(sources: readonly SearchSourceRecord[]): SearchServiceDeps {
  return {
    loadSources: async () => [...sources],
    loadSourcesByIds: async (itemIds) => sources.filter(({ itemId }) => itemIds.includes(itemId)),
    resolveSources: async (records) =>
      records.map((record) => ({
        ...record,
        title: record.storedName,
        body: record.pageDocument?.body ?? null,
      })),
    activeDescendantIds: async () => sources.map(({ itemId }) => itemId),
    hydratePaths: async (itemIds) =>
      new Map(
        itemIds.map((itemId) => {
          const record = sources.find((candidate) => candidate.itemId === itemId);
          const path: SearchPathSegment[] = [
            { itemId: ids.folder, title: "Racine" },
            { itemId, title: record?.storedName ?? "Inconnu" },
          ];
          return [itemId, path] as const;
        }),
      ),
  };
}

describe("SearchService", () => {
  it("builds atomically and returns ranked, hydrated, safe results", async () => {
    const sources = [
      source(ids.body, "page", "Notes", {
        blocks: [
          {
            type: "paragraph",
            id: "018f0000-0000-7000-8000-000000000111",
            content: [{ text: "Une reprise atomique protège les données" }],
          },
        ],
      }),
      source(ids.title, "page", "Reprise atomique"),
    ];
    const service = new SearchService(dependencies(sources));

    await service.rebuild();
    expect(service.status()).toMatchObject({ state: "ready", generation: 1, indexedCount: 2 });

    const page = await service.search({ query: "reprise atomique", limit: 20 });
    expect(page.generation).toBe(1);
    expect(page.results.map(({ itemId }) => itemId)).toEqual([ids.title, ids.body]);
    expect(page.results[0]).toMatchObject({ matchedField: "title", snippet: null });
    expect(page.results[1]).toMatchObject({ matchedField: "body" });
    expect(page.results[1]?.snippet).toContain("reprise atomique");
    expect(page.results[1]?.path.at(-1)?.itemId).toBe(ids.body);
  });

  it("indexes task properties once and refreshes entries when their role definition changes", async () => {
    const record = source(ids.entry, "page", "Release");
    let definition: DatabaseDefinition = {
      format: "myownnotion.database-definition+json",
      formatVersion: 1,
      databaseId: ids.database,
      properties: [
        {
          id: ids.titleProperty,
          name: "Title",
          type: "title",
          positionKey: "a",
          state: "active",
          config: {},
        },
        {
          id: ids.statusProperty,
          name: "Workflow",
          type: "status",
          positionKey: "b",
          state: "active",
          config: {
            options: [
              { id: ids.todo, label: "To do", positionKey: "a", tone: "gray", state: "active" },
              { id: ids.done, label: "Done", positionKey: "b", tone: "green", state: "active" },
            ],
          },
        },
      ],
      views: [
        {
          id: ids.view,
          name: "Table",
          type: "table",
          positionKey: "a",
          state: "active",
          properties: [],
          filter: { mode: "all", criteria: [] },
          sorts: [],
          group: null,
          options: { density: "comfortable", freezeTitle: true },
        },
      ],
      taskRoles: {
        statusPropertyId: ids.statusProperty,
        dueDatePropertyId: null,
        priorityPropertyId: null,
      },
    };
    const values: EntryValues = {
      format: "myownnotion.database-entry-values+json",
      formatVersion: 1,
      databaseId: ids.database,
      entryId: ids.entry,
      values: { [ids.statusProperty]: { kind: "status", optionId: ids.todo } },
      preserved: [],
    };
    const deps = dependencies([record]);
    const service = new SearchService({
      ...deps,
      loadSourcesByIds: async (itemIds) =>
        itemIds.includes(ids.entry) || itemIds.includes(ids.database) ? [record] : [],
      resolveSources: async (records) =>
        records.map((source) => ({
          ...source,
          title: source.storedName,
          body: source.pageDocument?.body ?? null,
          structuredValues: { definition, values },
        })),
    });

    await service.rebuild();
    await expect(service.search({ query: "to do" })).resolves.toMatchObject({
      results: [
        {
          itemId: ids.entry,
          matchedField: "property",
          propertyId: ids.statusProperty,
          propertyName: "Workflow",
          snippet: null,
        },
      ],
    });

    definition = {
      ...definition,
      properties: definition.properties.map((property) =>
        property.id === ids.statusProperty && property.type === "status"
          ? {
              ...property,
              name: "Progress",
              config: {
                options: property.config.options.map((option) =>
                  option.id === ids.todo ? { ...option, label: "Backlog" } : option,
                ),
              },
            }
          : property,
      ),
    };
    await service.applyCommittedChanges([ids.database], 1);
    await expect(service.search({ query: "backlog" })).resolves.toMatchObject({
      results: [{ itemId: ids.entry, propertyName: "Progress" }],
    });
    await expect(service.search({ query: "to do" })).resolves.toMatchObject({ results: [] });
    expect(service.status().indexedCount).toBe(1);
  });

  it("refuses complete search while the first generation is still cold", async () => {
    const service = new SearchService(dependencies([]));
    await expect(service.search({ query: "anything" })).rejects.toMatchObject({
      state: "building",
    });
  });

  it("keeps the previous generation invisible until a complete replacement is published", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let build = 0;
    const first = source(ids.title, "page", "Première génération");
    const second = source(ids.title, "page", "Deuxième génération");
    const deps = dependencies([first]);
    const service = new SearchService({
      ...deps,
      loadSources: async () => {
        build += 1;
        if (build === 2) {
          await gate;
          return [second];
        }
        return [first];
      },
    });
    await service.rebuild();

    const rebuilding = service.rebuild();
    expect((await service.search({ query: "première" })).results).toHaveLength(1);
    expect((await service.search({ query: "deuxième" })).results).toHaveLength(0);
    release?.();
    await rebuilding;
    expect((await service.search({ query: "deuxième" })).results).toHaveLength(1);
    expect(service.status().generation).toBe(2);
  });

  it("fails closed when a known document is malformed", async () => {
    const malformed = source(ids.body, "page", "Unreadable", {
      blocks: [{ type: "heading", id: ids.body, level: 9, content: [] }],
    });
    const service = new SearchService(dependencies([malformed]));

    await expect(service.rebuild()).rejects.toThrow(/document/i);
    expect(service.status()).toMatchObject({ state: "degraded", generation: null });
    await expect(service.search({ query: "unreadable" })).rejects.toBeInstanceOf(
      SearchUnavailableError,
    );
  });

  it("rebuilds a degraded index when a later canonical commit makes the source readable", async () => {
    let readable = false;
    const record = source(ids.title, "page", "Recovered source");
    const deps = dependencies([record]);
    const service = new SearchService({
      ...deps,
      resolveSources: async (records) => {
        if (!readable) {
          throw new Error("protected source unavailable");
        }
        return records.map((sourceRecord) => ({
          ...sourceRecord,
          title: sourceRecord.storedName,
          body: sourceRecord.pageDocument?.body ?? null,
        }));
      },
    });

    await expect(service.rebuild()).rejects.toThrow("protected source unavailable");
    expect(service.status().state).toBe("degraded");

    readable = true;
    await service.applyCommittedChanges([ids.title], 1);

    expect(service.status()).toMatchObject({ state: "ready", indexedCount: 1 });
    expect((await service.search({ query: "recovered" })).results).toHaveLength(1);
  });

  it("never includes a private query in validation or availability errors", async () => {
    const service = new SearchService(dependencies([]));
    const secret = "sentinel-private-query";

    await expect(service.search({ query: secret })).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining(secret),
    );
  });

  it("applies committed upserts and removals without rebuilding the full index", async () => {
    let sources = [source(ids.title, "page", "Ancien titre")];
    const deps = dependencies(sources);
    const service = new SearchService({
      ...deps,
      loadSources: async () => [...sources],
      loadSourcesByIds: async (itemIds) => sources.filter(({ itemId }) => itemIds.includes(itemId)),
      resolveSources: async (records) =>
        records.map((record) => ({
          ...record,
          title: record.storedName,
          body: record.pageDocument?.body ?? null,
        })),
    });
    await service.rebuild();

    sources = [source(ids.title, "page", "Nouveau titre")];
    await service.applyCommittedChanges([ids.title], 1);

    expect((await service.search({ query: "ancien" })).results).toHaveLength(0);
    expect((await service.search({ query: "nouveau" })).results).toHaveLength(1);
    expect(service.status()).toMatchObject({ state: "ready", generation: 2, indexedCount: 1 });

    sources = [];
    await service.applyCommittedChanges([ids.title], 2);

    expect((await service.search({ query: "nouveau" })).results).toHaveLength(0);
    expect(service.status()).toMatchObject({ state: "ready", generation: 3, indexedCount: 0 });
  });

  it("replays changes accepted during a rebuild into the generation being published", async () => {
    let releaseBuild: (() => void) | undefined;
    const buildGate = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    let sources = [source(ids.title, "page", "Première version")];
    let buildCount = 0;
    const deps = dependencies(sources);
    const service = new SearchService({
      ...deps,
      loadSources: async () => {
        buildCount += 1;
        if (buildCount === 2) {
          const snapshot = [...sources];
          await buildGate;
          return snapshot;
        }
        return [...sources];
      },
      loadSourcesByIds: async (itemIds) => sources.filter(({ itemId }) => itemIds.includes(itemId)),
      resolveSources: async (records) =>
        records.map((record) => ({
          ...record,
          title: record.storedName,
          body: record.pageDocument?.body ?? null,
        })),
    });
    await service.rebuild();

    const rebuilding = service.rebuild();
    sources = [source(ids.title, "page", "Version acceptée")];
    await service.applyCommittedChanges([ids.title], 4);
    expect((await service.search({ query: "acceptée" })).results).toHaveLength(1);

    releaseBuild?.();
    await rebuilding;
    expect((await service.search({ query: "acceptée" })).results).toHaveLength(1);
    expect((await service.search({ query: "première" })).results).toHaveLength(0);
  });

  it("filters by kind and current branch membership", async () => {
    const page = source(ids.title, "page", "Projet partagé");
    const folder = source(ids.folder, "folder", "Projet partagé");
    const outside = source(ids.body, "page", "Projet partagé");
    const base = dependencies([page, folder, outside]);
    const service = new SearchService({
      ...base,
      activeDescendantIds: async () => [ids.folder, ids.title],
    });
    await service.rebuild();

    const result = await service.search({
      query: "projet partagé",
      kinds: ["page"],
      branchRootItemId: ids.folder,
    });

    expect(result.results.map(({ itemId }) => itemId)).toEqual([ids.title]);
  });

  it("paginates with an opaque cursor bound to query, filters and generation", async () => {
    const records = [
      source(ids.title, "page", "Projet alpha"),
      source(ids.body, "page", "Projet beta"),
      source(ids.folder, "folder", "Projet gamma"),
    ];
    const service = new SearchService(dependencies(records));
    await service.rebuild();

    const first = await service.search({ query: "projet", kinds: ["page"], limit: 1 });
    expect(first.results).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    expect(first.nextCursor).not.toContain("projet");
    const cursor = first.nextCursor;
    if (cursor === null) {
      throw new Error("first search page did not provide a cursor");
    }

    const second = await service.search({
      query: "projet",
      kinds: ["page"],
      limit: 1,
      cursor,
    });
    expect(second.results).toHaveLength(1);
    expect(second.results[0]?.itemId).not.toBe(first.results[0]?.itemId);
    expect(second.nextCursor).toBeNull();

    await expect(
      service.search({
        query: "different",
        kinds: ["page"],
        cursor,
      }),
    ).rejects.toMatchObject({ code: "search.cursor-stale", status: 409 });

    await service.applyCommittedChanges([ids.title], 8);
    await expect(
      service.search({ query: "projet", kinds: ["page"], cursor }),
    ).rejects.toMatchObject({ code: "search.cursor-stale", status: 409 });
  });

  it("rejects malformed cursors without reflecting them", async () => {
    const service = new SearchService(dependencies([source(ids.title, "page", "Projet")]));
    await service.rebuild();
    const malformed = "sentinel-private-cursor";

    await expect(service.search({ query: "projet", cursor: malformed })).rejects.toMatchObject({
      code: "search.invalid-cursor",
      status: 400,
    });
    await expect(service.search({ query: "projet", cursor: malformed })).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining(malformed),
    );
  });
});
