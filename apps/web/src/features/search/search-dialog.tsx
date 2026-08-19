import type { MergedSearchPage, SearchClientResult } from "@myownnotion/client-core";
import type { ItemKind, Uuid } from "@myownnotion/domain";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { WorkspaceSearchService } from "../../services/search.ts";
import { ALL_SEARCH_KINDS, type SearchBranchOption, SearchFilters } from "./search-filters.tsx";
import { SearchResults } from "./search-results.tsx";

type SearchPhase = "idle" | "loading" | "settled" | "error";
export type SearchViewState = "empty-query" | "loading" | "results" | "no-results" | "error";

export function deriveSearchViewState(
  query: string,
  phase: SearchPhase,
  resultCount: number,
): SearchViewState {
  if (!/\S/u.test(query)) {
    return "empty-query";
  }
  if (phase === "loading") {
    return resultCount > 0 ? "results" : "loading";
  }
  if (phase === "error") {
    return "error";
  }
  return resultCount > 0 ? "results" : "no-results";
}

export function isSearchShortcut(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean {
  return event.key.toLocaleLowerCase("en") === "k" && (event.ctrlKey || event.metaKey);
}

export function moveSearchSelection(
  results: readonly SearchClientResult[],
  selectedItemId: Uuid | null,
  direction: -1 | 1,
): Uuid | null {
  if (results.length === 0) {
    return null;
  }
  if (selectedItemId === null) {
    return direction === 1 ? (results[0]?.itemId ?? null) : null;
  }
  const currentIndex = results.findIndex(({ itemId }) => itemId === selectedItemId);
  if (currentIndex < 0) {
    return results[0]?.itemId ?? null;
  }
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), results.length - 1);
  return results[nextIndex]?.itemId ?? null;
}

export function mergeProgressiveSearchPage(
  current: MergedSearchPage,
  next: MergedSearchPage,
): MergedSearchPage {
  if (next.state === "cursor-stale") {
    return next;
  }
  const seen = new Set(current.results.map(({ itemId }) => itemId));
  return {
    ...next,
    results: [...current.results, ...next.results.filter(({ itemId }) => !seen.has(itemId))],
  };
}

export function searchAnnouncement(
  page: MergedSearchPage | null,
  selectedItemId: Uuid | null,
): string {
  if (page === null) {
    return "";
  }
  const count = page.results.length;
  const coverage = page.coverage === "complete" ? "the complete workspace" : "data on this device";
  const selected = page.results.find(({ itemId }) => itemId === selectedItemId);
  return `${page.state === "cursor-stale" ? "Content changed; results refreshed. " : ""}${count} ${count === 1 ? "result" : "results"} in ${coverage}.${selected === undefined ? "" : ` Selected ${selected.title}.`}`;
}

