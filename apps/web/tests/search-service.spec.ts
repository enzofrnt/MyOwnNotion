import type { LocalSearchEntry } from "@myownnotion/client-core";
import type { SearchRequestDto, SearchResponseDto } from "@myownnotion/contracts";
import { asUuid } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSearchWorkerRuntime,
  type SearchWorkerCommand,
  type SearchWorkerResult,
} from "../src/features/search/search.worker.ts";
import type { ApiResult } from "../src/services/content-api.ts";
import type { LocalProjectionChange } from "../src/services/local-content.ts";
import {
  type SearchWorkerClient,
  searchWorkerUrl,
  type WorkspaceSearchContent,
  WorkspaceSearchService,
} from "../src/services/search.ts";

const itemId = asUuid("018f0000-0000-7000-8000-000000000501");
const revisionId = asUuid("018f0000-0000-7000-8000-000000000502");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchWorkerUrl", () => {
  it("keeps Vite's source worker URL when no production URL was injected", () => {
    expect(searchWorkerUrl().pathname.endsWith("/src/features/search/search.worker.ts")).toBe(true);
  });

  it("uses the emitted worker asset injected by the Bun production build", () => {
    vi.stubGlobal("window", { location: { origin: "https://notes.test" } });
    vi.stubGlobal("__MYOWNNOTION_SEARCH_WORKER_URL__", "/assets/search.worker-reviewed.js");

    expect(searchWorkerUrl().href).toBe("https://notes.test/assets/search.worker-reviewed.js");
  });
});

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
      properties: [],
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
          propertyId: null,
          propertyName: null,
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
  workerRequest?: (command: SearchWorkerCommand) => Promise<SearchWorkerResult>;
}) {
  const runtime = createSearchWorkerRuntime();
  const commands: SearchWorkerCommand[] = [];
  let terminated = false;
  const worker: SearchWorkerClient = {
    request: async (command) => {
      commands.push(command);
      if (input.workerRequest !== undefined) return await input.workerRequest(command);
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
    list: vi.fn(async (sourceVersion: number) =>
      input.entries.map((value) => ({
        ...value,
        document: { ...value.document, sourceVersion },
      })),
    ),
    read: vi.fn(async (itemIds: readonly (typeof itemId)[], sourceVersion: number) =>
      input.entries
        .filter(({ document }) => itemIds.includes(document.itemId))
        .map((value) => ({
          ...value,
          document: { ...value.document, sourceVersion },
        })),
    ),
    activeDescendantIds: async (rootItemId: typeof itemId) =>
      input.entries
        .filter(({ path }) => path.some(({ itemId: pathItemId }) => pathItemId === rootItemId))
        .map(({ document }) => document.itemId),
  };
  const workerFactory = vi.fn(() => worker);
  const service = new WorkspaceSearchService(content, { workerFactory, source });
  return {
    service,
    commands,
    source,
    workerFactory,
    terminated: () => terminated,
    emit: async (change: LocalProjectionChange) => {
      await Promise.all([...listeners].map(async (listener) => await listener(change)));
    },
  };
}

describe("WorkspaceSearchService", () => {
  it("does no derived work for one hundred unused notifications and indexes the current state on first use", async () => {
    const entries = [entry("Before download")];
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

    for (let index = 0; index < 100; index += 1) {
      entries.splice(0, 1, entry(`Downloaded version ${index}`));
      await setup.emit(
        index % 2 === 0 ? { kind: "rebuild" } : { kind: "upsert", itemIds: [itemId] },
      );
    }

    expect(setup.workerFactory).not.toHaveBeenCalled();
    expect(setup.source.list).not.toHaveBeenCalled();
    expect(setup.source.read).not.toHaveBeenCalled();
    expect(setup.commands).toEqual([]);

    await expect(setup.service.search({ query: "downloaded version 99" })).resolves.toMatchObject({
      coverage: "local-only",
      state: "offline",
      results: [{ title: "Downloaded version 99" }],
    });
    expect(setup.workerFactory).toHaveBeenCalledTimes(1);
    expect(setup.commands.filter(({ type }) => type === "build")).toHaveLength(1);
  });

  it("retries a refused first build using the current projection", async () => {
    const entries = [entry("Before failure")];
    const runtime = createSearchWorkerRuntime();
    let refuseBuild = true;
    const setup = harness({
      entries,
      search: async () => completeServerResult("After retry"),
      workerRequest: async (command) => {
        if (command.type === "build" && refuseBuild) {
          refuseBuild = false;
          throw new Error("Search worker unavailable");
        }
        return runtime.handle(command);
      },
    });

    await expect(setup.service.initialize()).rejects.toThrow("Search worker unavailable");
    entries.splice(0, 1, entry("After retry"));
    await expect(setup.service.search({ query: "after retry" })).resolves.toMatchObject({
      results: [{ title: "After retry" }],
    });
    expect(setup.workerFactory).toHaveBeenCalledTimes(2);
    expect(setup.commands.filter(({ type }) => type === "build")).toHaveLength(2);
  });

  it("includes a projection committed while the first build is pending", async () => {
    const entries = [entry("Old snapshot")];
    const runtime = createSearchWorkerRuntime();
    let releaseBuild: (() => void) | undefined;
    const setup = harness({
      entries,
      search: async () => completeServerResult("Latest projection"),
      workerRequest: async (command) => {
        if (command.type === "build") {
          await new Promise<void>((resolve) => {
            releaseBuild = resolve;
          });
        }
        return runtime.handle(command);
      },
    });

    const firstSearch = setup.service.search({ query: "latest projection" });
    await vi.waitFor(() => expect(releaseBuild).toBeDefined());
    entries.splice(0, 1, entry("Latest projection", { syncState: "pending" }));
    await setup.emit({ kind: "upsert", itemIds: [itemId] });
    releaseBuild?.();

    await expect(firstSearch).resolves.toMatchObject({
      results: [{ title: "Latest projection", localState: "pending" }],
    });
    expect(setup.commands.map(({ type }) => type)).toEqual(["build", "upsert", "query"]);
  });

  it("rebuilds before querying after a derived update fails", async () => {
    const entries = [entry("Old index")];
    const runtime = createSearchWorkerRuntime();
    const setup = harness({
      entries,
      search: async () => completeServerResult("Current index"),
      workerRequest: async (command) => {
        if (command.type === "upsert") throw new Error("Search worker stopped");
        return runtime.handle(command);
      },
    });
    await setup.service.initialize();

    entries.splice(0, 1, entry("Current index", { syncState: "pending" }));
    await setup.emit({ kind: "upsert", itemIds: [itemId] });
    await vi.waitFor(() => expect(setup.terminated()).toBe(true));

    await expect(setup.service.search({ query: "current index" })).resolves.toMatchObject({
      results: [{ title: "Current index", localState: "pending" }],
    });
    expect(setup.workerFactory).toHaveBeenCalledTimes(2);
    expect(setup.commands.map(({ type }) => type)).toEqual(["build", "upsert", "build", "query"]);
  });

  it("does not starve a query behind healthy notifications that arrive after its readiness cut", async () => {
    const entries = [entry("Available projection")];
    const runtime = createSearchWorkerRuntime();
    const releases: Array<() => void> = [];
    const setup = harness({
      entries,
      search: async () => completeServerResult("Available projection"),
      workerRequest: async (command) => {
        if (command.type === "upsert") {
          await new Promise<void>((resolve) => releases.push(resolve));
        }
        return runtime.handle(command);
      },
    });
    await setup.service.initialize();
    await setup.emit({ kind: "upsert", itemIds: [itemId] });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const onLocal = vi.fn();
    const query = setup.service.search({ query: "available projection" }, onLocal);
    // Give the query its existing-tail cut before a later healthy notification.
    await Promise.resolve();
    await setup.emit({ kind: "upsert", itemIds: [itemId] });
    releases[0]?.();
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(2));
      await vi.waitFor(() => expect(onLocal).toHaveBeenCalledTimes(1));
      await expect(query).resolves.toMatchObject({
        results: [{ title: "Available projection" }],
      });
    } finally {
      releases[1]?.();
      await setup.service.dispose();
    }
  });

  it("retries worker construction after a failure without poisoning future searches", async () => {
    const setup = harness({
      entries: [entry("Current projection")],
      search: async () => completeServerResult("Current projection"),
    });
    setup.workerFactory.mockImplementationOnce(() => {
      throw new Error("Worker could not start");
    });

    await expect(setup.service.initialize()).rejects.toThrow("Worker could not start");
    await expect(setup.service.search({ query: "current projection" })).resolves.toMatchObject({
      results: [{ title: "Current projection" }],
    });
    expect(setup.workerFactory).toHaveBeenCalledTimes(2);
  });

  it("restarts the derived worker after a query fails", async () => {
    const runtime = createSearchWorkerRuntime();
    let refuseQuery = true;
    const setup = harness({
      entries: [entry("Current projection")],
      search: async () => completeServerResult("Current projection"),
      workerRequest: async (command) => {
        if (command.type === "query" && refuseQuery) {
          refuseQuery = false;
          throw new Error("Search worker stopped");
        }
        return runtime.handle(command);
      },
    });

    await expect(setup.service.search({ query: "current projection" })).rejects.toThrow(
      "Search worker stopped",
    );
    await expect(setup.service.search({ query: "current projection" })).resolves.toMatchObject({
      results: [{ title: "Current projection" }],
    });
    expect(setup.workerFactory).toHaveBeenCalledTimes(2);
    expect(setup.commands.map(({ type }) => type)).toEqual(["build", "query", "build", "query"]);
  });

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

  it("never lets a stalled derived search build block a canonical projection notification", async () => {
    const setup = harness({
      entries: [],
      search: async () => completeServerResult("Unused"),
      workerRequest: async () => await new Promise(() => {}),
    });

    void setup.service.initialize().catch(() => undefined);
    await vi.waitFor(() => expect(setup.commands).toHaveLength(1));
    await expect(setup.emit({ kind: "upsert", itemIds: [itemId] })).resolves.toBeUndefined();
    expect(setup.commands).toEqual([{ type: "build", documents: [] }]);
    await setup.service.dispose();
    expect(setup.terminated()).toBe(true);
  });

  it("does not expose released content while its worker update is still pending", async () => {
    const entries = [entry("Archive", { bodyText: "private released phrase" })];
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

    entries.splice(0, 1, entry("Archive", { localAvailability: "offloaded" }));

    await expect(setup.service.search({ query: "private released phrase" })).resolves.toMatchObject(
      {
        coverage: "local-only",
        state: "offline",
        results: [],
      },
    );
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

  it("keeps a remote-only conflict match visible and marks its unresolved local state", async () => {
    const setup = harness({
      entries: [entry("Local competing draft", { syncState: "conflict" })],
      search: async () => completeServerResult("Remote competing revision"),
    });

    await expect(setup.service.search({ query: "remote match" })).resolves.toMatchObject({
      coverage: "complete",
      results: [
        {
          itemId,
          title: "Remote competing revision",
          conflict: true,
          localState: "conflict",
        },
      ],
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

    expect(setup.terminated()).toBe(true);
    await expect(setup.service.initialize()).rejects.toThrow("locked");
  });

  it("locks an unused search without creating a worker or opening its source", async () => {
    const setup = harness({ entries: [], search: async () => completeServerResult("Unused") });

    await setup.emit({ kind: "clear" });
    await setup.service.dispose();

    expect(setup.workerFactory).not.toHaveBeenCalled();
    expect(setup.source.list).not.toHaveBeenCalled();
    expect(setup.commands).toEqual([]);
    await expect(setup.service.initialize()).rejects.toThrow("locked");
  });

  it("never creates a worker for a source read completed after locking", async () => {
    const setup = harness({
      entries: [entry("Private projection")],
      search: async () => completeServerResult("Unused"),
    });
    let releaseSource: (() => void) | undefined;
    setup.source.list.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseSource = resolve;
      });
      return [entry("Private projection")];
    });

    const opening = setup.service.initialize();
    await vi.waitFor(() => expect(releaseSource).toBeDefined());
    await setup.emit({ kind: "clear" });
    releaseSource?.();

    await expect(opening).rejects.toThrow("locked");
    expect(setup.workerFactory).not.toHaveBeenCalled();
    expect(setup.commands).toEqual([]);
  });
});
