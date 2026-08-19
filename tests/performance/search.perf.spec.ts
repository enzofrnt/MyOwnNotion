import type { SearchSourceRecord } from "@myownnotion/database";
import {
  asUuid,
  prepareSearchQuery,
  type SearchDocument,
  type SearchPathSegment,
  type Uuid,
  WorkspaceSearchIndex,
} from "@myownnotion/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { SearchService } from "../../apps/api/src/search/search-service.ts";
import { createSearchWorkerRuntime } from "../../apps/web/src/features/search/search.worker.ts";

const SERVER_PAGE_COUNT = 100_000;
const SERVER_FILE_COUNT = 50_000;
const BLOCKS_PER_PAGE = 10;
const LOCAL_ITEM_COUNT = 10_000;
const SERVER_P95_TARGET_MS = 1_000;
const LOCAL_P95_TARGET_MS = 300;
const PROPAGATION_P95_TARGET_MS = 2_000;

function percentile(samples: readonly number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] as number;
}

function itemId(index: number, variant = "8000"): Uuid {
  return asUuid(`018f0000-0000-7000-${variant}-${index.toString().padStart(12, "0")}`);
}

function prepared(raw: string) {
  const result = prepareSearchQuery(raw);
  if (!result.ok) {
    throw new Error("performance fixture query is invalid");
  }
  return result.value;
}

function document(index: number): SearchDocument {
  const target = index % 1_000 === 0 ? " target phrase" : "";
  // Ten block-sized segments per page: 100,000 pages therefore model exactly
  // one million visible blocks after the canonical extractor has flattened
  // them for the transient index.
  const bodyText = Array.from(
    { length: BLOCKS_PER_PAGE },
    (_, block) => `block${block} common searchable text${target}`,
  ).join(" ");
  return {
    itemId: itemId(index),
    revisionId: itemId(index, "8001"),
    sourceVersion: 1,
    kind: "page",
    title: `Reference page ${index % 100}`,
    bodyText,
    conflict: false,
  };
}

function fileDocument(index: number): SearchDocument {
  return {
    itemId: itemId(index, "8003"),
    revisionId: itemId(index, "8004"),
    sourceVersion: 1,
    kind: "file",
    title: `Reference attachment ${index}`,
    bodyText: "",
    conflict: false,
  };
}

let serverDocuments: SearchDocument[];
let serverIndex: WorkspaceSearchIndex;
let serverBuildMs = 0;
let serverHeapBytes = 0;

beforeAll(() => {
  const heapBefore = process.memoryUsage().heapUsed;
  serverDocuments = [
    ...Array.from({ length: SERVER_PAGE_COUNT }, (_, index) => document(index)),
    ...Array.from({ length: SERVER_FILE_COUNT }, (_, index) => fileDocument(index)),
  ];
  const started = performance.now();
  serverIndex = new WorkspaceSearchIndex(serverDocuments);
  serverBuildMs = performance.now() - started;
  serverHeapBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
}, 600_000);

