/**
 * Remembering where the owner was (T055, US3, FR-014).
 *
 * The behaviour is small; the bound is the part worth testing. Scroll positions
 * accumulate one entry per document ever opened, in a store nobody looks at, so
 * an unbounded map is a leak that surfaces only when a device runs out of room.
 */

import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_WORKSPACE_PRESENTATION_STATE,
  MAX_REMEMBERED_SCROLL_POSITIONS,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  type NavigationState,
  normalizeWorkspacePresentationState,
  openLocalDatabase,
  readWorkspacePresentationState,
  rememberScroll,
  rememberScrollAnchor,
  scrollAnchorFor,
  scrollFor,
  setExpanded,
  setLastVisitedItem,
  setSidebarOpen,
  setSidebarWidth,
  toggleExpanded,
  trim,
  updateWorkspacePresentationState,
  writeWorkspacePresentationState,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it } from "vitest";

const empty: NavigationState = DEFAULT_WORKSPACE_PRESENTATION_STATE;

describe("scroll positions", () => {
  it("remembers an offset and returns it", () => {
    const state = rememberScroll(empty, "item-1", 240);
    expect(scrollFor(state, "item-1")).toBe(240);
  });

  it("returns zero for a document never opened", () => {
    expect(scrollFor(empty, "unknown")).toBe(0);
  });

  it("replaces rather than duplicates an existing entry", () => {
    const state = rememberScroll(rememberScroll(empty, "item-1", 10), "item-1", 99);
    expect(state.scrollPositions).toHaveLength(1);
    expect(scrollFor(state, "item-1")).toBe(99);
  });

  it("keeps only the most recent entries", () => {
    let state = empty;
    for (let index = 0; index < MAX_REMEMBERED_SCROLL_POSITIONS + 10; index += 1) {
      state = rememberScroll(state, `item-${index}`, index);
    }
    expect(state.scrollPositions).toHaveLength(MAX_REMEMBERED_SCROLL_POSITIONS);
    // The oldest are the ones dropped, so the newest survive.
    expect(scrollFor(state, `item-${MAX_REMEMBERED_SCROLL_POSITIONS + 9}`)).toBe(
      MAX_REMEMBERED_SCROLL_POSITIONS + 9,
    );
    expect(scrollFor(state, "item-0")).toBe(0);
  });

  it("treats re-opening a document as recent, so it is not dropped next", () => {
    // Otherwise the bound would evict by first use rather than last, and the
    // document an owner keeps returning to would be the one forgotten.
    let state = empty;
    for (let index = 0; index < MAX_REMEMBERED_SCROLL_POSITIONS; index += 1) {
      state = rememberScroll(state, `item-${index}`, index);
    }
    state = rememberScroll(state, "item-0", 500);
    state = rememberScroll(state, "newcomer", 1);

    expect(scrollFor(state, "item-0")).toBe(500);
  });

  it("trims on write rather than on read", () => {
    // A bound applied only when reading leaves the growth in place and hides it.
    const oversized: NavigationState = {
      ...empty,
      scrollPositions: Array.from({ length: 200 }, (_, index) => [`i-${index}`, index] as const),
    };
    expect(trim(oversized).scrollPositions).toHaveLength(MAX_REMEMBERED_SCROLL_POSITIONS);
  });
});

describe("expanded branches", () => {
  it("toggles a branch open and closed", () => {
    const opened = toggleExpanded(empty, "branch");
    expect(opened.expandedItemIds).toContain("branch");
    expect(toggleExpanded(opened, "branch").expandedItemIds).not.toContain("branch");
  });

  it("sets a branch state without needing to know the previous one", () => {
    const state = setExpanded(setExpanded(empty, "branch", true), "branch", true);
    expect(state.expandedItemIds).toEqual(["branch"]);
  });
});

