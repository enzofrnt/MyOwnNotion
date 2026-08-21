import {
  asUuid,
  type DatabaseDefinition,
  type DatabaseProperty,
  type DatabaseView,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DatabaseQueryService,
  type StructuredProjectionSource,
} from "../../apps/api/src/databases/database-query-service.ts";
import {
  applyLocalMutation,
  LocalCipher,
  LocalKeyManager,
  LocalRecordCodec,
  MemorySecureStorage,
  openLocalDatabase,
} from "../../packages/client-core/src/index.ts";

const ENTRY_COUNT = 100_000;
const PAGE_SIZE = 100;
const VIEW_P95_TARGET_MS = 1_000;
const LOCAL_COMMIT_P95_TARGET_MS = 300;
const PROPAGATION_P95_TARGET_MS = 2_000;
const STRESS_ENTRY_COUNT = 100;
const STRESS_CYCLES = 25;

function percentile(samples: readonly number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] as number;
}

function fixtureId(index: number, variant = "9000"): Uuid {
  return asUuid(`018f9000-0000-7000-${variant}-${index.toString().padStart(12, "0")}`);
}

const ids = {
  database: fixtureId(1, "9100"),
  definitionRevision: fixtureId(2, "9100"),
  title: fixtureId(3, "9100"),
  text: fixtureId(4, "9100"),
  status: fixtureId(5, "9100"),
  due: fixtureId(6, "9100"),
  todo: fixtureId(7, "9100"),
  done: fixtureId(8, "9100"),
  table: fixtureId(9, "9100"),
  list: fixtureId(10, "9100"),
  board: fixtureId(11, "9100"),
  gallery: fixtureId(12, "9100"),
  calendar: fixtureId(13, "9100"),
  relation: fixtureId(14, "9100"),
};

const extraProperties: readonly DatabaseProperty[] = Array.from({ length: 35 }, (_, index) => {
  const common = {
    id: fixtureId(index + 100, "9100"),
    name: `Reference property ${index + 1}`,
    positionKey: String(index + 5).padStart(2, "0"),
    state: "active" as const,
  };
  switch (index % 5) {
    case 0:
      return { ...common, type: "text" as const, config: {} };
    case 1:
      return { ...common, type: "number" as const, config: {} };
    case 2:
      return { ...common, type: "checkbox" as const, config: {} };
    case 3:
      return { ...common, type: "date" as const, config: { mode: "date" as const } };
    default:
      return { ...common, type: "date" as const, config: { mode: "instant" as const } };
  }
});

const presentations = [ids.title, ids.text, ids.status, ids.due].map((propertyId, index) => ({
  propertyId,
  visible: true,
  positionKey: String(index).padStart(2, "0"),
}));
const viewBase = {
  state: "active" as const,
  properties: presentations,
  filter: { mode: "all" as const, criteria: [] },
  sorts: [{ propertyId: ids.title, direction: "ascending" as const, missing: "last" as const }],
  group: null,
};
const views: readonly DatabaseView[] = [
  {
    ...viewBase,
    id: ids.table,
    name: "Table",
    type: "table",
    positionKey: "01",
    options: { density: "comfortable", freezeTitle: true },
  },
  {
    ...viewBase,
    id: ids.list,
    name: "List",
    type: "list",
    positionKey: "02",
    options: { density: "comfortable", secondaryPropertyIds: [ids.text, ids.status] },
  },
  {
    ...viewBase,
    id: ids.board,
    name: "Board",
    type: "board",
    positionKey: "03",
    options: {
      axisPropertyId: ids.status,
      columnOrder: [ids.todo, ids.done],
      collapsedColumnIds: [],
    },
  },
  {
    ...viewBase,
    id: ids.gallery,
    name: "Gallery",
    type: "gallery",
    positionKey: "04",
    options: { cardPropertyIds: [ids.text, ids.status], preview: "page" },
  },
  {
    ...viewBase,
    id: ids.calendar,
    name: "Calendar",
    type: "calendar",
    positionKey: "05",
    options: { datePropertyId: ids.due, initialMode: "month" },
  },
];
const extraViews: readonly DatabaseView[] = Array.from({ length: 15 }, (_, index) => ({
  ...viewBase,
  id: fixtureId(index + 200, "9100"),
  name: `Reference table ${index + 6}`,
  type: "table" as const,
  positionKey: String(index + 6).padStart(2, "0"),
  options: {
    density: index % 2 === 0 ? ("comfortable" as const) : ("compact" as const),
    freezeTitle: index % 3 === 0,
  },
}));
const definition: DatabaseDefinition = {
  format: "myownnotion.database-definition+json",
  formatVersion: 1,
  databaseId: ids.database,
  properties: [
    { id: ids.title, name: "Title", type: "title", positionKey: "01", state: "active", config: {} },
    { id: ids.text, name: "Summary", type: "text", positionKey: "02", state: "active", config: {} },
    {
      id: ids.status,
      name: "Status",
      type: "status",
      positionKey: "03",
      state: "active",
      config: {
        options: [
          { id: ids.todo, label: "To do", positionKey: "01", tone: "gray", state: "active" },
          { id: ids.done, label: "Done", positionKey: "02", tone: "green", state: "active" },
        ],
      },
    },
    {
      id: ids.due,
      name: "Due",
      type: "date",
      positionKey: "04",
      state: "active",
      config: { mode: "date" },
    },
    {
      id: ids.relation,
      name: "Related entry",
      type: "relation",
      positionKey: "05",
      state: "active",
      config: { cardinality: "many" },
    },
    ...extraProperties,
  ],
  views: [...views, ...extraViews],
  taskRoles: null,
};

