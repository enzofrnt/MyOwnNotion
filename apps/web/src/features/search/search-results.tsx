import type { SearchClientResult } from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";

export function SearchResults({
  results,
  selectedItemId,
  onOpen,
  onSelectionChange,
  onReturnToQuery,
  onLoadMore,
  loadingMore = false,
}: {
  readonly results: readonly SearchClientResult[];
  readonly selectedItemId: Uuid | null;
  readonly onOpen: (result: SearchClientResult) => void;
  readonly onSelectionChange: (itemId: Uuid | null) => void;
  readonly onReturnToQuery: () => void;
  readonly onLoadMore?: () => void;
  readonly loadingMore?: boolean;
}) {
  const focusResult = (itemId: Uuid): void => {
    const target = document.getElementById(`search-result-${itemId}`);
    if (target instanceof HTMLButtonElement) {
      target.focus();
    }
  };

  return (
    <>
      <ul className="search-results" aria-label="Search results">
        {results.map((result, index) => (
          <li key={result.itemId} className="search-result">
            <button
              id={`search-result-${result.itemId}`}
              type="button"
              className="search-result__button"
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
              <span className="search-result__heading">
                <span className="search-result__title">{result.title}</span>
                <span className="search-result__kind">{result.kind}</span>
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
                  Matched property: {result.propertyName}
                </span>
              ) : null}
              {result.localAvailability !== undefined && result.localAvailability !== "present" ? (
                <span className="search-result__availability">
                  {result.localAvailability === "offloaded"
                    ? "Content released from this device"
                    : "Content not downloaded on this device"}
                </span>
              ) : null}
              {result.conflict ? (
                <span className="search-result__conflict">Unresolved conflict</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {onLoadMore === undefined ? null : (
        <button
          type="button"
          className="search-results__more"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Loading more…" : "Load more results"}
        </button>
      )}
    </>
  );
}