export function SearchDialog({
  search,
  branches = [],
  onOpen,
  onClose,
}: {
  readonly search: WorkspaceSearchService;
  readonly branches?: readonly SearchBranchOption[];
  readonly onOpen: (itemId: Uuid) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<readonly ItemKind[]>(ALL_SEARCH_KINDS);
  const [branchRootItemId, setBranchRootItemId] = useState<Uuid | null>(null);
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [page, setPage] = useState<MergedSearchPage | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<Uuid | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const requestSerial = useRef(0);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const runSearch = async (
    nextQuery: string,
    nextKinds: readonly ItemKind[],
    nextBranchRootItemId: Uuid | null,
    options: { readonly cursor?: string; readonly append?: boolean } = {},
  ): Promise<void> => {
    if (!/\S/u.test(nextQuery)) {
      setPhase("idle");
      setPage(null);
      return;
    }
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    setPhase("loading");
    try {
      const response = await search.search(
        {
          query: nextQuery,
          ...(nextKinds.length === ALL_SEARCH_KINDS.length ? {} : { kinds: [...nextKinds] }),
          ...(nextBranchRootItemId === null ? {} : { branchRootItemId: nextBranchRootItemId }),
          limit: 20,
          ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        },
        options.append
          ? undefined
          : (local) => {
              if (requestSerial.current === serial) {
                setPage(local);
              }
            },
      );
      if (requestSerial.current !== serial) {
        return;
      }
      const presented =
        options.append && page !== null ? mergeProgressiveSearchPage(page, response) : response;
      setPage(presented);
      setSelectedItemId((current) =>
        current !== null && presented.results.some(({ itemId }) => itemId === current)
          ? current
          : null,
      );
      setPhase("settled");
    } catch {
      if (requestSerial.current === serial) {
        setPhase("error");
      }
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await runSearch(query, kinds, branchRootItemId);
  };

  const results = page?.results ?? [];
  const view = deriveSearchViewState(query, phase, results.length);
  const open = (result: SearchClientResult): void => {
    onOpen(result.itemId as Uuid);
    onClose();
  };

  return (
    <div className="search-backdrop" role="presentation">
      <section
        ref={dialog}
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-search-title"
      >
        <header className="search-dialog__header">
          <h2 id="workspace-search-title">Search the workspace</h2>
          <button type="button" aria-label="Close search" onClick={onClose}>
            Close
          </button>
        </header>
        <form
          aria-label="Workspace search"
          className="search-form"
          onSubmit={(event) => void submit(event)}
        >
          <label htmlFor="workspace-search-query">Query</label>
          <input
            ref={input}
            id="workspace-search-query"
            type="text"
            value={query}
            maxLength={512}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              if (!/\S/u.test(event.target.value)) {
                requestSerial.current += 1;
                setPhase("idle");
                setPage(null);
                setSelectedItemId(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" || results.length === 0) {
                return;
              }
              event.preventDefault();
              const next = results[0]?.itemId ?? null;
              setSelectedItemId(next);
              const firstResult =
                dialog.current?.querySelector<HTMLButtonElement>("[data-search-result]");
              firstResult?.focus();
            }}
          />
          <button type="submit">Search</button>
        </form>

        <SearchFilters
          kinds={kinds}
          branchRootItemId={branchRootItemId}
          branches={branches}
          onKindsChange={(nextKinds) => {
            setKinds(nextKinds);
            setSelectedItemId(null);
            if (/\S/u.test(query)) {
              void runSearch(query, nextKinds, branchRootItemId);
            }
          }}
          onBranchChange={(nextBranchRootItemId) => {
            setBranchRootItemId(nextBranchRootItemId);
            setSelectedItemId(null);
            if (/\S/u.test(query)) {
              void runSearch(query, kinds, nextBranchRootItemId);
            }
          }}
          onReset={() => {
            setKinds(ALL_SEARCH_KINDS);
            setBranchRootItemId(null);
            setSelectedItemId(null);
            if (/\S/u.test(query)) {
              void runSearch(query, ALL_SEARCH_KINDS, null);
            }
          }}
        />

        <p className="visually-hidden" aria-live="polite">
          {searchAnnouncement(page, selectedItemId)}
        </p>
        <div className="search-dialog__content" aria-busy={view === "loading"}>
          {view === "empty-query" ? (
            <p className="muted">Search page titles, page content, folders and files.</p>
          ) : null}
          {view === "loading" ? <p role="status">Searching the complete workspace…</p> : null}
          {page?.state === "server-loading" && view === "results" ? (
            <p className="muted" role="status">
              Local results shown. Searching the complete workspace…
            </p>
          ) : null}
          {page?.state === "offline" ? (
            <p className="status-banner" data-state="offline" role="status">
              Search is limited to data available on this device while offline.
            </p>
          ) : null}
          {page?.state === "rebuilding" ? (
            <p className="status-banner" data-state="pending" role="status">
              The complete index is rebuilding. Reliable local results remain available.
            </p>
          ) : null}
          {page?.state === "degraded" ? (
            <p className="status-banner" data-state="error" role="status">
              Complete search is temporarily unavailable. Reliable local results remain visible.
            </p>
          ) : null}
          {page?.state === "cursor-stale" ? (
            <p className="status-banner" data-state="pending" role="status">
              Content changed while loading more. Results were refreshed from the beginning.
            </p>
          ) : null}
          {view === "no-results" ? (
            <p className="empty-state">
              {page?.coverage === "local-only"
                ? "No result in the data available on this device."
                : "No result in the complete workspace."}
            </p>
          ) : null}
          {view === "error" ? (
            <p className="status-banner" data-state="error" role="alert">
              Complete search is temporarily unavailable. Your query is still editable.
            </p>
          ) : null}
          {view === "results" ? (
            <SearchResults
              results={results}
              selectedItemId={selectedItemId}
              onSelectionChange={setSelectedItemId}
              onReturnToQuery={() => input.current?.focus()}
              onOpen={open}
              {...(page?.nextCursor === null || page?.nextCursor === undefined
                ? {}
                : {
                    onLoadMore: () =>
                      void runSearch(query, kinds, branchRootItemId, {
                        cursor: page.nextCursor as string,
                        append: true,
                      }),
                    loadingMore: phase === "loading",
                  })}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
