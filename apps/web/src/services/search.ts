import {
  LocalSearchSource,
  type MergedSearchPage,
  mergeSearchResults,
  type SearchClientResult,
} from "@myownnotion/client-core";
import type { SearchRequestDto, SearchResultDto } from "@myownnotion/contracts";
import {
  normaliseSearchText,
  prepareSearchQuery,
  type SearchCandidate,
  type SearchDocument,
  type SearchMatchedField,
  safeSearchSnippet,
  tokenizeSearchText,
  type Uuid,
} from "@myownnotion/domain";
import type { SearchWorkerCommand, SearchWorkerResult } from "../features/search/search.worker.ts";

declare const __MYOWNNOTION_SEARCH_WORKER_URL__: string | undefined;

export function searchWorkerUrl(): URL {
  if (typeof __MYOWNNOTION_SEARCH_WORKER_URL__ === "string") {
    return new URL(__MYOWNNOTION_SEARCH_WORKER_URL__, window.location.origin);
  }
  return new URL("../features/search/search.worker.ts", import.meta.url);
}

import type { ContentApi } from "./content-api.ts";
import type { LocalContentService, LocalProjectionChange } from "./local-content.ts";

const SEARCH_WORKER_REQUEST_TIMEOUT_MS = 10_000;

export interface SearchWorkerClient {
  request(command: SearchWorkerCommand): Promise<SearchWorkerResult>;
  terminate(): void;
}

export interface WorkspaceSearchContent {
  readonly api: Pick<ContentApi, "search">;
  readonly repository: LocalContentService["repository"];
  readonly databases?: LocalContentService["databases"];
  readonly pageOperationLog?: LocalContentService["pageOperationLog"];
  subscribeProjection(
    listener: (change: LocalProjectionChange) => void | Promise<void>,
  ): () => void;
}

type LocalSearchReader = Pick<LocalSearchSource, "list" | "read" | "activeDescendantIds">;

class BrowserSearchWorkerClient implements SearchWorkerClient {
  readonly #worker = new Worker(searchWorkerUrl(), {
    type: "module",
  });
  readonly #pending = new Map<
    number,
    {
      readonly resolve: (result: SearchWorkerResult) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
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
        clearTimeout(pending.timeout);
        pending.resolve(event.data.result);
      },
    );
    this.#worker.addEventListener("error", () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Local search worker failed"));
      }
      this.#pending.clear();
    });
  }

  request(command: SearchWorkerCommand): Promise<SearchWorkerResult> {
    this.#requestId += 1;
    const requestId = this.#requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(requestId)) return;
        reject(new Error("Local search worker did not answer"));
      }, SEARCH_WORKER_REQUEST_TIMEOUT_MS);
      this.#pending.set(requestId, { resolve, reject, timeout });
      this.#worker.postMessage({ requestId, command });
    });
  }

  terminate(): void {
    this.#worker.terminate();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Local search worker terminated"));
    }
    this.#pending.clear();
  }
}

function safeSnippet(bodyText: string, terms: readonly string[]): string | null {
  return safeSearchSnippet(bodyText, terms, normaliseSearchText(bodyText));
}

function primaryField(candidate: SearchCandidate): SearchMatchedField {
  return candidate.matchedFields[0] ?? (candidate.kind === "file" ? "fileName" : "title");
}

/**
 * The worker is an acceleration structure, never an availability authority.
 * Projection notifications and IndexedDB commits are intentionally decoupled,
 * so a worker candidate can briefly describe content that this device has just
 * released. Revalidate the candidate against the current projection before it
 * is exposed to the owner.
 */
