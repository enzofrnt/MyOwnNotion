import type { MergedSearchPage, SearchClientResult } from "@myownnotion/client-core";
import { asUuid } from "@myownnotion/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveSearchViewState,
  isSearchShortcut,
  mergeProgressiveSearchPage,
  moveSearchSelection,
  searchAnnouncement,
  searchQueryProblem,
} from "../src/features/search/search-dialog.tsx";
import { SearchFilters } from "../src/features/search/search-filters.tsx";
import { SearchResults } from "../src/features/search/search-results.tsx";
import { ContentApi } from "../src/services/content-api.ts";

const result: SearchClientResult = {
  itemId: asUuid("018f0000-0000-7000-8000-000000000201"),
  revisionId: asUuid("018f0000-0000-7000-8000-000000000202"),
  kind: "page",
  title: "Architecture",
  path: [],
  matchedField: "body",
  snippet: '<img src=x onerror="alert(1)">',
  conflict: true,
  localAvailability: "offloaded",
  source: "local",
  localState: "conflict",
};

const secondResult: SearchClientResult = {
  ...result,
  itemId: asUuid("018f0000-0000-7000-8000-000000000203"),
  revisionId: asUuid("018f0000-0000-7000-8000-000000000204"),
  kind: "folder",
  title: "Architecture archive",
};

function page(
  results: readonly SearchClientResult[],
  overrides: Partial<MergedSearchPage> = {},
): MergedSearchPage {
  return {
    coverage: "complete",
    state: "complete",
    generation: 1,
    results,
    nextCursor: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search dialog states", () => {
  it("distinguishes empty, loading, results, no-results and recoverable error", () => {
    expect(deriveSearchViewState("", "idle", 0)).toBe("empty-query");
    expect(deriveSearchViewState("architecture", "loading", 0)).toBe("loading");
    expect(deriveSearchViewState("architecture", "settled", 1)).toBe("results");
    expect(deriveSearchViewState("architecture", "settled", 0)).toBe("no-results");
    expect(deriveSearchViewState("architecture", "error", 0)).toBe("error");
  });

  it("counts the 512-character query limit as Unicode code points", () => {
    expect(searchQueryProblem("🧠".repeat(512))).toBeNull();
    expect(searchQueryProblem("🧠".repeat(513))).toBe(
      "Search queries are limited to 512 Unicode characters.",
    );
  });

  it("recognises the documented cross-platform keyboard shortcut", () => {
    expect(isSearchShortcut({ key: "k", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isSearchShortcut({ key: "K", ctrlKey: false, metaKey: true })).toBe(true);
    expect(isSearchShortcut({ key: "k", ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("renders combinable type and branch filters with a visible reset action", () => {
    const markup = renderToStaticMarkup(
      SearchFilters({
        kinds: ["page"],
        branchRootItemId: result.itemId,
        branches: [
          { itemId: result.itemId, label: "Projects / Architecture" },
          { itemId: secondResult.itemId, label: "Archive" },
        ],
        onKindsChange: () => undefined,
        onBranchChange: () => undefined,
        onReset: () => undefined,
      }),
    );

    expect(markup).toContain("Filter by type");
    expect(markup).toContain("Pages");
    expect(markup).toContain("Folders");
    expect(markup).toContain("Files");
    expect(markup).toContain("Projects / Architecture");
    expect(markup).toContain("Reset filters");
  });

  it("keeps a stable keyboard selection and merges later pages without duplicates", () => {
    expect(moveSearchSelection([result, secondResult], null, 1)).toBe(result.itemId);
    expect(moveSearchSelection([result, secondResult], result.itemId, 1)).toBe(secondResult.itemId);
    expect(moveSearchSelection([result, secondResult], secondResult.itemId, 1)).toBe(
      secondResult.itemId,
    );

    const merged = mergeProgressiveSearchPage(
      page([result], { nextCursor: "next" }),
      page([result, secondResult], { generation: 1 }),
    );
    expect(merged.results.map(({ itemId }) => itemId)).toEqual([
      result.itemId,
      secondResult.itemId,
    ]);
    expect(searchAnnouncement(merged, secondResult.itemId)).toContain(
      "2 results in the complete workspace. Selected Architecture archive.",
    );
  });

  it("replaces accumulated pages when a stale cursor is refreshed", () => {
    const refreshed = mergeProgressiveSearchPage(
      page([result], { nextCursor: "stale" }),
      page([secondResult], { state: "cursor-stale", generation: 2 }),
    );
    expect(refreshed.results).toEqual([secondResult]);
    expect(searchAnnouncement(refreshed, null)).toContain("Content changed; results refreshed.");
  });

  it("renders private snippets as escaped text, never interpreted markup", () => {
    const markup = renderToStaticMarkup(
      SearchResults({
        results: [result],
        selectedItemId: null,
        onOpen: () => undefined,
        onSelectionChange: () => undefined,
        onReturnToQuery: () => undefined,
      }),
    );
    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("Content released from this device");
    expect(markup).toContain("Unresolved conflict");
  });

  it("sends search text only in a JSON POST body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ coverage: "complete", generation: 1, results: [], nextCursor: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const api = new ContentApi("https://workspace.test");

    await api.search({ query: "sentinel private", limit: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://workspace.test/v1/search");
    expect(url).not.toContain("sentinel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ query: "sentinel private", limit: 20 });
  });
});
