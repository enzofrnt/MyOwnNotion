/**
 * What the shortcut lists select and how they order it (T053, US3, FR-012).
 *
 * The interesting claim is the one about recents: that ordering items by their
 * current revision identifier orders them by when they last changed. That holds
 * only because revision ids are UUIDv7, whose leading bits are a millisecond
 * timestamp — so it is worth a test that would fail loudly if that ever stopped
 * being true, rather than a comment asserting it.
 */

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  openLocalDatabase,
  type ProjectedItem,
  readWorkspacePresentationState,
  updateWorkspacePresentationState,
  writeWorkspacePresentationState,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { favouritesOf, recentsOf, Sidebar } from "../src/features/navigation/sidebar.tsx";

function item(name: string, favourite: boolean, revisionId = generateUuidV7()): ProjectedItem {
  return {
    id: generateUuidV7(),
    kind: "page",
    name,
    lifecycle: "active",
    currentRevisionId: revisionId,
    trashedAt: null,
    purgeAfter: null,
    favourite,
    pageDocument: null,
    file: null,
    placements: [],
  } as ProjectedItem;
}

describe("favourites", () => {
  it("selects only marked items, ordered by name", () => {
    const items = [item("Zebra", true), item("Apple", true), item("Middle", false)];
    expect(favouritesOf(items).map((entry) => entry.name)).toEqual(["Apple", "Zebra"]);
  });

  it("is empty rather than absent when nothing is marked", () => {
    expect(favouritesOf([item("Apple", false)])).toEqual([]);
  });
});

describe("recents", () => {
  it("puts the most recently changed item first", async () => {
    // Generated in order with a real gap between them, because the claim under
    // test is that the identifiers themselves carry the ordering.
    const first = generateUuidV7();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = generateUuidV7();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const third = generateUuidV7();

    const ordered = recentsOf([
      item("oldest", false, first),
      item("newest", false, third),
      item("middle", false, second),
    ]);
    expect(ordered.map((entry) => entry.name)).toEqual(["newest", "middle", "oldest"]);
  });

  it("stops at five, so a shortcut list stays a shortcut", () => {
    const items = Array.from({ length: 9 }, (_, index) => item(`page ${index}`, false));
    expect(recentsOf(items)).toHaveLength(5);
  });

  it("does not depend on whether anything is a favourite", () => {
    // The two lists answer different questions. A page can be in both, and
    // starring something must not move it in the recents order.
    const items = [item("starred", true), item("plain", false)];
    expect(recentsOf(items)).toHaveLength(2);
  });
});

describe("shortcut presentation", () => {
  const renderSidebar = (overrides: {
    favouritesVisible?: boolean;
    favouritesExpanded?: boolean;
    recentsVisible?: boolean;
    recentsExpanded?: boolean;
  }) =>
    renderToStaticMarkup(
      createElement(Sidebar, {
        items: [item("Favori", true), item("Récent", false)],
        tree: createElement("div", null, "Arbre"),
        creationControls: createElement("button", { type: "button" }, "Nouveau"),
        shortcutPreferences: {
          favouritesVisible: overrides.favouritesVisible ?? true,
          favouritesExpanded: overrides.favouritesExpanded ?? true,
          recentsVisible: overrides.recentsVisible ?? true,
          recentsExpanded: overrides.recentsExpanded ?? true,
        },
        onShortcutExpandedChange: () => undefined,
        onOpen: () => undefined,
        onOpenSearch: () => undefined,
        onOpenSettings: () => undefined,
      }),
    );

  it("names the main hierarchy Notes and keeps shortcut sections independent", () => {
    const markup = renderSidebar({ favouritesExpanded: false, recentsExpanded: true });
    expect(markup).toContain(">Notes<");
    expect(markup).not.toContain("Espace privé");
    expect(markup).toContain('aria-label="Déplier les favoris"');
    expect(markup).toContain('data-testid="recents"');
    expect(markup).not.toContain('data-testid="favourites"');
  });

  it("does not render a shortcut section disabled in settings", () => {
    const markup = renderSidebar({ favouritesVisible: false, recentsVisible: true });
    expect(markup).not.toContain('id="sidebar-favourites-heading"');
    expect(markup).toContain('id="sidebar-recents-heading"');
  });
});

describe("workspace presentation persistence", () => {
  const databases: ReturnType<typeof openLocalDatabase>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map(async (database) => await database.delete()));
  });

  function database() {
    const db = openLocalDatabase(`sidebar-${generateUuidV7()}`);
    databases.push(db);
    return db;
  }

  it("hydrates legacy navigation values with safe sidebar defaults", async () => {
    const db = database();
    await db.meta.put({
      key: "navigation-state",
      value: {
        expandedItemIds: ["branch-a"],
        lastVisitedItemId: "page-a",
        scrollPositions: [],
      },
    });

    await expect(readWorkspacePresentationState(db)).resolves.toMatchObject({
      sidebarOpen: true,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      favouritesVisible: true,
      favouritesExpanded: true,
      recentsVisible: true,
      recentsExpanded: true,
      expandedItemIds: ["branch-a"],
      lastVisitedItemId: "page-a",
    });
  });

  it("persists open state, bounded width, branches and the last item together", async () => {
    const db = database();
    await writeWorkspacePresentationState(db, {
      sidebarOpen: false,
      sidebarWidth: MAX_SIDEBAR_WIDTH + 200,
      favouritesVisible: true,
      favouritesExpanded: false,
      recentsVisible: false,
      recentsExpanded: true,
      expandedItemIds: ["branch-a", "branch-b"],
      lastVisitedItemId: "page-b",
      scrollPositions: [],
      scrollAnchors: [],
    });

    await expect(readWorkspacePresentationState(db)).resolves.toMatchObject({
      sidebarOpen: false,
      sidebarWidth: MAX_SIDEBAR_WIDTH,
      favouritesExpanded: false,
      recentsVisible: false,
      expandedItemIds: ["branch-a", "branch-b"],
      lastVisitedItemId: "page-b",
    });
  });

  it("merges independent sidebar and tree writes without restoring stale fields", async () => {
    const db = database();
    await Promise.all([
      updateWorkspacePresentationState(db, (state) => ({
        ...state,
        sidebarWidth: MIN_SIDEBAR_WIDTH,
        sidebarOpen: false,
      })),
      updateWorkspacePresentationState(db, (state) => ({
        ...state,
        expandedItemIds: ["branch-c"],
        lastVisitedItemId: "page-c",
      })),
    ]);

    await expect(readWorkspacePresentationState(db)).resolves.toMatchObject({
      sidebarOpen: false,
      sidebarWidth: MIN_SIDEBAR_WIDTH,
      expandedItemIds: ["branch-c"],
      lastVisitedItemId: "page-c",
    });
  });
});
