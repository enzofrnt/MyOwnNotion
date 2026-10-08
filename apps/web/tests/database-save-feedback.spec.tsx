import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { BoardView } from "../src/features/databases/board-view.tsx";
import { GalleryView } from "../src/features/databases/gallery-view.tsx";
import { ListView } from "../src/features/databases/list-view.tsx";
import type { DatabaseRowSyncState, DatabaseViewPage } from "../src/services/databases.ts";

const statusId = generateUuidV7();
const properties: readonly DatabaseProperty[] = [
  {
    id: statusId,
    type: "status",
    name: "State",
    positionKey: "a",
    state: "active",
    config: { options: [] },
  },
];
const baseView = {
  id: generateUuidV7(),
  name: "Tasks",
  positionKey: "a",
  state: "active" as const,
  properties: [{ propertyId: statusId, visible: true, positionKey: "a" }],
  filter: { mode: "all" as const, criteria: [] },
  sorts: [],
  group: null,
};
const views: readonly DatabaseView[] = [
  {
    ...baseView,
    type: "board",
    options: { axisPropertyId: statusId, columnOrder: [], collapsedColumnIds: [] },
  },
  { ...baseView, type: "gallery", options: { cardPropertyIds: [], preview: "none" } },
  { ...baseView, type: "list", options: { secondaryPropertyIds: [], density: "compact" } },
];

it.each(views)("keeps routine saves quiet in $type while showing conflicts", (view) => {
  const states: readonly DatabaseRowSyncState[] = ["synced", "pending", "conflict"];
  const page: DatabaseViewPage = {
    databaseId: generateUuidV7(),
    viewId: view.id,
    definitionRevisionId: generateUuidV7(),
    generation: 1,
    coverage: "complete",
    availableCount: states.length,
    expectedCount: states.length,
    rows: states.map((syncState) => ({
      entryId: generateUuidV7(),
      revisionId: generateUuidV7(),
      title: `Task ${syncState}`,
      values: {},
      relationTargets: {},
      groupId: null,
      syncState,
    })),
    groups: [],
    nextCursor: null,
    source: "local",
    staleCursorRecovered: false,
  };
  const props = { properties, view, page, onOpenEntry: vi.fn(), onChangeView: vi.fn() };
  const markup = renderToStaticMarkup(
    view.type === "board"
      ? createElement(BoardView, { ...props, view })
      : view.type === "gallery"
        ? createElement(GalleryView, { ...props, view })
        : createElement(ListView, props),
  );
  expect(markup).toContain("Task synced");
  expect(markup).toContain("Task pending");
  expect(markup).not.toContain("Enregistré localement");
  expect(markup).not.toContain("database-sync--pending");
  expect(markup.match(/>Conflit<\/span>/g)).toHaveLength(1);
});