let canonical: StructuredProjectionSource;
let firstDevice: DatabaseQueryService;
let secondDevice: DatabaseQueryService;
let rebuildDurationMs = 0;
let rebuildPeakHeapUsedBytes = 0;

beforeAll(async () => {
  const entryIds = Array.from({ length: ENTRY_COUNT }, (_, index) => fixtureId(index, "9200"));
  canonical = {
    databaseId: ids.database,
    definitionRevisionId: ids.definitionRevision,
    definition,
    entries: entryIds.map((entryId, index) => ({
      entryId,
      revisionId: fixtureId(index, "9201"),
      title: `Entry ${String(index % 1_000).padStart(4, "0")}`,
      values: {
        [ids.text]: { kind: "text", value: `Summary ${index % 100}` },
        [ids.status]: { kind: "status", optionId: index % 2 === 0 ? ids.todo : ids.done },
        [ids.due]: {
          kind: "date",
          date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
        },
      },
      relationTargets: {
        [ids.relation]: [entryIds[(index + 1) % ENTRY_COUNT] as Uuid],
      },
    })),
  };
  const dependencies = {
    loadAll: async () => [canonical],
    loadAffected: async () => ({ sources: [canonical], removedDatabaseIds: [] }),
  };
  firstDevice = new DatabaseQueryService(dependencies, new Uint8Array(32).fill(1));
  secondDevice = new DatabaseQueryService(dependencies, new Uint8Array(32).fill(2));
  const rebuildStarted = performance.now();
  rebuildPeakHeapUsedBytes = process.memoryUsage().heapUsed;
  const memorySampler = setInterval(() => {
    rebuildPeakHeapUsedBytes = Math.max(rebuildPeakHeapUsedBytes, process.memoryUsage().heapUsed);
  }, 10);
  try {
    await Promise.all([firstDevice.rebuild(), secondDevice.rebuild()]);
  } finally {
    clearInterval(memorySampler);
    rebuildPeakHeapUsedBytes = Math.max(rebuildPeakHeapUsedBytes, process.memoryUsage().heapUsed);
  }
  rebuildDurationMs = performance.now() - rebuildStarted;
}, 600_000);

