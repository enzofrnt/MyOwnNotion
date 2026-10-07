import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BoardView,
  boardColumns,
  boardCreateValues,
  boardMoveUpdate,
} from "../src/features/databases/board-view.tsx";
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
  it("creates only the active column value, with empty missing and no retired option", () => {
    expect(boardCreateValues(statusProperty, ids.todo)).toEqual({
      [ids.status]: { kind: "status", optionId: ids.todo },
    });
    expect(boardCreateValues({ ...statusProperty, type: "multi-select" }, ids.done)).toEqual({
      [ids.status]: { kind: "multi-select", optionIds: [ids.done] },
    });
    expect(boardCreateValues(statusProperty, "missing")).toEqual({});
    expect(boardCreateValues(statusProperty, generateUuidV7())).toBeNull();
    expect(boardCreateValues({ ...statusProperty, state: "retired" }, ids.todo)).toBeNull();
  });
  const multi: DatabaseProperty = { ...statusProperty, type: "multi-select" };
  it("shows one canonical entry in each selected column and retired-only entries in missing", () => {
    const rows = page.rows.map((row) => ({
      ...row,
      values: {
        [ids.status]: { kind: "multi-select" as const, optionIds: [ids.todo, ids.done, ids.todo] },
      },
    }));
    const columns = boardColumns(view, multi, rows);
    expect(columns.map((c) => c.rows.length)).toEqual([1, 1, 0]);
    expect(columns[0]?.rows[0]).toBe(columns[1]?.rows[0]);
    const retired: DatabaseProperty = {
      ...multi,
      config: { options: multi.config.options.map((o) => ({ ...o, state: "retired" })) },
    };
    expect(boardColumns(view, retired, rows).map((c) => [c.id, c.rows.length])).toEqual([
      ["missing", 1],
    ]);
  });
  it("encodes multi-select movement as membership intent, with a known origin and no same-column write", () => {
    expect(boardMoveUpdate(multi, ids.done, ids.todo)).toEqual({
      kind: "property",
      propertyId: ids.status,
      optionMove: { from: ids.todo, to: ids.done },
    });
    expect(boardMoveUpdate(multi, "missing", ids.todo)).toEqual({
      kind: "property",
      propertyId: ids.status,
      optionMove: { from: ids.todo, to: "missing" },
    });
    expect(boardMoveUpdate(multi, ids.todo, ids.todo)).toBeNull();
    expect(boardMoveUpdate(multi, ids.done)).toBeNull();
  });
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

  it("offers explicit axis recovery without silently substituting an unrelated property", () => {
    const markup = renderToStaticMarkup(
      createElement(BoardView, {
        properties: [statusProperty],
        view: { ...view, options: { ...view.options, axisPropertyId: generateUuidV7() } },
        page,
        onOpenEntry: vi.fn(),
        onChangeView: vi.fn(),
      }),
    );
    expect(markup).toContain("Grouper");
    expect(markup).toContain("dans les réglages de la vue");
    expect(markup).not.toContain("Colonnes regroupées par");
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
    expect(markup).toContain('option-pill__label">Done');
    expect(markup).toContain('option-pill__label">To do');
    expect(markup).toContain('database-board__count">0</span>');
    expect(markup).toContain('database-board__count">1</span>');
    expect(markup).toContain("Sans status");
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain('aria-posinset="1"');
    expect(markup).toContain('aria-setsize="1"');
    expect(markup).toContain('aria-label="Actions de Alpha"');
    expect(markup).toContain(`data-entry-trigger="${ids.alpha}"`);
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain('class="database-card__controls"');
    expect(markup).not.toContain('role="grid"');
  });

  it("keeps grouping while rendering only this view’s visible card properties in order", () => {
    const textId = generateUuidV7();
    const checkboxId = generateUuidV7();
    const markup = renderToStaticMarkup(
      createElement(BoardView, {
        properties: [
          statusProperty,
          {
            id: textId,
            name: "Details",
            type: "text",
            positionKey: "c",
            state: "active",
            config: {},
          },
          {
            id: checkboxId,
            name: "Reviewed",
            type: "checkbox",
            positionKey: "d",
            state: "active",
            config: {},
          },
        ],
        view: {
          ...view,
          properties: [
            { propertyId: ids.status, visible: false, positionKey: "c" },
            { propertyId: textId, visible: true, positionKey: "b" },
            { propertyId: checkboxId, visible: true, positionKey: "a" },
          ],
        },
        page: {
          ...page,
          rows: page.rows.map((row) => ({
            ...row,
            values: { ...row.values, [textId]: { kind: "text", value: "Card details" } },
          })),
        },
        onOpenEntry: vi.fn(),
        onChangeView: vi.fn(),
      }),
    );
    const card = markup.match(/<li\b[^>]*class="database-card"[^>]*>([\s\S]*?)<\/li>/)?.[1];
    expect(card).toBeDefined();
    expect(card).toContain("Alpha");
    expect(card).toContain("Reviewed");
    expect(card).toContain("Card details");
    expect(card).not.toContain("To do");
    expect(card?.indexOf("Reviewed")).toBeLessThan(card?.indexOf("Card details") ?? 0);
    expect(markup).toContain('option-pill__label">To do');
  });
});
