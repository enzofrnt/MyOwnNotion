import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BoardView, boardColumns, boardMoveUpdate } from "../src/features/databases/board-view.tsx";
import type { DatabaseViewPage } from "../src/services/databases.ts";

const ids = {
  database: generateUuidV7(),
  revision: generateUuidV7(),
  view: generateUuidV7(),
  title: generateUuidV7(),
  status: generateUuidV7(),
  todo: generateUuidV7(),
  done: generateUuidV7(),
  alpha: generateUuidV7(),
};

const statusProperty: DatabaseProperty = {
  id: ids.status,
  name: "Status",
  type: "status",
  positionKey: "b",
  state: "active",
  config: {
    options: [
      { id: ids.todo, label: "To do", positionKey: "a", tone: "gray", state: "active" },
      { id: ids.done, label: "Done", positionKey: "b", tone: "green", state: "active" },
    ],
  },
};

const view: Extract<DatabaseView, { type: "board" }> = {
  id: ids.view,
  name: "Delivery board",
  type: "board",
  positionKey: "a",
  state: "active",
  properties: [
    { propertyId: ids.title, visible: true, positionKey: "a" },
    { propertyId: ids.status, visible: true, positionKey: "b" },
  ],
  filter: { mode: "all", criteria: [] },
  sorts: [],
  group: null,
  options: {
    axisPropertyId: ids.status,
    columnOrder: [ids.done, ids.todo],
    collapsedColumnIds: [],
  },
};

const page: DatabaseViewPage = {
  databaseId: ids.database,
  viewId: ids.view,
  definitionRevisionId: ids.revision,
  generation: 1,
  coverage: "complete",
  availableCount: 1,
  expectedCount: 1,
  rows: [
    {
      entryId: ids.alpha,
      revisionId: generateUuidV7(),
      title: "Alpha",
      values: { [ids.status]: { kind: "status", optionId: ids.todo } },
      relationTargets: {},
      groupId: null,
      syncState: "synced",
    },
  ],
  groups: [],
  nextCursor: null,
  source: "local",
  staleCursorRecovered: false,
};

describe("database board view (T088)", () => {
  it("derives every option column, including empty and missing columns, in saved order", () => {
    const columns = boardColumns(view, statusProperty, page.rows);
    expect(
      columns.map(({ id, label, rows }) => [id, label, rows.map(({ title }) => title)]),
    ).toEqual([
      [ids.done, "Done", []],
      [ids.todo, "To do", ["Alpha"]],
      ["missing", "Sans status", []],
    ]);
  });

  it("translates pointer or keyboard movement into the ordinary typed value command", () => {
    expect(boardMoveUpdate(statusProperty, ids.done)).toEqual({
      kind: "property",
      propertyId: ids.status,
      value: { kind: "status", optionId: ids.done },
    });
    expect(boardMoveUpdate(statusProperty, "missing")).toEqual({
      kind: "property",
      propertyId: ids.status,
    });
  });

  it("uses native lists and named move controls rather than requiring drag-and-drop", () => {
    const markup = renderToStaticMarkup(
      createElement(BoardView, {
        properties: [statusProperty],
        view,
        page,
        onOpenEntry: vi.fn(),
        onUpdateEntry: vi.fn(),
        onChangeView: vi.fn(),
      }),
    );
    expect(markup).toContain('aria-label="Vue Kanban Delivery board"');
    expect(markup).toContain("Done · 0");
    expect(markup).toContain("To do · 1");
    expect(markup).toContain("Sans status · 0");
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain('aria-posinset="1"');
    expect(markup).toContain('aria-setsize="1"');
    expect(markup).toContain('aria-label="Déplacer Alpha dans une autre colonne"');
    expect(markup).toContain(`data-entry-trigger="${ids.alpha}"`);
    expect(markup).not.toContain('role="grid"');
  });
});