function documentStillMatches(document: SearchDocument, rawQuery: string): boolean {
  const query = prepareSearchQuery(rawQuery);
  if (!query.ok) return false;
  const terms = tokenizeSearchText(
    [document.title, document.bodyText, ...document.properties.map(({ text }) => text)].join("\n"),
  );
  return query.value.terms.every((queryTerm) =>
    terms.some((indexedTerm) => indexedTerm.startsWith(queryTerm)),
  );
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
  readonly #workerFactory: () => SearchWorkerClient;
  readonly #injectedWorker: boolean;
  readonly #unsubscribeProjection: () => void;
  #worker: SearchWorkerClient | null;
  #serial: Promise<void> = Promise.resolve();
  #initialBuild: Promise<void> | null = null;
  #started = false;
  #sourceVersion = 0;
  #disposed = false;

  constructor(
    content: WorkspaceSearchContent,
    options: {
      readonly api?: Pick<ContentApi, "search">;
      readonly worker?: SearchWorkerClient;
      readonly workerFactory?: () => SearchWorkerClient;
      readonly source?: LocalSearchReader;
    } = {},
  ) {
    this.#content = content;
    this.#api = options.api ?? content.api;
    this.#source =
      options.source ??
      new LocalSearchSource(content.repository, content.databases, content.pageOperationLog);
    this.#workerFactory = options.workerFactory ?? (() => new BrowserSearchWorkerClient());
    this.#worker = options.worker ?? null;
    this.#injectedWorker = options.worker !== undefined;
    this.#unsubscribeProjection = content.subscribeProjection((change) => {
      // Search is a rebuildable acceleration structure, never part of the
      // canonical projection commit. A cold or failed worker must not hold the
      // workspace synchronization promise — and therefore the whole UI — open.
      // Search itself still awaits this serial queue before answering a query.
      void this.#onProjectionChange(change).catch(() => undefined);
    });
  }

  #enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.#serial.then(async () => {
      if (this.#disposed) throw new Error("Local search is locked");
      await work();
    });
    this.#serial = run.catch(() => undefined);
    return run;
  }

  #activeWorker(): SearchWorkerClient {
    if (this.#disposed) throw new Error("Local search is locked");
    this.#worker ??= this.#workerFactory();
    return this.#worker;
  }

  #invalidateIndex(expectedBuild: Promise<void>): void {
    if (this.#initialBuild !== expectedBuild) return;
    this.#initialBuild = null;
    if (!this.#injectedWorker) {
      this.#worker?.terminate();
      this.#worker = null;
    }
  }

  #scheduleBuild(): Promise<void> {
    const build = this.#enqueue(async () => await this.#build());
    this.#initialBuild = build;
    void build.catch(() => this.#invalidateIndex(build));
    return build;
  }

  async #requestWorker(command: SearchWorkerCommand): Promise<SearchWorkerResult> {
    const indexedBuild = this.#initialBuild;
    try {
      const result = await this.#activeWorker().request(command);
      if (!result.ok && indexedBuild !== null) this.#invalidateIndex(indexedBuild);
      return result;
    } catch (error) {
      if (indexedBuild !== null) this.#invalidateIndex(indexedBuild);
      throw error;
    }
  }

  async #build(): Promise<void> {
    this.#sourceVersion += 1;
    const entries = await this.#source.list(this.#sourceVersion);
    const result = await this.#requestWorker({
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
    this.#started = true;
    // Before first use, projection notifications need no derived work: this
    // snapshot reads the latest committed state. Once started, drain the tail
    // observed after that build, without waiting for an endless quiet period
    // while later download batches continue to arrive.
    while (true) {
      const build = this.#initialBuild ?? this.#scheduleBuild();
      await build;
      const tail = this.#serial;
      await tail;
      if (this.#disposed) throw new Error("Local search is locked");
      if (this.#initialBuild !== null) return;
    }
  }

  async #upsert(itemIds: readonly Uuid[]): Promise<void> {
    this.#sourceVersion += 1;
    const entries = await this.#source.read(itemIds, this.#sourceVersion);
    const activeIds = new Set(entries.map(({ document }) => document.itemId));
    for (const entry of entries) {
      const result = await this.#requestWorker({
        type: "upsert",
        document: entry.document,
      });
      if (!result.ok) {
        throw new Error("Local search update was refused");
      }
    }
    for (const itemId of itemIds) {
      if (!activeIds.has(itemId)) {
        const result = await this.#requestWorker({
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
    if (this.#disposed || !this.#started) {
      return;
    }
    if (change.kind === "rebuild" || this.#initialBuild === null) {
      await this.#scheduleBuild();
      return;
    }
    const indexedBuild = this.#initialBuild;
    try {
      await this.#enqueue(async () => await this.#upsert(change.itemIds));
    } catch (error) {
      this.#invalidateIndex(indexedBuild);
      throw error;
    }
  }

  async #localResults(request: SearchRequestDto): Promise<{
    readonly results: SearchClientResult[];
    readonly shadowedItemIds: Set<Uuid>;
  }> {
    const itemIds =
      request.branchRootItemId === undefined || request.branchRootItemId === null
        ? undefined
        : await this.#source.activeDescendantIds(request.branchRootItemId as Uuid);
    const response = await this.#requestWorker({
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
      if (entry === undefined || !documentStillMatches(entry.document, request.query)) {
        return [];
      }
      const matchedField = primaryField(candidate);
      return [
        {
          itemId: candidate.itemId,
          revisionId: entry.document.revisionId,
          kind: entry.document.kind,
          title: entry.document.title,
          path: entry.path,
          matchedField,
          propertyId: matchedField === "property" ? candidate.matchedPropertyId : null,
          propertyName: matchedField === "property" ? candidate.matchedPropertyName : null,
          snippet:
            matchedField === "body"
              ? safeSnippet(entry.document.bodyText, candidate.matchedTerms)
              : null,
          conflict: entry.document.conflict,
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
    // Termination already drops the transient index. Waiting for a `clear`
    // response first leaves a failed worker alive forever during React's
    // development remount, which can stall Firefox before the workspace opens.
    this.#worker?.terminate();
    this.#worker = null;
  }
}
