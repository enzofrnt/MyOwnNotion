/**
 * Device-local workspace presentation state (T059, US1).
 *
 * This state describes how the workspace is presented, never what the owner
 * wrote. It stays in IndexedDB, does not enter revisions or the outbox, and is
 * normalized at the storage boundary so an older or partially-written value
 * cannot make the navigation unusable.
 */

import type { LocalDatabase } from "../local-store/schema.ts";

export const WORKSPACE_PRESENTATION_KEY = "navigation-state";
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 360;

/** How many page positions to retain. Oldest are discarded first. */
export const MAX_REMEMBERED_SCROLL_POSITIONS = 50;

export interface PageScrollAnchor {
  /** Stable block identity when the editor can provide one. */
  readonly blockId: string | null;
  /** Offset within the block, in CSS pixels. */
  readonly offset: number;
  /** Pixel fallback for legacy documents or a block that no longer exists. */
  readonly fallbackPixel: number;
}

export interface WorkspacePresentationState {
  readonly sidebarOpen: boolean;
  readonly sidebarWidth: number;
  /** Whether the favourite shortcuts are rendered on this device. */
  readonly favouritesVisible: boolean;
  /** Whether the favourite shortcut rows are currently revealed. */
  readonly favouritesExpanded: boolean;
  /** Whether the recent shortcuts are rendered on this device. */
  readonly recentsVisible: boolean;
  /** Whether the recent shortcut rows are currently revealed. */
  readonly recentsExpanded: boolean;
  /** Branches the owner has opened, by item id. */
  readonly expandedItemIds: string[];
  readonly lastVisitedItemId: string | null;
  /** Legacy pixel positions, retained while document anchors are rolled out. */
  readonly scrollPositions: Array<readonly [string, number]>;
  /** Item id to semantic page anchor, most recently used last. */
  readonly scrollAnchors: Array<readonly [string, PageScrollAnchor]>;
}

/** Compatibility name used by features 003–009. */
export type NavigationState = WorkspacePresentationState;

export const DEFAULT_WORKSPACE_PRESENTATION_STATE: WorkspacePresentationState = {
  sidebarOpen: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  favouritesVisible: true,
  favouritesExpanded: true,
  recentsVisible: true,
  recentsExpanded: true,
  expandedItemIds: [],
  lastVisitedItemId: null,
  scrollPositions: [],
  scrollAnchors: [],
};

function finiteOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizePixelPositions(value: unknown): Array<readonly [string, number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !finiteOffset(entry[1])
    ) {
      return [];
    }
    return [[entry[0], entry[1]] as const];
  });
}

function normalizeAnchor(value: unknown): PageScrollAnchor | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<PageScrollAnchor>;
  if (
    !(candidate.blockId === null || typeof candidate.blockId === "string") ||
    !finiteOffset(candidate.offset) ||
    !finiteOffset(candidate.fallbackPixel)
  ) {
    return null;
  }
  return {
    blockId: candidate.blockId,
    offset: candidate.offset,
    fallbackPixel: candidate.fallbackPixel,
  };
}

function normalizeAnchors(value: unknown): Array<readonly [string, PageScrollAnchor]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") return [];
    const anchor = normalizeAnchor(entry[1]);
    return anchor === null ? [] : [[entry[0], anchor] as const];
  });
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

/** Normalizes legacy and untrusted IndexedDB values into the current shape. */
export function normalizeWorkspacePresentationState(value: unknown): WorkspacePresentationState {
  const candidate =
    typeof value === "object" && value !== null
      ? (value as Partial<WorkspacePresentationState>)
      : {};
  const expandedItemIds = Array.isArray(candidate.expandedItemIds)
    ? [...new Set(candidate.expandedItemIds.filter((id): id is string => typeof id === "string"))]
    : [];
  return trimWorkspacePresentationState({
    sidebarOpen: typeof candidate.sidebarOpen === "boolean" ? candidate.sidebarOpen : true,
    sidebarWidth:
      typeof candidate.sidebarWidth === "number"
        ? clampSidebarWidth(candidate.sidebarWidth)
        : DEFAULT_SIDEBAR_WIDTH,
    favouritesVisible:
      typeof candidate.favouritesVisible === "boolean" ? candidate.favouritesVisible : true,
    favouritesExpanded:
      typeof candidate.favouritesExpanded === "boolean" ? candidate.favouritesExpanded : true,
    recentsVisible: typeof candidate.recentsVisible === "boolean" ? candidate.recentsVisible : true,
    recentsExpanded:
      typeof candidate.recentsExpanded === "boolean" ? candidate.recentsExpanded : true,
    expandedItemIds,
    lastVisitedItemId:
      typeof candidate.lastVisitedItemId === "string" ? candidate.lastVisitedItemId : null,
    scrollPositions: normalizePixelPositions(candidate.scrollPositions),
    scrollAnchors: normalizeAnchors(candidate.scrollAnchors),
  });
}

