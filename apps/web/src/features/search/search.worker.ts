import {
  prepareSearchQuery,
  type SearchCandidate,
  type SearchDocument,
  type Uuid,
  WorkspaceSearchIndex,
} from "@myownnotion/domain";

export type SearchWorkerCommand =
  | { readonly type: "build"; readonly documents: readonly SearchDocument[] }
  | { readonly type: "upsert"; readonly document: SearchDocument }
  | { readonly type: "remove"; readonly itemId: Uuid; readonly sourceVersion: number }
  | {
      readonly type: "query";
      readonly query: string;
      readonly kinds?: readonly SearchDocument["kind"][];
      readonly itemIds?: readonly Uuid[];
      readonly limit: number;
    }
  | { readonly type: "clear" };

export type SearchWorkerResult =
  | {
      readonly ok: true;
      readonly state: "cold" | "ready";
      readonly size: number;
      readonly candidates?: readonly SearchCandidate[];
    }
  | { readonly ok: false; readonly code: "empty-query" | "query-too-long" | "not-ready" };

export interface SearchWorkerRuntime {
  handle(command: SearchWorkerCommand): SearchWorkerResult;
}

export function createSearchWorkerRuntime(): SearchWorkerRuntime {
  let index: WorkspaceSearchIndex | null = null;
  return {
    handle(command): SearchWorkerResult {
      switch (command.type) {
        case "build": {
          const next = new WorkspaceSearchIndex(command.documents);
          index = next;
          return { ok: true, state: "ready", size: next.size };
        }
        case "upsert": {
          if (index === null) {
            return { ok: false, code: "not-ready" };
          }
          index.upsert(command.document);
          return { ok: true, state: "ready", size: index.size };
        }
        case "remove": {
          if (index === null) {
            return { ok: false, code: "not-ready" };
          }
          index.remove(command.itemId, command.sourceVersion);
          return { ok: true, state: "ready", size: index.size };
        }
        case "query": {
          if (index === null) {
            return { ok: false, code: "not-ready" };
          }
          const query = prepareSearchQuery(command.query);
          if (!query.ok) {
            return { ok: false, code: query.code };
          }
          return {
            ok: true,
            state: "ready",
            size: index.size,
            candidates: index.search(query.value, {
              limit: command.limit,
              ...(command.kinds === undefined ? {} : { kinds: new Set(command.kinds) }),
              ...(command.itemIds === undefined ? {} : { itemIds: new Set(command.itemIds) }),
            }),
          };
        }
        case "clear":
          index = null;
          return { ok: true, state: "cold", size: 0 };
      }
    },
  };
}

type WorkerRequest = { readonly requestId: number; readonly command: SearchWorkerCommand };
type WorkerResponse = { readonly requestId: number; readonly result: SearchWorkerResult };

declare const self: DedicatedWorkerGlobalScope;

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const runtime = createSearchWorkerRuntime();
  self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
    const response: WorkerResponse = {
      requestId: event.data.requestId,
      result: runtime.handle(event.data.command),
    };
    self.postMessage(response);
  });
}
