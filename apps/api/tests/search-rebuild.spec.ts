import type { SearchSourceRecord } from "@myownnotion/database";
import { asUuid, type SearchPathSegment, type Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import {
  SearchService,
  type SearchServiceDeps,
  SearchUnavailableError,
} from "../src/search/search-service.ts";

const itemId = asUuid("018f0000-0000-7000-8000-000000000701");

function source(title: string, id: Uuid = itemId): SearchSourceRecord {
  return {
    itemId: id,
    revisionId: asUuid("018f0000-0000-7000-8000-000000000702"),
    kind: "page",
    storedName: title,
    pageDocument: {
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: { blocks: [] },
    },
  };
}

function dependencies(read: () => readonly SearchSourceRecord[]): SearchServiceDeps {
  return {
    loadSources: async () => [...read()],
    loadSourcesByIds: async (itemIds) => read().filter((record) => itemIds.includes(record.itemId)),
    resolveSources: async (records) =>
      records.map((record) => ({ ...record, title: record.storedName, body: {} })),
    activeDescendantIds: async () => [itemId],
    hydratePaths: async (itemIds) =>
      new Map<Uuid, readonly SearchPathSegment[]>(
        itemIds.map((id) => [id, [{ itemId: id, title: "Current" }]]),
      ),
  };
}

describe("SearchService rebuild recovery", () => {
  it("yields to unrelated requests while indexing a large canonical source set", async () => {
    const corpus = Array.from({ length: 1_000 }, (_, index) =>
      source(
        `Page ${index}`,
        asUuid(`018f0000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`),
      ),
    );
    const service = new SearchService(dependencies(() => corpus));
    const stateSeenByUnrelatedCallback = new Promise<string>((resolve) => {
      setImmediate(() => resolve(service.status().state));
    });

    const rebuild = service.rebuild();

    await expect(stateSeenByUnrelatedCallback).resolves.toBe("building");
    await rebuild;
    expect(service.status()).toMatchObject({ state: "ready", indexedCount: corpus.length });
  });

  it("never publishes an interrupted replacement and restarts cleanly", async () => {
    let current = [source("Stable generation")];
    let interrupt = false;
    const deps = dependencies(() => current);
    const service = new SearchService({
      ...deps,
      loadSources: async () => {
        if (interrupt) {
          throw new Error("simulated interruption");
        }
        return [...current];
      },
    });
    await service.rebuild();

    current = [source("Replacement generation")];
    interrupt = true;
    await expect(service.rebuild()).rejects.toThrow("simulated interruption");
    expect(service.status()).toMatchObject({
      state: "degraded",
      generation: 1,
      failureCode: "search.rebuild-failed",
    });
    await expect(service.search({ query: "stable" })).rejects.toBeInstanceOf(
      SearchUnavailableError,
    );

    interrupt = false;
    await service.rebuild();
    expect(service.status()).toMatchObject({ state: "ready", generation: 2 });
    await expect(service.search({ query: "replacement" })).resolves.toMatchObject({
      results: [{ itemId, title: "Replacement generation" }],
    });
    await expect(service.search({ query: "stable" })).resolves.toMatchObject({ results: [] });
  });

  it("invalidates a failed incremental update and rebuilds from canonical state", async () => {
    let current = [source("Before")];
    let failIncremental = false;
    const deps = dependencies(() => current);
    const service = new SearchService({
      ...deps,
      resolveSources: async (records) => {
        if (failIncremental) {
          failIncremental = false;
          throw new Error("simulated incremental failure");
        }
        return records.map((record) => ({ ...record, title: record.storedName, body: {} }));
      },
    });
    await service.rebuild();

    current = [source("After")];
    failIncremental = true;
    await expect(service.applyCommittedChanges([itemId], 2)).rejects.toThrow(
      "simulated incremental failure",
    );
    await vi.waitFor(() => expect(service.status().state).toBe("ready"));

    await expect(service.search({ query: "after" })).resolves.toMatchObject({
      results: [{ itemId, title: "After" }],
    });
    await expect(service.search({ query: "before" })).resolves.toMatchObject({ results: [] });
  });

  it("keeps unreadable private values out of redacted status and refusal errors", async () => {
    const sentinel = "sentinel-private-envelope-value";
    const deps = dependencies(() => [source("Private")]);
    const service = new SearchService({
      ...deps,
      resolveSources: async () => {
        throw new Error(sentinel);
      },
    });

    await expect(service.rebuild()).rejects.toThrow(sentinel);
    expect(JSON.stringify(service.status())).not.toContain(sentinel);
    const refusal = service.search({ query: "sentinel-private-query" });
    await expect(refusal).rejects.toBeInstanceOf(SearchUnavailableError);
    await expect(refusal).rejects.not.toHaveProperty("message", expect.stringContaining(sentinel));
  });
});
