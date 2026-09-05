import type { LocalDatabaseRow } from "@myownnotion/client-core";
import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { DatabaseViewService } from "../src/services/databases.ts";
import type { LocalContentService } from "../src/services/local-content.ts";

function fixture(partial = false, filtered = false) {
  const id = generateUuidV7();
  const title = generateUuidV7();
  const viewId = generateUuidV7();
  const revisionId = generateUuidV7();
  const definition: DatabaseDefinition = {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: id,
    name: "Source",
    properties: [
      { id: title, name: "Title", type: "title", positionKey: "a", state: "active", config: {} },
    ],
    views: [
      {
        id: viewId,
        name: "Title order",
        type: "table",
        positionKey: "a",
        state: "active",
        properties: [{ propertyId: title, positionKey: "a", visible: true }],
        filter: {
          mode: "all",
          criteria: filtered
            ? [
                {
                  id: generateUuidV7(),
                  propertyId: title,
                  operator: "contains",
                  operand: { kind: "text", value: "1001" },
                },
              ]
            : [],
        },
        sorts: [],
        group: null,
        options: { density: "comfortable", freezeTitle: true },
      },
    ],
    taskRoles: null,
  };
  const entries = Array.from({ length: 1002 }, (_, index) => ({
    id: generateUuidV7(),
    name: `Entry ${String(index).padStart(4, "0")}`,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
  }));
  const items = new Map(entries.map((entry) => [entry.id, entry]));
  const source: LocalDatabaseRow = {
    itemId: id,
    definitionVersion: 1,
    definitionRevisionId: revisionId,
    definition,
  };
  const api = {
    queryDatabase: vi
      .fn()
      .mockResolvedValue({ ok: false, problem: { code: "network.offline", title: "Offline" } }),
  };
  let update: (() => void) | undefined;
  const local = {
    api,
    outbox: { all: async () => [], activeConflicts: async () => [] },
    subscribeProjection: (listener: () => void) => {
      update = listener;
      return () => {};
    },
    getDatabase: async () => source,
    getItem: async (itemId: Uuid) => {
      if (itemId === id) throw new Error("Purged journal anchor presentation is unavailable");
      return items.get(itemId) ?? null;
    },
    listDatabaseEntries: async () =>
      entries.map((entry, index) => ({
        entryItemId: entry.id,
        availability: partial && index === entries.length - 1 ? "offloaded" : "present",
        values: { values: {} },
      })),
    getDatabaseEntryRelations: async () => new Map(),
    getItems: async (ids: Uuid[]) => ids.flatMap((id) => items.get(id) ?? []),
  } as unknown as LocalContentService;
  return {
    service: new DatabaseViewService(local),
    api,
    id,
    viewId,
    entries,
    update: () => update?.(),
  };
}

describe("saved database cursor pagination", () => {
  it("filters the entire source before the first canonical page is selected", async () => {
    const context = fixture(false, true);
    try {
      const result = await context.service.query(context.id, {
        viewId: context.viewId,
        limit: 100,
      });
      expect(result.ok && result.value.rows.map((row) => row.title)).toEqual(["Entry 1001"]);
      expect(result.ok && result.value.nextCursor).toBeNull();
      expect(result.ok && result.value.coverage).toBe("complete");
    } finally {
      context.service.dispose();
    }
  });
  it("continues the canonical local order beyond 1000 without treating a local cursor as a server cursor", async () => {
    const context = fixture();
    try {
      const first = await context.service.query(context.id, {
        viewId: context.viewId,
        limit: 1000,
      });
      if (!first.ok || first.value.nextCursor === null) throw new Error("Missing first cursor");
      expect(first.value.rows).toHaveLength(1000);
      const next = await context.service.query(context.id, {
        viewId: context.viewId,
        limit: 1000,
        cursor: first.value.nextCursor,
      });
      if (!next.ok) throw new Error("Missing next page");
      expect(next.value.rows.map((row) => row.title)).toEqual(["Entry 1000", "Entry 1001"]);
      expect(next.value.nextCursor).toBeNull();
      expect(next.value.staleCursorRecovered).toBe(false);
      expect(context.api.queryDatabase).toHaveBeenCalledTimes(1);
      context.update();
      const unchanged = await context.service.query(context.id, {
        viewId: context.viewId,
        limit: 1000,
        cursor: first.value.nextCursor,
      });
      expect(unchanged.ok && unchanged.value.staleCursorRecovered).toBe(false);
      const changed = context.entries.at(-1);
      if (changed === undefined) throw new Error("Missing entry");
      changed.name = "Entry 1001 revised";
      context.update();
      const stale = await context.service.query(context.id, {
        viewId: context.viewId,
        limit: 1000,
        cursor: first.value.nextCursor,
      });
      expect(stale.ok && stale.value.staleCursorRecovered).toBe(true);
      expect(stale.ok && stale.value.rows[0]?.title).toBe("Entry 0000");
    } finally {
      context.service.dispose();
    }
  });
  it("keeps partial offline coverage explicit on the final available page", async () => {
    const context = fixture(true);
    try {
      const first = await context.service.query(context.id, {
        viewId: context.viewId,
        limit: 1000,
      });
      if (!first.ok || first.value.nextCursor === null) throw new Error("Missing partial cursor");
      const next = await context.service.query(context.id, {
        viewId: context.viewId,
        limit: 1000,
        cursor: first.value.nextCursor,
      });
      expect(next.ok && next.value).toMatchObject({
        coverage: "partial",
        availableCount: 1001,
        expectedCount: 1002,
        nextCursor: null,
      });
    } finally {
      context.service.dispose();
    }
  });
});
