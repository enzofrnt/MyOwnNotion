import type { LocalSearchEntry } from "@myownnotion/client-core";
import type { SearchRequestDto, SearchResponseDto } from "@myownnotion/contracts";
import { asUuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createSearchWorkerRuntime,
  type SearchWorkerCommand,
} from "../src/features/search/search.worker.ts";
import type { ApiResult } from "../src/services/content-api.ts";
import type { LocalProjectionChange } from "../src/services/local-content.ts";
import {
  type SearchWorkerClient,
  type WorkspaceSearchContent,
  WorkspaceSearchService,
} from "../src/services/search.ts";

const itemId = asUuid("018f0000-0000-7000-8000-000000000501");
const revisionId = asUuid("018f0000-0000-7000-8000-000000000502");

function entry(
  title: string,
  options: {
    readonly bodyText?: string;
    readonly syncState?: LocalSearchEntry["syncState"];
    readonly localAvailability?: LocalSearchEntry["localAvailability"];
    readonly sourceVersion?: number;
  } = {},
): LocalSearchEntry {
  return {
    document: {
      itemId,
      revisionId,
      sourceVersion: options.sourceVersion ?? 0,
      kind: "page",
      title,
      bodyText: options.bodyText ?? "",
      conflict: options.syncState === "conflict",
    },
    path: [{ itemId, title }],
    localAvailability: options.localAvailability ?? "present",
    syncState: options.syncState ?? "synchronized",
  };
}

function completeServerResult(title: string): ApiResult<SearchResponseDto> {
  return {
    ok: true,
    value: {
      coverage: "complete",
      generation: 4,
      results: [
        {
          itemId,
          revisionId,
          kind: "page",
          title,
          path: [{ itemId, title }],
          matchedField: "body",
          snippet: "remote match",
          conflict: false,
        },
      ],
      nextCursor: null,
    },
  };
}