describe("workspace presentation normalization", () => {
  it("uses safe defaults for absent and malformed values", () => {
    expect(normalizeWorkspacePresentationState(null)).toEqual(empty);
    expect(
      normalizeWorkspacePresentationState({
        sidebarOpen: "yes",
        sidebarWidth: Number.NaN,
        expandedItemIds: ["one", 2, "one"],
        lastVisitedItemId: false,
        scrollPositions: [
          ["good", 12],
          ["negative", -1],
          ["infinite", Number.POSITIVE_INFINITY],
          ["short"],
          "bad",
        ],
        scrollAnchors: [
          ["good", { blockId: null, offset: 3, fallbackPixel: 9 }],
          ["missing", { blockId: "block", offset: 3 }],
          ["negative", { blockId: "block", offset: -1, fallbackPixel: 9 }],
          [3, { blockId: null, offset: 0, fallbackPixel: 0 }],
          ["short"],
        ],
      }),
    ).toEqual({
      ...empty,
      expandedItemIds: ["one"],
      scrollPositions: [["good", 12]],
      scrollAnchors: [["good", { blockId: null, offset: 3, fallbackPixel: 9 }]],
    });
  });

  it("rounds and clamps sidebar widths", () => {
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 100)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 100)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(279.6)).toBe(280);
  });

  it("normalizes current fields and trims both position histories", () => {
    const oversized = Array.from(
      { length: MAX_REMEMBERED_SCROLL_POSITIONS + 2 },
      (_, index) => [`item-${index}`, index] as const,
    );
    const state = normalizeWorkspacePresentationState({
      sidebarOpen: false,
      sidebarWidth: 300,
      expandedItemIds: ["branch"],
      lastVisitedItemId: "page",
      scrollPositions: oversized,
      scrollAnchors: oversized.map(
        ([id, offset]) =>
          [id, { blockId: `block-${offset}`, offset, fallbackPixel: offset }] as const,
      ),
    });

    expect(state.sidebarOpen).toBe(false);
    expect(state.sidebarWidth).toBe(300);
    expect(state.scrollPositions).toHaveLength(MAX_REMEMBERED_SCROLL_POSITIONS);
    expect(state.scrollAnchors).toHaveLength(MAX_REMEMBERED_SCROLL_POSITIONS);
    expect(state.scrollPositions[0]?.[0]).toBe("item-2");
  });
});

describe("semantic scroll anchors and shell setters", () => {
  it("remembers, replaces and finds a semantic anchor", () => {
    const first = rememberScrollAnchor(empty, "page", {
      blockId: "block-a",
      offset: 4,
      fallbackPixel: 40,
    });
    const replaced = rememberScrollAnchor(first, "page", {
      blockId: "block-b",
      offset: 8,
      fallbackPixel: 80,
    });

    expect(replaced.scrollAnchors).toHaveLength(1);
    expect(scrollAnchorFor(replaced, "page")).toEqual({
      blockId: "block-b",
      offset: 8,
      fallbackPixel: 80,
    });
    expect(scrollAnchorFor(replaced, "missing")).toBeNull();
  });

  it("bounds anchors and exposes immutable shell updates", () => {
    let state = empty;
    for (let index = 0; index < MAX_REMEMBERED_SCROLL_POSITIONS + 1; index += 1) {
      state = rememberScrollAnchor(state, `page-${index}`, {
        blockId: null,
        offset: index,
        fallbackPixel: index,
      });
    }
    state = setSidebarOpen(state, false);
    state = setSidebarWidth(state, MAX_SIDEBAR_WIDTH + 1);
    state = setLastVisitedItem(state, "last");

    expect(state.scrollAnchors).toHaveLength(MAX_REMEMBERED_SCROLL_POSITIONS);
    expect(state.scrollAnchors[0]?.[0]).toBe("page-1");
    expect(state).toMatchObject({
      sidebarOpen: false,
      sidebarWidth: MAX_SIDEBAR_WIDTH,
      lastVisitedItemId: "last",
    });
  });

  it("clamps a negative legacy pixel offset", () => {
    expect(scrollFor(rememberScroll(empty, "page", -20), "page")).toBe(0);
  });
});

describe("workspace presentation storage boundary", () => {
  const databases: ReturnType<typeof openLocalDatabase>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map(async (database) => await database.delete()));
  });

  function database() {
    const db = openLocalDatabase(`navigation-${generateUuidV7()}`);
    databases.push(db);
    return db;
  }

  it("reads defaults when no record exists and normalizes writes", async () => {
    const db = database();
    await expect(readWorkspacePresentationState(db)).resolves.toEqual(empty);

    await writeWorkspacePresentationState(db, {
      ...empty,
      sidebarWidth: MAX_SIDEBAR_WIDTH + 30,
      scrollPositions: [["page", -10]],
    });
    await expect(readWorkspacePresentationState(db)).resolves.toMatchObject({
      sidebarWidth: MAX_SIDEBAR_WIDTH,
      scrollPositions: [],
    });
  });

  it("supports an asynchronous atomic update", async () => {
    const db = database();
    const updated = await updateWorkspacePresentationState(db, async (current) => ({
      ...current,
      sidebarOpen: false,
      lastVisitedItemId: "page",
    }));

    expect(updated).toMatchObject({ sidebarOpen: false, lastVisitedItemId: "page" });
    await expect(readWorkspacePresentationState(db)).resolves.toEqual(updated);
  });
});
