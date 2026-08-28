import type { MergedSearchPage, SearchClientResult } from "@myownnotion/client-core";
import {
  countUnicodeCharacters,
  type ItemKind,
  MAX_SEARCH_QUERY_LENGTH,
  type Uuid,
} from "@myownnotion/domain";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { WorkspaceSearchService } from "../../services/search.ts";
import {
  AsyncState,
  Button,
  DialogContent,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  Field,
  FR_COPY,
  formatNumber,
} from "../../ui/index.ts";
import { ALL_SEARCH_KINDS, type SearchBranchOption, SearchFilters } from "./search-filters.tsx";
import { SearchResults } from "./search-results.tsx";

type SearchPhase = "idle" | "loading" | "settled" | "error";
export type SearchViewState = "empty-query" | "loading" | "results" | "no-results" | "error";
type SearchProblem = "query-too-long" | "unavailable" | null;

const QUERY_TOO_LONG_MESSAGE = FR_COPY.search.queryTooLong;

export function searchQueryProblem(query: string): string | null {
  return countUnicodeCharacters(query) > MAX_SEARCH_QUERY_LENGTH ? QUERY_TOO_LONG_MESSAGE : null;
}

/** Reads the query that is visibly present when the owner submits the form. */
export function searchQueryFromFormData(data: FormData, fallback: string): string {
  const value = data.get("query");
  return typeof value === "string" ? value : fallback;
}

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
  const coverage =
    page.coverage === "complete" ? FR_COPY.search.completeCoverage : FR_COPY.search.localCoverage;
  const selected = page.results.find(({ itemId }) => itemId === selectedItemId);
  const refresh = page.state === "cursor-stale" ? `${FR_COPY.search.contentRefreshed} ` : "";
  const resultLabel = count === 1 ? FR_COPY.search.resultSingular : FR_COPY.search.resultPlural;
  const selection =
    selected === undefined ? "" : ` ${FR_COPY.search.selected} : ${selected.title}.`;
  return `${refresh}${formatNumber(count)} ${resultLabel} dans ${coverage}.${selection}`;
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
  const [problem, setProblem] = useState<SearchProblem>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const requestSerial = useRef(0);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const runSearch = async (
    nextQuery: string,
    nextKinds: readonly ItemKind[],
    nextBranchRootItemId: Uuid | null,
    options: { readonly cursor?: string; readonly append?: boolean } = {},
  ): Promise<void> => {
    if (!/\S/u.test(nextQuery)) {
      setPhase("idle");
      setPage(null);
      setProblem(null);
      return;
    }
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    if (searchQueryProblem(nextQuery) !== null) {
      setPhase("error");
      setPage(null);
      setSelectedItemId(null);
      setProblem("query-too-long");
      return;
    }
    setPhase("loading");
    setProblem(null);
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
      setProblem(null);
    } catch {
      if (requestSerial.current === serial) {
        setPhase("error");
        setProblem("unavailable");
      }
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    // The input stays uncontrolled so a concurrent workspace projection cannot
    // repaint an older React value over text the owner just entered. Read the
    // submitted DOM value atomically for the same reason: it may be newer than
    // this render's state on a constrained browser.
    const submittedQuery = searchQueryFromFormData(
      new FormData(event.currentTarget),
      input.current?.value ?? query,
    );
    setQuery(submittedQuery);
    await runSearch(submittedQuery, kinds, branchRootItemId);
  };

  const results = page?.results ?? [];
  const view = deriveSearchViewState(query, phase, results.length);
  const open = (result: SearchClientResult): void => {
    onOpen(result.itemId as Uuid);
    onClose();
  };

  return (
    <DialogRoot
      open
      setOpen={(openState) => {
        if (!openState) onClose();
      }}
    >
      <DialogContent ref={dialog} className="search-dialog" size="large">
        <header className="search-dialog__header">
          <DialogHeading id="workspace-search-title">{FR_COPY.search.title}</DialogHeading>
          <DialogDismiss aria-label={FR_COPY.search.close} />
        </header>
        <form
          aria-label={FR_COPY.search.dialogLabel}
          className="search-form"
          onSubmit={(event) => void submit(event)}
        >
          <Field
            ref={input}
            id="workspace-search-query"
            label={FR_COPY.search.queryLabel}
            name="query"
            type="text"
            defaultValue=""
            error={problem === "query-too-long" ? QUERY_TOO_LONG_MESSAGE : undefined}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              if (!/\S/u.test(event.target.value)) {
                requestSerial.current += 1;
                setPhase("idle");
                setPage(null);
                setSelectedItemId(null);
                setProblem(null);
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
          <Button
            type="submit"
            variant="primary"
            busy={phase === "loading" && results.length === 0}
          >
            {FR_COPY.search.action}
          </Button>
        </form>

        <SearchFilters
          kinds={kinds}
          branchRootItemId={branchRootItemId}
          branches={branches}
          onKindsChange={(nextKinds) => {
            setKinds(nextKinds);
            setSelectedItemId(null);
            const currentQuery = input.current?.value ?? query;
            setQuery(currentQuery);
            if (/\S/u.test(currentQuery)) {
              void runSearch(currentQuery, nextKinds, branchRootItemId);
            }
          }}
          onBranchChange={(nextBranchRootItemId) => {
            setBranchRootItemId(nextBranchRootItemId);
            setSelectedItemId(null);
            const currentQuery = input.current?.value ?? query;
            setQuery(currentQuery);
            if (/\S/u.test(currentQuery)) {
              void runSearch(currentQuery, kinds, nextBranchRootItemId);
            }
          }}
          onReset={() => {
            setKinds(ALL_SEARCH_KINDS);
            setBranchRootItemId(null);
            setSelectedItemId(null);
            const currentQuery = input.current?.value ?? query;
            setQuery(currentQuery);
            if (/\S/u.test(currentQuery)) {
              void runSearch(currentQuery, ALL_SEARCH_KINDS, null);
            }
          }}
        />

        <p className="visually-hidden" aria-live="polite">
          {searchAnnouncement(page, selectedItemId)}
        </p>
        <div className="search-dialog__content" aria-busy={view === "loading"}>
          {view === "empty-query" ? (
            <AsyncState kind="info" compact description={FR_COPY.search.queryHint} />
          ) : null}
          {view === "loading" ? <AsyncState kind="loading" title={FR_COPY.search.loading} /> : null}
          {page?.state === "server-loading" && view === "results" ? (
            <AsyncState kind="loading" compact title={FR_COPY.search.loadingComplete} />
          ) : null}
          {page?.state === "offline" ? (
            <AsyncState kind="offline" compact description={FR_COPY.search.offline} />
          ) : null}
          {page?.state === "rebuilding" ? (
            <AsyncState kind="pending" compact description={FR_COPY.search.rebuilding} />
          ) : null}
          {page?.state === "degraded" ? (
            <AsyncState kind="error" compact description={FR_COPY.search.degraded} />
          ) : null}
          {page?.state === "cursor-stale" ? (
            <AsyncState kind="pending" compact description={FR_COPY.search.refreshed} />
          ) : null}
          {view === "no-results" ? (
            <AsyncState
              kind="empty"
              description={
                page?.coverage === "local-only"
                  ? FR_COPY.search.noLocalResult
                  : FR_COPY.search.noResult
              }
            />
          ) : null}
          {view === "error" && problem !== "query-too-long" ? (
            <AsyncState kind="error" description={FR_COPY.search.unavailable} />
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
      </DialogContent>
    </DialogRoot>
  );
}
