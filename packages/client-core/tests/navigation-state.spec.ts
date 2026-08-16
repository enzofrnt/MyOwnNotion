/**
 * Remembering where the owner was (T055, US3, FR-014).
 *
 * The behaviour is small; the bound is the part worth testing. Scroll positions
 * accumulate one entry per document ever opened, in a store nobody looks at, so
 * an unbounded map is a leak that surfaces only when a device runs out of room.
 */

import {
  MAX_REMEMBERED_SCROLL_POSITIONS,
  type NavigationState,
  rememberScroll,
  scrollFor,
  setExpanded,
  toggleExpanded,
  trim,
} from "@myownnotion/client-core";
import { describe, expect, it } from "vitest";

const empty: NavigationState = {
  expandedItemIds: [],
  lastVisitedItemId: null,
  scrollPositions: [],
};

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
