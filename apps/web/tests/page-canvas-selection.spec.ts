import { describe, expect, it } from "vitest";
import {
  holdsStructuredCanvas,
  MAX_WARMED_PAGE_SESSIONS,
  nextWarmedPageIds,
  visibleWarmedPageIds,
} from "../src/features/hierarchy/page-canvas-selection.ts";

describe("page canvas selection", () => {
  it("never holds an ordinary or unclassified page on the opening skeleton", () => {
    expect(
      holdsStructuredCanvas({
        selectedItemId: "page-1",
        cachedKind: undefined,
        selectedDatabaseId: null,
        selectedEntryId: null,
      }),
    ).toBe(false);
    expect(
      holdsStructuredCanvas({
        selectedItemId: "page-1",
        cachedKind: "page",
        selectedDatabaseId: "other",
        selectedEntryId: "other",
      }),
    ).toBe(false);
  });

  it("holds a known database or entry until that identity has hydrated", () => {
    expect(
      holdsStructuredCanvas({
        selectedItemId: "db-1",
        cachedKind: "database",
        selectedDatabaseId: null,
        selectedEntryId: null,
      }),
    ).toBe(true);
    expect(
      holdsStructuredCanvas({
        selectedItemId: "db-1",
        cachedKind: "database",
        selectedDatabaseId: "db-1",
        selectedEntryId: null,
      }),
    ).toBe(false);
    expect(
      holdsStructuredCanvas({
        selectedItemId: "entry-1",
        cachedKind: "entry",
        selectedDatabaseId: null,
        selectedEntryId: null,
      }),
    ).toBe(true);
    expect(
      holdsStructuredCanvas({
        selectedItemId: "entry-1",
        cachedKind: "entry",
        selectedDatabaseId: null,
        selectedEntryId: "entry-1",
      }),
    ).toBe(false);
  });

  it("keeps recently opened page sessions among the still-open tabs", () => {
    const retain = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
    let warmed: readonly string[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      warmed = nextWarmedPageIds(warmed, id, retain, "page");
    }
    expect(warmed).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    const bounded = nextWarmedPageIds(warmed, "i", retain, "page");
    expect(bounded).toEqual(["b", "c", "d", "e", "f", "g", "h", "i"]);
    expect(bounded).toHaveLength(MAX_WARMED_PAGE_SESSIONS);
    expect(nextWarmedPageIds(bounded, "db", retain, "database")).toEqual(bounded);
    expect(nextWarmedPageIds(bounded, null, retain, undefined)).toEqual(bounded);
  });

  it("mounts the selected ordinary page immediately even before it is warmed", () => {
    expect(visibleWarmedPageIds(["a"], "b", undefined)).toEqual(["a", "b"]);
    expect(visibleWarmedPageIds(["a", "b"], "b", "page")).toEqual(["a", "b"]);
    expect(visibleWarmedPageIds(["a", "b"], "db", "database")).toEqual(["a", "b"]);
  });
});