describe("search reference performance", () => {
  it("returns the first 20 complete results below the one-second p95 target", () => {
    const query = prepared("target phrase");
    serverIndex.search(query, { limit: 20 });
    expect(
      serverIndex.search(prepared("reference attachment 12345"), { limit: 20 })[0],
    ).toMatchObject({ kind: "file", title: "Reference attachment 12345" });
    const samples = Array.from({ length: 30 }, () => {
      const started = performance.now();
      const results = serverIndex.search(query, { limit: 20 });
      expect(results).toHaveLength(20);
      return performance.now() - started;
    });
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    console.info(
      `[perf] search server 100k pages/1m blocks/50k files: build=${serverBuildMs.toFixed(1)}ms heap=${(serverHeapBytes / 1024 / 1024).toFixed(1)}MiB p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );
    expect(p95).toBeLessThan(SERVER_P95_TARGET_MS);
  });

  it("returns local results and applies local upserts below the device targets", () => {
    const runtime = createSearchWorkerRuntime();
    expect(
      runtime.handle({ type: "build", documents: serverDocuments.slice(0, LOCAL_ITEM_COUNT) }),
    ).toMatchObject({ ok: true, size: LOCAL_ITEM_COUNT });
    const querySamples: number[] = [];
    const upsertSamples: number[] = [];
    for (let run = 0; run < 40; run += 1) {
      const startedQuery = performance.now();
      const result = runtime.handle({ type: "query", query: "target phrase", limit: 20 });
      querySamples.push(performance.now() - startedQuery);
      expect(result).toMatchObject({ ok: true });

      const changed = {
        ...document(run),
        revisionId: itemId(run + 200_000, "8002"),
        sourceVersion: run + 2,
        title: `Local upsert target ${run}`,
      };
      const startedUpsert = performance.now();
      expect(runtime.handle({ type: "upsert", document: changed })).toMatchObject({ ok: true });
      upsertSamples.push(performance.now() - startedUpsert);
    }
    const queryP95 = percentile(querySamples, 0.95);
    const upsertP95 = percentile(upsertSamples, 0.95);
    console.info(
      `[perf] search local 10k: query p50=${percentile(querySamples, 0.5).toFixed(1)}ms p95=${queryP95.toFixed(1)}ms upsert p50=${percentile(upsertSamples, 0.5).toFixed(1)}ms p95=${upsertP95.toFixed(1)}ms`,
    );
    expect(queryP95).toBeLessThan(LOCAL_P95_TARGET_MS);
    expect(upsertP95).toBeLessThan(1_000);
  });

  it("makes a committed server change searchable on a second index below two seconds", async () => {
    const id = itemId(300_000);
    let canonical: SearchSourceRecord[] = [
      {
        itemId: id,
        revisionId: itemId(300_000, "8001"),
        kind: "page",
        storedName: "Before propagation",
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: { blocks: [] },
        },
      },
    ];
    const deps = {
      loadSources: async () => [...canonical],
      loadSourcesByIds: async (ids: readonly Uuid[]) =>
        canonical.filter(({ itemId: sourceId }) => ids.includes(sourceId)),
      resolveSources: async (records: readonly SearchSourceRecord[]) =>
        records.map((record) => ({ ...record, title: record.storedName, body: {} })),
      activeDescendantIds: async () => [id],
      hydratePaths: async (ids: readonly Uuid[]) =>
        new Map<Uuid, readonly SearchPathSegment[]>(
          ids.map((item) => [item, [{ itemId: item, title: canonical[0]?.storedName ?? "" }]]),
        ),
    };
    const secondDevice = new SearchService(deps);
    await secondDevice.rebuild();
    const samples: number[] = [];
    for (let run = 0; run < 30; run += 1) {
      canonical = [
        {
          ...(canonical[0] as SearchSourceRecord),
          revisionId: itemId(300_001 + run, "8001"),
          storedName: `Propagated value ${run}`,
        },
      ];
      const started = performance.now();
      await secondDevice.applyCommittedChanges([id], run + 1);
      const result = await secondDevice.search({ query: `propagated value ${run}` });
      samples.push(performance.now() - started);
      expect(result.results).toHaveLength(1);
    }
    const p95 = percentile(samples, 0.95);
    console.info(
      `[perf] search second-device propagation: p50=${percentile(samples, 0.5).toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );
    expect(p95).toBeLessThan(PROPAGATION_P95_TARGET_MS);
  });

  it("replays 10,000 updates without duplicates or identity replacement", () => {
    const documents = Array.from({ length: 1_000 }, (_, index) => document(index));
    const index = new WorkspaceSearchIndex(documents);
    const started = performance.now();
    for (let replay = 0; replay < 10_000; replay += 1) {
      expect(index.upsert(documents[replay % documents.length] as SearchDocument)).toBe("ignored");
    }
    const elapsed = performance.now() - started;
    const results = index.search(prepared("common searchable"), { limit: 50 });
    console.info(`[perf] search 10k idempotent replays: total=${elapsed.toFixed(1)}ms`);
    expect(index.size).toBe(documents.length);
    expect(new Set(results.map(({ itemId: id }) => id)).size).toBe(results.length);
  });
});