export async function readWorkspacePresentationState(
  db: LocalDatabase,
): Promise<WorkspacePresentationState> {
  const row = await db.meta.get(WORKSPACE_PRESENTATION_KEY);
  return normalizeWorkspacePresentationState(row?.value);
}

export async function writeWorkspacePresentationState(
  db: LocalDatabase,
  state: WorkspacePresentationState,
): Promise<void> {
  await db.meta.put({
    key: WORKSPACE_PRESENTATION_KEY,
    value: normalizeWorkspacePresentationState(state),
  });
}

/**
 * Atomically changes one part of the shared presentation record.
 *
 * The sidebar and tree are separate React surfaces. A transactional update
 * prevents a resize and a branch toggle finishing in the opposite order and
 * accidentally restoring stale values for the other surface.
 */
export async function updateWorkspacePresentationState(
  db: LocalDatabase,
  update: (
    current: WorkspacePresentationState,
  ) => WorkspacePresentationState | Promise<WorkspacePresentationState>,
): Promise<WorkspacePresentationState> {
  return await db.transaction("rw", db.meta, async () => {
    const row = await db.meta.get(WORKSPACE_PRESENTATION_KEY);
    const current = normalizeWorkspacePresentationState(row?.value);
    const next = normalizeWorkspacePresentationState(await update(current));
    await db.meta.put({ key: WORKSPACE_PRESENTATION_KEY, value: next });
    return next;
  });
}

/** Compatibility aliases for existing feature imports. */
export const readNavigationState = readWorkspacePresentationState;
export const writeNavigationState = writeWorkspacePresentationState;

export function trimWorkspacePresentationState(
  state: WorkspacePresentationState,
): WorkspacePresentationState {
  return {
    ...state,
    scrollPositions: state.scrollPositions.slice(-MAX_REMEMBERED_SCROLL_POSITIONS),
    scrollAnchors: state.scrollAnchors.slice(-MAX_REMEMBERED_SCROLL_POSITIONS),
  };
}

/** Compatibility alias for existing tests and consumers. */
export const trim = trimWorkspacePresentationState;

/** Records a pixel offset, moving the entry to the most-recent end. */
export function rememberScroll(
  state: WorkspacePresentationState,
  itemId: string,
  offset: number,
): WorkspacePresentationState {
  const without = state.scrollPositions.filter(([id]) => id !== itemId);
  return trimWorkspacePresentationState({
    ...state,
    scrollPositions: [...without, [itemId, Math.max(0, offset)]],
  });
}

export function scrollFor(state: WorkspacePresentationState, itemId: string): number {
  return state.scrollPositions.find(([id]) => id === itemId)?.[1] ?? 0;
}

export function rememberScrollAnchor(
  state: WorkspacePresentationState,
  itemId: string,
  anchor: PageScrollAnchor,
): WorkspacePresentationState {
  const without = state.scrollAnchors.filter(([id]) => id !== itemId);
  return trimWorkspacePresentationState({
    ...state,
    scrollAnchors: [...without, [itemId, anchor]],
  });
}

export function scrollAnchorFor(
  state: WorkspacePresentationState,
  itemId: string,
): PageScrollAnchor | null {
  return state.scrollAnchors.find(([id]) => id === itemId)?.[1] ?? null;
}

export function toggleExpanded(
  state: WorkspacePresentationState,
  itemId: string,
): WorkspacePresentationState {
  const open = new Set(state.expandedItemIds);
  if (open.has(itemId)) open.delete(itemId);
  else open.add(itemId);
  return { ...state, expandedItemIds: [...open] };
}

export function setExpanded(
  state: WorkspacePresentationState,
  itemId: string,
  expanded: boolean,
): WorkspacePresentationState {
  const open = new Set(state.expandedItemIds);
  if (expanded) open.add(itemId);
  else open.delete(itemId);
  return { ...state, expandedItemIds: [...open] };
}

export function setSidebarOpen(
  state: WorkspacePresentationState,
  sidebarOpen: boolean,
): WorkspacePresentationState {
  return { ...state, sidebarOpen };
}

export function setSidebarWidth(
  state: WorkspacePresentationState,
  sidebarWidth: number,
): WorkspacePresentationState {
  return { ...state, sidebarWidth: clampSidebarWidth(sidebarWidth) };
}

export function setLastVisitedItem(
  state: WorkspacePresentationState,
  lastVisitedItemId: string | null,
): WorkspacePresentationState {
  return { ...state, lastVisitedItemId };
}
