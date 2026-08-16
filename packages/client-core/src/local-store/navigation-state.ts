/**
 * What makes returning to a page feel like returning (T055, US3, FR-014).
 *
 * Which branches are open, where the owner was, and how far down each document
 * they had read. None of it is content: it does not participate in revisions,
 * reconciliation or the outbox, and losing it costs an owner a scroll position
 * rather than a word. That is why it lives in the local projection's `meta`
 * store and never leaves the device.
 *
 * The one rule worth stating is the bound. Scroll positions accumulate one
 * entry per document ever opened, and a map that grows without limit in a
 * store an owner cannot see is a leak nobody notices until the device is full.
 * The most recent fifty are kept.
 */

import type { LocalDatabase } from "./schema.ts";

const NAVIGATION_KEY = "navigation-state";

/** How many scroll positions to retain. Oldest are discarded first. */
export const MAX_REMEMBERED_SCROLL_POSITIONS = 50;

export interface NavigationState {
  /** Branches the owner has opened, by item id. */
  readonly expandedItemIds: string[];
  readonly lastVisitedItemId: string | null;
  /** Item id to scroll offset, most recently used last. */
  readonly scrollPositions: Array<readonly [string, number]>;
}

const EMPTY: NavigationState = {
  expandedItemIds: [],
  lastVisitedItemId: null,
  scrollPositions: [],
};

export async function readNavigationState(db: LocalDatabase): Promise<NavigationState> {
  const row = await db.meta.get(NAVIGATION_KEY);
  if (row === undefined) {
    return EMPTY;
  }
  const value = row.value as Partial<NavigationState> | undefined;
  if (value === undefined) {
    return EMPTY;
  }
  return {
    expandedItemIds: Array.isArray(value.expandedItemIds) ? value.expandedItemIds : [],
    lastVisitedItemId: typeof value.lastVisitedItemId === "string" ? value.lastVisitedItemId : null,
    scrollPositions: Array.isArray(value.scrollPositions) ? value.scrollPositions : [],
  };
}

export async function writeNavigationState(
  db: LocalDatabase,
  state: NavigationState,
): Promise<void> {
  await db.meta.put({ key: NAVIGATION_KEY, value: trim(state) });
}

/**
 * Drops the oldest scroll positions past the bound.
 *
 * Applied on write rather than on read, so the stored value is the bounded one
 * — a bound enforced only when reading leaves the growth in place and merely
 * hides it.
 */
export function trim(state: NavigationState): NavigationState {
  if (state.scrollPositions.length <= MAX_REMEMBERED_SCROLL_POSITIONS) {
    return state;
  }
  return {
    ...state,
    scrollPositions: state.scrollPositions.slice(-MAX_REMEMBERED_SCROLL_POSITIONS),
  };
}

/** Records a scroll offset, moving the entry to the most-recent end. */
export function rememberScroll(
  state: NavigationState,
  itemId: string,
  offset: number,
): NavigationState {
  const without = state.scrollPositions.filter(([id]) => id !== itemId);
  return trim({ ...state, scrollPositions: [...without, [itemId, offset]] });
}

export function scrollFor(state: NavigationState, itemId: string): number {
  return state.scrollPositions.find(([id]) => id === itemId)?.[1] ?? 0;
}

export function toggleExpanded(state: NavigationState, itemId: string): NavigationState {
  const open = new Set(state.expandedItemIds);
  if (open.has(itemId)) {
    open.delete(itemId);
  } else {
    open.add(itemId);
  }
  return { ...state, expandedItemIds: [...open] };
}

export function setExpanded(
  state: NavigationState,
  itemId: string,
  expanded: boolean,
): NavigationState {
  const open = new Set(state.expandedItemIds);
  if (expanded) {
    open.add(itemId);
  } else {
    open.delete(itemId);
  }
  return { ...state, expandedItemIds: [...open] };
}
