import { asUuid, type DatabaseProperty, type DatabaseView } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { nextGridCell, TableView } from "../src/features/databases/table-view.tsx";
import type { DatabaseViewPage } from "../src/services/databases.ts";

const ids = {
  database: asUuid("018f4000-0000-7000-8000-000000000001"),
  revision: asUuid("018f4000-0000-7000-8000-000000000002"),
  title: asUuid("018f4000-0000-7000-8000-000000000003"),
  text: asUuid("018f4000-0000-7000-8000-000000000004"),
  view: asUuid("018f4000-0000-7000-8000-000000000005"),
  entryA: asUuid("018f4000-0000-7000-8000-000000000006"),
  entryB: asUuid("018f4000-0000-7000-8000-000000000007"),
};

const properties: DatabaseProperty[] = [
  { id: ids.title, name: "Title", type: "title", positionKey: "a", state: "active", config: {} },
  { id: ids.text, name: "Notes", type: "text", positionKey: "b", state: "active", config: {} },
];
const view: DatabaseView = {
  id: ids.view,
  name: "Main table",
  type: "table",
  positionKey: "a",
  state: "active",
  properties: [
    { propertyId: ids.title, visible: true, positionKey: "a", width: 240 },
    { propertyId: ids.text, visible: true, positionKey: "b", width: 180 },
  ],
  filter: { mode: "all", criteria: [] },
  sorts: [],
  group: null,
  options: { density: "comfortable", freezeTitle: true },
};
const page: DatabaseViewPage = {
  databaseId: ids.database,
  viewId: ids.view,
  definitionRevisionId: ids.revision,
  generation: 1,
  coverage: "complete",
  availableCount: 2,
  expectedCount: 2,
  rows: [
    {
      entryId: ids.entryA,
      revisionId: ids.revision,
      title: "Alpha",
      values: { [ids.text]: { kind: "text", value: "First" } },
      relationTargets: {},
      groupId: null,
      syncState: "synced",
    },
    {
      entryId: ids.entryB,
      revisionId: ids.revision,
      title: "Beta",
      values: { [ids.text]: { kind: "text", value: "Second" } },
      relationTargets: {},
      groupId: null,
      syncState: "pending",
    },
  ],
  groups: [],
  nextCursor: null,
  source: "local",
  staleCursorRecovered: false,
};

describe("database table accessibility (T042)", () => {
  it("moves within bounds and supports row/home/workspace extremes", () => {
    expect(nextGridCell({ row: 1, column: 1 }, "ArrowRight", 3, 3)).toEqual({ row: 1, column: 2 });
    expect(nextGridCell({ row: 2, column: 2 }, "ArrowDown", 3, 3)).toEqual({ row: 2, column: 2 });
    expect(nextGridCell({ row: 1, column: 2 }, "Home", 3, 3)).toEqual({ row: 1, column: 0 });
    expect(nextGridCell({ row: 1, column: 0 }, "End", 3, 3)).toEqual({ row: 1, column: 2 });
    expect(nextGridCell({ row: 1, column: 1 }, "Home", 3, 3, true)).toEqual({ row: 0, column: 0 });
    expect(nextGridCell({ row: 1, column: 1 }, "End", 3, 3, true)).toEqual({ row: 2, column: 2 });
  });

  it("renders a one-tab-stop ARIA grid with logical row indexes and resize alternatives", () => {
    const markup = renderToStaticMarkup(
      createElement(TableView, {
        properties,
        view,
        page,
        onOpenEntry: vi.fn(),
        onResize: vi.fn(),
      }),
    );
    expect(markup).toContain('role="grid"');
    expect(markup).toContain('aria-rowcount="3"');
    expect(markup).toContain('aria-colcount="2"');
    expect(markup).toContain('aria-rowindex="2"');
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toContain('data-grid-mode="navigation"');
    expect(markup).toContain("Réduire la largeur de Title");
    expect(markup).toContain("Augmenter la largeur de Notes");
    expect(markup).toContain('aria-live="polite"');
  });
});