describe("structured database reference performance (T093)", () => {
  it("rebuilds the 40-property, 20-view, 100,000-relation reference fixture", () => {
    expect(definition.properties).toHaveLength(40);
    expect(definition.views).toHaveLength(20);
    expect(
      canonical.entries.reduce(
        (count, entry) => count + Object.values(entry.relationTargets).flat().length,
        0,
      ),
    ).toBe(100_000);
    expect(secondDevice.query(ids.database, { viewId: ids.table, limit: 1 }).rows).toHaveLength(1);
    console.info(
      `[perf] database reference rebuild 40 properties/20 views/100k relations: ${rebuildDurationMs.toFixed(1)}ms peakHeapUsed=${(rebuildPeakHeapUsedBytes / 1024 / 1024).toFixed(1)}MiB`,
    );
  });

  it("returns the first 100 rows of all five views below one second p95", () => {
    const samples = new Map<DatabaseView["type"], number[]>();
    for (let round = 0; round < 5; round += 1) {
      for (const view of views) {
        const started = performance.now();
        const page = secondDevice.query(ids.database, { viewId: view.id, limit: PAGE_SIZE });
        const elapsed = performance.now() - started;
        samples.set(view.type, [...(samples.get(view.type) ?? []), elapsed]);
        expect(page.rows).toHaveLength(PAGE_SIZE);
        expect(new Set(page.rows.map(({ entryId }) => entryId)).size).toBe(PAGE_SIZE);
      }
    }
    for (const [type, timings] of samples) {
      const p95 = percentile(timings, 0.95);
      console.info(`[perf] database ${type} 100/100k p95=${p95.toFixed(1)}ms`);
      expect(p95).toBeLessThan(VIEW_P95_TARGET_MS);
    }
  });

  it("propagates a committed value to a second device below two seconds p95", async () => {
    const samples: number[] = [];
    for (let run = 0; run < 10; run += 1) {
      const entries = [...canonical.entries];
      const current = entries[0];
      if (current === undefined) throw new Error("performance source is empty");
      entries[0] = {
        ...current,
        revisionId: fixtureId(run + 1, "9300"),
        title: `000 propagated ${run}`,
      };
      canonical = { ...canonical, entries };
      const started = performance.now();
      await Promise.all([
        firstDevice.applyCommittedChanges([current.entryId], run + 1),
        secondDevice.applyCommittedChanges([current.entryId], run + 1),
      ]);
      const page = secondDevice.query(ids.database, { viewId: ids.table, limit: 1 });
      samples.push(performance.now() - started);
      expect(page.rows[0]?.title).toBe(`000 propagated ${run}`);
    }
    const p95 = percentile(samples, 0.95);
    console.info(`[perf] database second-device propagation p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(PROPAGATION_P95_TARGET_MS);
  });

  it("commits locally below 300ms p95 through 10,000 mixed operations without loss", async () => {
    const db = openLocalDatabase(`databases-performance-${generateUuidV7()}`);
    const keys = new LocalKeyManager(new MemorySecureStorage());
    await keys.establish();
    const codec = new LocalRecordCodec(new LocalCipher(keys), {
      installationId: fixtureId(1, "9400"),
      workspaceId: fixtureId(2, "9400"),
    });
    let clock = Date.parse("2026-08-20T10:00:00.000Z");
    const apply = async (
      commandType: string,
      payload: Record<string, unknown>,
      mutationId = generateUuidV7(),
    ) => {
      const timestamp = new Date(clock++);
      const result = await applyLocalMutation(
        db,
        {
          mutationId,
          commandType,
          payload,
          baseRevisionIds:
            typeof payload["baseRevisionId"] === "string"
              ? [payload["baseRevisionId"] as Uuid]
              : [],
        },
        () => timestamp,
        codec,
      );
      if (!result.ok) throw new Error(`local ${commandType} failed: ${result.error.code}`);
      return result.value;
    };

    try {
      const databaseId = generateUuidV7();
      await apply("database.create", {
        id: databaseId,
        name: "Performance database",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "Table",
      });
      const entryIds = Array.from({ length: STRESS_ENTRY_COUNT }, () => generateUuidV7());
      for (const [index, entryId] of entryIds.entries()) {
        await apply("database.entry.create", {
          databaseId,
          id: entryId,
          title: `Stress entry ${index}`,
          placement: {
            id: generateUuidV7(),
            parentItemId: databaseId,
            positionKey: String(index).padStart(4, "0"),
          },
          values: {},
          relationTargets: {},
        });
      }

      const commitSamples: number[] = [];
      for (let cycle = 0; cycle < STRESS_CYCLES; cycle += 1) {
        for (const entryId of entryIds) {
          const item = await db.items.get(entryId);
          if (item === undefined) throw new Error("stress entry disappeared");
          const mutationId = generateUuidV7();
          const payload = {
            databaseId,
            entryId,
            baseRevisionId: item.currentRevisionId,
            values: {},
            relationTargets: {},
          };
          const started = performance.now();
          const first = await apply("database.entry.values.replace", payload, mutationId);
          commitSamples.push(performance.now() - started);
          const replay = await apply("database.entry.values.replace", payload, mutationId);
          expect(replay.localRevisionIds).toEqual(first.localRevisionIds);
          await apply("item.trash", { itemId: entryId });
          await apply("item.restore", { itemId: entryId });
        }
      }

      const operationCount = STRESS_ENTRY_COUNT + STRESS_ENTRY_COUNT * STRESS_CYCLES * 4;
      expect(operationCount).toBeGreaterThanOrEqual(10_000);
      expect(await db.databaseEntries.count()).toBe(STRESS_ENTRY_COUNT);
      expect(await db.items.count()).toBe(STRESS_ENTRY_COUNT + 1);
      expect((await db.items.toArray()).every(({ lifecycle }) => lifecycle === "active")).toBe(
        true,
      );
      expect(
        new Set((await db.databaseEntries.toArray()).map(({ entryItemId }) => entryItemId)).size,
      ).toBe(STRESS_ENTRY_COUNT);
      const p95 = percentile(commitSamples, 0.95);
      console.info(
        `[perf] database local commits p95=${p95.toFixed(1)}ms operations=${operationCount}`,
      );
      expect(p95).toBeLessThan(LOCAL_COMMIT_P95_TARGET_MS);
    } finally {
      await db.delete();
    }
  }, 600_000);
});

afterAll(() => {
  canonical = { ...canonical, entries: [] };
});
