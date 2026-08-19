import type { SearchResult, Uuid } from "@myownnotion/domain";
import type { LocalSearchSyncState } from "./local-search-source.ts";

export interface SearchClientResult extends SearchResult {
  readonly localState: LocalSearchSyncState;
}

export type SearchServerState =
  | "server-loading"
  | "complete"
  | "cursor-stale"
  | "offline"
  | "rebuilding"
  | "degraded";

export interface MergeSearchInput {
  readonly localResults: readonly SearchClientResult[];
  readonly serverState: SearchServerState;
  readonly serverResults: readonly SearchClientResult[] | undefined;
  readonly serverGeneration: number | null;
  readonly nextCursor: string | null;
  readonly removedItemIds: ReadonlySet<Uuid>;
}

export interface MergedSearchPage {
  readonly coverage: "local-only" | "complete";
  readonly state: SearchServerState;
  readonly generation: number | null;
  readonly results: readonly SearchClientResult[];
  readonly nextCursor: string | null;
}

function withLocalAvailability(
  server: SearchClientResult,
  local: SearchClientResult | undefined,
): SearchClientResult {
  return {
    ...server,
    ...(local?.localAvailability === undefined
      ? {}
      : { localAvailability: local.localAvailability }),
    localState: local?.localState ?? "synchronized",
  };
}

export function mergeSearchResults(input: MergeSearchInput): MergedSearchPage {
  const localById = new Map(input.localResults.map((result) => [result.itemId, result]));
  const merged: SearchClientResult[] = [];
  const seen = new Set<Uuid>();

  if (input.serverResults !== undefined) {
    for (const server of input.serverResults) {
      if (input.removedItemIds.has(server.itemId) || seen.has(server.itemId)) {
        continue;
      }
      const local = localById.get(server.itemId);
      merged.push(
        local?.localState === "pending" || local?.localState === "conflict"
          ? local
          : withLocalAvailability(server, local),
      );
      seen.add(server.itemId);
    }
  }

  for (const local of input.localResults) {
    if (!seen.has(local.itemId) && !input.removedItemIds.has(local.itemId)) {
      merged.push(local);
      seen.add(local.itemId);
    }
  }

  const hasCompleteCoverage =
    input.serverState === "complete" || input.serverState === "cursor-stale";
  return {
    coverage: hasCompleteCoverage ? "complete" : "local-only",
    state: input.serverState,
    generation: hasCompleteCoverage ? input.serverGeneration : null,
    results: merged,
    nextCursor: hasCompleteCoverage ? input.nextCursor : null,
  };
}
