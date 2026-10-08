import type { LocalDatabaseRow } from "@myownnotion/client-core";
import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import type { ContentApi } from "../src/services/content-api.ts";
import { DatabaseViewService, mergeDatabaseViewRows } from "../src/services/databases.ts";
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
    queryDatabase: vi.fn<ContentApi["queryDatabase"]>().mockResolvedValue({
      ok: false,
      offline: true,
      problem: { type: "about:blank", status: 503, code: "network.offline", title: "Offline" },
    }),
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
    local,
    update: () => update?.(),
  };
}

describe("saved database cursor pagination", () => {
  it("renders a complete first page while the server is unavailable without requesting it", async () => {
    const context = fixture();
    context.api.queryDatabase.mockImplementation(() => new Promise(() => {}));
    try {
      const result = await context.service.query(context.id, {
        viewId: context.viewId,
        limit: 20,
      });
      expect(result.ok && result.value).toMatchObject({
        source: "local",
        coverage: "complete",
        staleCursorRecovered: false,
      });
      expect(result.ok && result.value.rows).toHaveLength(20);
      expect(context.api.queryDatabase).not.toHaveBeenCalled();
    } finally {
      context.service.dispose();
    }
  });

  it("keeps pending and conflict states on complete local and empty sources", async () => {
    const context = fixture();
    const pending = context.entries[0];
    const conflicting = context.entries[1];
    if (pending === undefined || conflicting === undefined) throw new Error("Missing entries");
    vi.spyOn(context.local.outbox, "all").mockResolvedValue([
      { payload: { entryId: pending.id } },
    ] as Awaited<ReturnType<LocalContentService["outbox"]["all"]>>);
    vi.spyOn(context.local.outbox, "activeConflicts").mockResolvedValue([
      { payload: { entryId: conflicting.id } },
    ] as Awaited<ReturnType<LocalContentService["outbox"]["activeConflicts"]>>);
    try {
      const result = await context.service.query(context.id, { viewId: context.viewId });
      expect(result.ok && result.value.rows.slice(0, 2).map((row) => row.syncState)).toEqual([
        "pending",
        "conflict",
      ]);
      context.entries.splice(0);
      context.update();
      const empty = await context.service.query(context.id, { viewId: context.viewId });
      expect(empty.ok && empty.value).toMatchObject({
        rows: [],
        source: "local",
        coverage: "complete",
      });
      expect(context.api.queryDatabase).not.toHaveBeenCalled();
    } finally {
      context.service.dispose();
    }
  });

  it("still requests partial coverage and server cursors and preserves the remote page", async () => {
    const context = fixture(true);
    const serverPage = {
      databaseId: context.id,
      viewId: context.viewId,
      rows: [],
      groups: [],
      nextCursor: "server.next",
      coverage: "partial" as const,
      availableCount: 0,
      expectedCount: 2000,
      definitionRevisionId: generateUuidV7(),
      generation: 14,
    };
    context.api.queryDatabase.mockResolvedValue({ ok: true, value: serverPage });
    try {
      const request = { viewId: context.viewId, limit: 100, cursor: "server.current" };
      const result = await context.service.query(context.id, request);
      expect(context.api.queryDatabase).toHaveBeenCalledWith(context.id, request);
      expect(result.ok && result.value).toMatchObject({ ...serverPage, source: "merged" });
      await context.service.query(context.id, { viewId: context.viewId });
      expect(context.api.queryDatabase).toHaveBeenCalledTimes(2);
    } finally {
      context.service.dispose();
    }
  });

  it("does not skip a server cursor on complete coverage or hide a view absent locally", async () => {
    const context = fixture();
    const remoteViewId = generateUuidV7();
    const serverPage = {
      databaseId: context.id,
      viewId: remoteViewId,
      rows: [],
      groups: [],
      nextCursor: null,
      coverage: "complete" as const,
      availableCount: 0,
      expectedCount: 0,
      definitionRevisionId: generateUuidV7(),
      generation: 2,
    };
    context.api.queryDatabase.mockResolvedValue({ ok: true, value: serverPage });
    try {
      const cursorRequest = { viewId: context.viewId, cursor: "server.current" };
      await context.service.query(context.id, cursorRequest);
      expect(context.api.queryDatabase).toHaveBeenCalledWith(context.id, cursorRequest);
      const remote = await context.service.query(context.id, { viewId: remoteViewId });
      expect(remote.ok && remote.value).toMatchObject({ ...serverPage, source: "server" });
    } finally {
      context.service.dispose();
    }
  });
  it("overlays optimistic rows only when the server selected the same page", () => {
    const first = generateUuidV7();
    const second = generateUuidV7();
    const pendingOutsidePage = generateUuidV7();
    const serverRows = [
      {
        entryId: first,
        revisionId: generateUuidV7(),
        title: "Remote first",
        values: {},
        relationTargets: {},
        groupId: null,
      },
      {
        entryId: second,
        revisionId: generateUuidV7(),
        title: "Remote second",
        values: {},
        relationTargets: {},
        groupId: null,
      },
    ];
    const localRows = [
      { ...serverRows[0], title: "Optimistic first" },
      {
        ...serverRows[1],
        title: "Optimistic second",
      },
      {
        ...serverRows[0],
        entryId: pendingOutsidePage,
        title: "Optimistic outside page",
      },
    ];

    const merged = mergeDatabaseViewRows(
      serverRows,
      localRows,
      new Map([
        [first, "pending"],
        [second, "conflict"],
        [pendingOutsidePage, "pending"],
      ]),
    );

    expect(merged.map((row) => row.entryId)).toEqual([first, second]);
    expect(merged.map((row) => row.title)).toEqual(["Optimistic first", "Optimistic second"]);
    expect(merged.map((row) => row.syncState)).toEqual(["pending", "conflict"]);
  });

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
      expect(context.api.queryDatabase).not.toHaveBeenCalled();
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