function harness(input: {
  entries: LocalSearchEntry[];
  search: (request: SearchRequestDto) => Promise<ApiResult<SearchResponseDto>>;
}) {
  const runtime = createSearchWorkerRuntime();
  const commands: SearchWorkerCommand[] = [];
  let terminated = false;
  const worker: SearchWorkerClient = {
    request: async (command) => {
      commands.push(command);
      return runtime.handle(command);
    },
    terminate: () => {
      terminated = true;
    },
  };
  const listeners = new Set<(change: LocalProjectionChange) => void | Promise<void>>();
  const content: WorkspaceSearchContent = {
    api: { search: input.search },
    repository: { listItems: async () => [] } as unknown as WorkspaceSearchContent["repository"],
    subscribeProjection: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const source = {
    list: async (sourceVersion: number) =>
      input.entries.map((value) => ({
        ...value,
        document: { ...value.document, sourceVersion },
      })),
    read: async (itemIds: readonly (typeof itemId)[], sourceVersion: number) =>
      input.entries
        .filter(({ document }) => itemIds.includes(document.itemId))
        .map((value) => ({
          ...value,
          document: { ...value.document, sourceVersion },
        })),
    activeDescendantIds: async (rootItemId: typeof itemId) =>
      input.entries
        .filter(({ path }) => path.some(({ itemId: pathItemId }) => pathItemId === rootItemId))
        .map(({ document }) => document.itemId),
  };
  const service = new WorkspaceSearchService(content, { worker, source });
  return {
    service,
    commands,
    terminated: () => terminated,
    emit: async (change: LocalProjectionChange) => {
      await Promise.all([...listeners].map(async (listener) => await listener(change)));
    },
  };
}

describe("WorkspaceSearchService", () => {
  it("shows local pending content before the server and keeps it over a stale remote result", async () => {
    let resolveServer: ((result: ApiResult<SearchResponseDto>) => void) | undefined;
    const server = new Promise<ApiResult<SearchResponseDto>>((resolve) => {
      resolveServer = resolve;
    });
    const setup = harness({
      entries: [entry("Locally revised", { syncState: "pending" })],
      search: async () => await server,
    });
    let localTitle: string | undefined;

    const result = setup.service.search({ query: "locally revised" }, (page) => {
      localTitle = page.results[0]?.title;
    });
    await vi.waitFor(() => expect(localTitle).toBe("Locally revised"));

    resolveServer?.(completeServerResult("Stale remote title"));
    await expect(result).resolves.toMatchObject({
      coverage: "complete",
      results: [{ title: "Locally revised", localState: "pending" }],
    });
  });

  it("updates the transient index after a committed local projection change", async () => {
    const entries = [entry("Before")];
    const setup = harness({
      entries,
      search: async () => ({
        ok: false,
        offline: true,
        problem: {
          type: "about:blank",
          title: "Server unreachable",
          status: 503,
          code: "network.unreachable",
        },
      }),
    });
    await setup.service.initialize();

    entries.splice(0, 1, entry("After local commit", { syncState: "pending" }));
    await setup.emit({ kind: "upsert", itemIds: [itemId] });

    await expect(setup.service.search({ query: "after local commit" })).resolves.toMatchObject({
      coverage: "local-only",
      state: "offline",
      results: [{ title: "After local commit" }],
    });
  });

  it("hydrates server-only matches with the availability known on this device", async () => {
    const setup = harness({
      entries: [entry("Offloaded page", { localAvailability: "offloaded" })],
      search: async () => completeServerResult("Offloaded page"),
    });

    await expect(setup.service.search({ query: "remote match" })).resolves.toMatchObject({
      coverage: "complete",
      results: [{ itemId, localAvailability: "offloaded" }],
    });
  });

  it("passes type and current-branch filters to the transient local index", async () => {
    const setup = harness({
      entries: [entry("Filtered locally")],
      search: async () => ({
        ok: false,
        offline: true,
        problem: {
          type: "about:blank",
          title: "Server unreachable",
          status: 503,
          code: "network.unreachable",
        },
      }),
    });

    await expect(
      setup.service.search({
        query: "filtered",
        kinds: ["page"],
        branchRootItemId: itemId,
      }),
    ).resolves.toMatchObject({ results: [{ itemId, title: "Filtered locally" }] });
    expect(setup.commands).toContainEqual({
      type: "query",
      query: "filtered",
      kinds: ["page"],
      itemIds: [itemId],
      limit: 20,
    });
  });

  it("restarts a stale server page from the beginning without exposing the cursor", async () => {
    const requests: SearchRequestDto[] = [];
    const setup = harness({
      entries: [entry("Fresh result")],
      search: async (request) => {
        requests.push(request);
        return request.cursor === undefined
          ? completeServerResult("Fresh result")
          : {
              ok: false,
              offline: false,
              problem: {
                type: "https://myownnotion.dev/problems/search-cursor-stale",
                title: "Search page is no longer current",
                status: 409,
                code: "search.cursor-stale",
              },
            };
      },
    });

    await expect(
      setup.service.search({ query: "fresh", cursor: "private-stale-cursor" }),
    ).resolves.toMatchObject({
      coverage: "complete",
      state: "cursor-stale",
      results: [{ title: "Fresh result" }],
    });
    expect(requests).toEqual([
      { query: "fresh", cursor: "private-stale-cursor" },
      { query: "fresh" },
    ]);
    expect(JSON.stringify(requests[1])).not.toContain("private-stale-cursor");
  });

  it("clears and terminates the worker when the local projection is locked", async () => {
    const setup = harness({ entries: [], search: async () => completeServerResult("Unused") });
    await setup.service.initialize();

    await setup.emit({ kind: "clear" });

    expect(setup.commands.at(-1)).toEqual({ type: "clear" });
    expect(setup.terminated()).toBe(true);
    await expect(setup.service.initialize()).rejects.toThrow("locked");
  });
});
