import {
  LocalSearchSource,
  type MergedSearchPage,
  mergeSearchResults,
  type SearchClientResult,
} from "@myownnotion/client-core";
import type { SearchRequestDto, SearchResultDto } from "@myownnotion/contracts";
import {
  normaliseSearchText,
  type SearchCandidate,
  type SearchMatchedField,
  type Uuid,
} from "@myownnotion/domain";
import type { SearchWorkerCommand, SearchWorkerResult } from "../features/search/search.worker.ts";
import type { ContentApi } from "./content-api.ts";
import type { LocalContentService, LocalProjectionChange } from "./local-content.ts";

const SNIPPET_LIMIT = 320;

export interface SearchWorkerClient {
  request(command: SearchWorkerCommand): Promise<SearchWorkerResult>;
  terminate(): void;
}

export interface WorkspaceSearchContent {
  readonly api: Pick<ContentApi, "search">;
  readonly repository: LocalContentService["repository"];
  readonly databases?: LocalContentService["databases"];
  subscribeProjection(
    listener: (change: LocalProjectionChange) => void | Promise<void>,
  ): () => void;
}

type LocalSearchReader = Pick<LocalSearchSource, "list" | "read" | "activeDescendantIds">;

class BrowserSearchWorkerClient implements SearchWorkerClient {
  readonly #worker = new Worker(new URL("../features/search/search.worker.ts", import.meta.url), {
    type: "module",
  });
  readonly #pending = new Map<
    number,
    {
      readonly resolve: (result: SearchWorkerResult) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  #requestId = 0;

  constructor() {
    this.#worker.addEventListener(
      "message",
      (
        event: MessageEvent<{ readonly requestId: number; readonly result: SearchWorkerResult }>,
      ) => {
        const pending = this.#pending.get(event.data.requestId);
        if (pending === undefined) {
          return;
        }
        this.#pending.delete(event.data.requestId);
        pending.resolve(event.data.result);
      },
    );
    this.#worker.addEventListener("error", () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("Local search worker failed"));
      }
      this.#pending.clear();
    });
  }

  request(command: SearchWorkerCommand): Promise<SearchWorkerResult> {
    this.#requestId += 1;
    const requestId = this.#requestId;
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#worker.postMessage({ requestId, command });
    });
  }

  terminate(): void {
    this.#worker.terminate();
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("Local search worker terminated"));
    }
    this.#pending.clear();
  }
}

function safeSnippet(bodyText: string, matchedTerms: readonly string[]): string | null {
  if (bodyText.length === 0) {
    return null;
  }
  const comparable = normaliseSearchText(bodyText);
  const firstMatch = matchedTerms.reduce((best, term) => {
    const position = comparable.indexOf(term);
    return position < 0 || (best >= 0 && best <= position) ? best : position;
  }, -1);
  const start = Math.max(0, firstMatch < 0 ? 0 : firstMatch - 100);
  const value = bodyText
    .slice(start, start + SNIPPET_LIMIT)
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return value.length === 0
    ? null
    : `${start > 0 ? "…" : ""}${value}${start + SNIPPET_LIMIT < bodyText.length ? "…" : ""}`;
}

function primaryField(candidate: SearchCandidate): SearchMatchedField {
  return candidate.matchedFields[0] ?? (candidate.kind === "file" ? "fileName" : "title");
}

function serverResult(result: SearchResultDto): SearchClientResult {
  return {
    itemId: result.itemId as Uuid,
    revisionId: result.revisionId as Uuid,
    kind: result.kind,
    title: result.title,
    path: result.path.map((segment) => ({ itemId: segment.itemId as Uuid, title: segment.title })),
    matchedField: result.matchedField,
    propertyId: result.propertyId === null ? null : (result.propertyId as Uuid),
    propertyName: result.propertyName,
    snippet: result.snippet,
    conflict: result.conflict,
    source: "server",
    localState: "synchronized",
  };
}

