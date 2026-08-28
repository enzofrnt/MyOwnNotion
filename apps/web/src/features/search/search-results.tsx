import type { SearchClientResult } from "@myownnotion/client-core";
import type { ItemKind, Uuid } from "@myownnotion/domain";
import { Button, FR_COPY } from "../../ui/index.ts";
import { ItemIcon } from "../../ui/item-icon.tsx";

const KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  page: FR_COPY.search.pages,
  folder: FR_COPY.search.folders,
  file: FR_COPY.search.files,
};

export function SearchResults({
  results,
  selectedItemId,
  onOpen,
  onSelectionChange,
  onReturnToQuery,
  onLoadMore,
  iconByItemId = new Map(),
  loadingMore = false,
}: {
  readonly results: readonly SearchClientResult[];
  readonly selectedItemId: Uuid | null;
  readonly onOpen: (result: SearchClientResult) => void;
  readonly onSelectionChange: (itemId: Uuid | null) => void;
  readonly onReturnToQuery: () => void;
  readonly onLoadMore?: () => void;
  readonly loadingMore?: boolean;
  readonly iconByItemId?: ReadonlyMap<string, string | null>;
}) {
  const focusResult = (itemId: Uuid): void => {
    const target = document.getElementById(`search-result-${itemId}`);
    if (target instanceof HTMLButtonElement) {
      target.focus();
    }
  };

  return (
    <>
      <ul className="search-results" aria-label={FR_COPY.search.resultsLabel}>
        {results.map((result, index) => (
          <li key={result.itemId} className="search-result">
            <Button
              id={`search-result-${result.itemId}`}
              type="button"
              className="search-result__button"
              variant="ghost"
              data-search-result="true"
              aria-current={selectedItemId === result.itemId ? "true" : undefined}
              tabIndex={
                selectedItemId === result.itemId || (selectedItemId === null && index === 0)
                  ? 0
                  : -1
              }
              onFocus={() => onSelectionChange(result.itemId)}
              onClick={() => onOpen(result)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  const next = results[Math.min(index + 1, results.length - 1)];
                  if (next !== undefined) {
                    onSelectionChange(next.itemId);
                    focusResult(next.itemId);
                  }
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  const previous = results[index - 1];
                  if (previous === undefined) {
                    onSelectionChange(null);
                    onReturnToQuery();
                  } else {
                    onSelectionChange(previous.itemId);
                    focusResult(previous.itemId);
                  }
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  onOpen(result);
                }
              }}
            >
              <ItemIcon
                className="search-result__icon"
                kind={result.kind}
                icon={iconByItemId.get(result.itemId) ?? null}
              />
              <span className="search-result__heading">
                <span className="search-result__title">{result.title}</span>
                <span className="search-result__kind">{KIND_LABELS[result.kind]}</span>
              </span>
              {result.path.length > 0 ? (
                <span className="search-result__path">
                  {result.path.map(({ title }) => title).join(" / ")}
                </span>
              ) : null}
              {result.snippet !== null ? (
                <span className="search-result__snippet">{result.snippet}</span>
              ) : null}
              {result.matchedField === "property" && result.propertyName !== null ? (
                <span className="search-result__property">
                  {FR_COPY.search.matchedProperty} : {result.propertyName}
                </span>
              ) : null}
              {result.localAvailability !== undefined && result.localAvailability !== "present" ? (
                <span className="search-result__availability">
                  {result.localAvailability === "offloaded"
                    ? FR_COPY.search.released
                    : FR_COPY.search.notDownloaded}
                </span>
              ) : null}
              {result.conflict ? (
                <span className="search-result__conflict">{FR_COPY.search.unresolvedConflict}</span>
              ) : null}
            </Button>
          </li>
        ))}
      </ul>
      {onLoadMore === undefined ? null : (
        <Button
          type="button"
          className="search-results__more"
          variant="secondary"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? FR_COPY.search.loadingMore : FR_COPY.search.loadMore}
        </Button>
      )}
    </>
  );
}
