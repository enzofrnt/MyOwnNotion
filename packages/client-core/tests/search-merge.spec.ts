import {
  type MergeSearchInput,
  mergeSearchResults,
  type SearchClientResult,
} from "@myownnotion/client-core";
import { asUuid, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const ids = {
  pending: asUuid("018f0000-0000-7000-8000-000000000301"),
  conflict: asUuid("018f0000-0000-7000-8000-000000000302"),
  synced: asUuid("018f0000-0000-7000-8000-000000000303"),
  removed: asUuid("018f0000-0000-7000-8000-000000000304"),
};

function result(
  itemId: Uuid,
  title: string,
  source: "local" | "server",
  localState: SearchClientResult["localState"] = "synchronized",
): SearchClientResult {
  return {
    itemId,
    revisionId: asUuid(`018f0000-0000-7000-8001-${itemId.slice(-12)}`),
    kind: "page",
    title,
    path: [{ itemId, title }],
    matchedField: "title",
    propertyId: null,
    propertyName: null,
    snippet: null,
    conflict: localState === "conflict",
    localAvailability: "present",
    source,
    localState,
  };
}

function merge(overrides: Partial<MergeSearchInput> = {}) {
  return mergeSearchResults({
    localResults: [],
    serverState: "complete",
    serverResults: [],
    serverGeneration: 1,
    nextCursor: null,
    removedItemIds: new Set(),
    ...overrides,
  });
}

describe("mergeSearchResults", () => {
  it("deduplicates by itemId and keeps pending or conflicted local presentations", () => {
    const page = merge({
      localResults: [
        result(ids.pending, "Pending local", "local", "pending"),
        result(ids.conflict, "Conflict local", "local", "conflict"),
      ],
      serverResults: [
        result(ids.pending, "Old remote", "server"),
        result(ids.conflict, "Chosen remote", "server"),
      ],
    });

    expect(page.results).toHaveLength(2);
    expect(page.results.map(({ title }) => title)).toEqual(["Pending local", "Conflict local"]);
    expect(page.results[1]?.conflict).toBe(true);
  });

  it("uses current server hydration for synchronized identities", () => {
    const page = merge({
      localResults: [result(ids.synced, "Local", "local")],
      serverResults: [
        {
          ...result(ids.synced, "Server", "server"),
          path: [{ itemId: ids.synced, title: "Current server path" }],
        },
      ],
    });

    expect(page.results).toHaveLength(1);
    expect(page.results[0]).toMatchObject({
      title: "Server",
      path: [{ title: "Current server path" }],
      localAvailability: "present",
    });
  });

  it("removes locally trashed identities even when the server response is stale", () => {
    const page = merge({
      serverResults: [result(ids.removed, "Stale remote", "server")],
      removedItemIds: new Set([ids.removed]),
    });
    expect(page.results).toEqual([]);
  });

  it("preserves local results and honest coverage when the server is unavailable", () => {
    const local = result(ids.pending, "Still here", "local", "pending");
    const page = merge({
      localResults: [local],
      serverState: "offline",
      serverResults: undefined,
      serverGeneration: null,
    });

    expect(page).toMatchObject({ coverage: "local-only", state: "offline", results: [local] });
  });

  it("keeps complete coverage while signalling a refreshed stale cursor", () => {
    const refreshed = result(ids.synced, "Refreshed", "server");
    const page = merge({
      serverState: "cursor-stale",
      serverResults: [refreshed],
      serverGeneration: 8,
      nextCursor: "fresh-cursor",
    });

    expect(page).toMatchObject({
      coverage: "complete",
      state: "cursor-stale",
      generation: 8,
      results: [refreshed],
      nextCursor: "fresh-cursor",
    });
  });
});