export class WorkspaceSearchService {
  readonly #content: WorkspaceSearchContent;
  readonly #api: Pick<ContentApi, "search">;
  readonly #source: LocalSearchReader;
  readonly #worker: SearchWorkerClient;
  readonly #unsubscribeProjection: () => void;
  #serial: Promise<void> = Promise.resolve();
  #initialBuild: Promise<void> | null = null;
  #sourceVersion = 0;
  #disposed = false;

  constructor(
    content: WorkspaceSearchContent,
    options: {
      readonly api?: Pick<ContentApi, "search">;
      readonly worker?: SearchWorkerClient;
      readonly source?: LocalSearchReader;
    } = {},
  ) {
    this.#content = content;
    this.#api = options.api ?? content.api;
    this.#source = options.source ?? new LocalSearchSource(content.repository, content.databases);
    this.#worker = options.worker ?? new BrowserSearchWorkerClient();
    this.#unsubscribeProjection = content.subscribeProjection(async (change) => {
      await this.#onProjectionChange(change);
    });
  }

  #enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.#serial.then(work);
    this.#serial = run.catch(() => undefined);
    return run;
  }

  async #build(): Promise<void> {
    this.#sourceVersion += 1;
    const entries = await this.#source.list(this.#sourceVersion);
    const result = await this.#worker.request({
      type: "build",
      documents: entries.map(({ document }) => document),
    });
    if (!result.ok) {
      throw new Error("Local search index could not be built");
    }
  }

  async initialize(): Promise<void> {
    if (this.#disposed) {
      throw new Error("Local search is locked");
    }
    this.#initialBuild ??= this.#enqueue(async () => await this.#build());
    await this.#initialBuild;
    await this.#serial;
  }

  async #upsert(itemIds: readonly Uuid[]): Promise<void> {
    this.#sourceVersion += 1;
    const entries = await this.#source.read(itemIds, this.#sourceVersion);
    const activeIds = new Set(entries.map(({ document }) => document.itemId));
    for (const entry of entries) {
      const result = await this.#worker.request({ type: "upsert", document: entry.document });
      if (!result.ok) {
        throw new Error("Local search update was refused");
      }
    }
    for (const itemId of itemIds) {
      if (!activeIds.has(itemId)) {
        const result = await this.#worker.request({
          type: "remove",
          itemId,
          sourceVersion: this.#sourceVersion,
        });
        if (!result.ok) {
          throw new Error("Local search removal was refused");
        }
      }
    }
  }

  async #onProjectionChange(change: LocalProjectionChange): Promise<void> {
    if (change.kind === "clear") {
      await this.dispose();
      return;
    }
    if (this.#disposed) {
      return;
    }
    if (change.kind === "rebuild" || this.#initialBuild === null) {
      const build = this.#enqueue(async () => await this.#build());
      this.#initialBuild = build;
      await build;
      return;
    }
    await this.#enqueue(async () => await this.#upsert(change.itemIds));
  }

  async #localResults(request: SearchRequestDto): Promise<{
    readonly results: SearchClientResult[];
    readonly shadowedItemIds: Set<Uuid>;
  }> {
    const itemIds =
      request.branchRootItemId === undefined || request.branchRootItemId === null
        ? undefined
        : await this.#source.activeDescendantIds(request.branchRootItemId as Uuid);
    const response = await this.#worker.request({
      type: "query",
      query: request.query,
      ...(request.kinds === undefined ? {} : { kinds: request.kinds }),
      ...(itemIds === undefined ? {} : { itemIds }),
      limit: request.limit ?? 20,
    });
    if (!response.ok || response.candidates === undefined) {
      throw new Error("Local search query was refused");
    }
    const entries = await this.#source.read(
      response.candidates.map(({ itemId }) => itemId),
      this.#sourceVersion,
    );
    const entryById = new Map(entries.map((entry) => [entry.document.itemId, entry]));
    const results = response.candidates.flatMap((candidate): SearchClientResult[] => {
      const entry = entryById.get(candidate.itemId);
      if (entry === undefined) {
        return [];
      }
      const matchedField = primaryField(candidate);
      return [
        {
          itemId: candidate.itemId,
          revisionId: candidate.revisionId,
          kind: candidate.kind,
          title: candidate.title,
          path: entry.path,
          matchedField,
          propertyId: matchedField === "property" ? candidate.matchedPropertyId : null,
          propertyName: matchedField === "property" ? candidate.matchedPropertyName : null,
          snippet:
            matchedField === "body"
              ? safeSnippet(candidate.bodyText, candidate.matchedTerms)
              : null,
          conflict: candidate.conflict,
          localAvailability: entry.localAvailability,
          source: "local",
          localState: entry.syncState,
        },
      ];
    });
    const matchedIds = new Set(results.map(({ itemId }) => itemId));
    const allEntries = await this.#source.list(this.#sourceVersion);
    const shadowedItemIds = new Set(
      allEntries
        .filter(
          ({ document, syncState }) => syncState === "pending" && !matchedIds.has(document.itemId),
        )
        .map(({ document }) => document.itemId),
    );
    return { results, shadowedItemIds };
  }

  async search(
    request: SearchRequestDto,
    onLocal?: (page: MergedSearchPage) => void,
  ): Promise<MergedSearchPage> {
    await this.initialize();
    const local = await this.#localResults(request);
    const trashed = await this.#content.repository.listItems("trashed");
    const purged = await this.#content.repository.listItems("purged");
    const removedItemIds = new Set<Uuid>([
      ...trashed.map(({ id }) => id),
      ...purged.map(({ id }) => id),
      ...local.shadowedItemIds,
    ]);
    const loading = mergeSearchResults({
      localResults: local.results,
      serverState: "server-loading",
      serverResults: undefined,
      serverGeneration: null,
      nextCursor: null,
      removedItemIds,
    });
    onLocal?.(loading);

    let server = await this.#api.search(request);
    let completeState: "complete" | "cursor-stale" = "complete";
    if (
      !server.ok &&
      request.cursor !== undefined &&
      server.problem.code === "search.cursor-stale"
    ) {
      const retryRequest: SearchRequestDto = {
        query: request.query,
        ...(request.kinds === undefined ? {} : { kinds: request.kinds }),
        ...(request.branchRootItemId === undefined
          ? {}
          : { branchRootItemId: request.branchRootItemId }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      };
      server = await this.#api.search(retryRequest);
      if (server.ok) {
        completeState = "cursor-stale";
      }
    }
    if (!server.ok) {
      const state = server.offline
        ? "offline"
        : server.problem.code === "search.building"
          ? "rebuilding"
          : "degraded";
      return mergeSearchResults({
        localResults: local.results,
        serverState: state,
        serverResults: undefined,
        serverGeneration: null,
        nextCursor: null,
        removedItemIds,
      });
    }
    const serverResults = server.value.results.map(serverResult);
    const localEntries = await this.#source.read(
      serverResults.map(({ itemId }) => itemId),
      this.#sourceVersion,
    );
    const localEntryById = new Map(localEntries.map((entry) => [entry.document.itemId, entry]));
    return mergeSearchResults({
      localResults: local.results,
      serverState: completeState,
      serverResults: serverResults.map((result) => {
        const localEntry = localEntryById.get(result.itemId);
        if (localEntry === undefined) {
          return result;
        }
        return {
          ...result,
          localAvailability: localEntry.localAvailability,
          ...(localEntry.syncState === "conflict"
            ? { conflict: true, localState: "conflict" as const }
            : {}),
        };
      }),
      serverGeneration: server.value.generation,
      nextCursor: server.value.nextCursor,
      removedItemIds,
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#unsubscribeProjection();
    try {
      await this.#worker.request({ type: "clear" });
    } finally {
      this.#worker.terminate();
    }
  }
}
