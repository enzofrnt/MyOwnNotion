// @vitest-environment jsdom
import { asUuid, type DatabaseProperty, type DatabaseView } from "@myownnotion/domain";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
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
  it.each(["column-width", "property-name", "row-values"] as const)(
    "keeps the pressed entry button and current callback through %s updates",
    (change) => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const before = vi.fn();
      const after = vi.fn();
      try {
        act(() =>
          root.render(
            <TableView
              properties={properties}
              view={view}
              page={page}
              onOpenEntry={before}
              onResize={vi.fn()}
            />,
          ),
        );
        const button = container.querySelector<HTMLButtonElement>(
          `[data-entry-trigger="${ids.entryA}"]`,
        );
        if (button === null) throw new Error("Missing entry button");
        button.focus();
        act(() => button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
        expect(before).not.toHaveBeenCalled();
        act(() =>
          root.render(
            <TableView
              properties={
                change === "property-name"
                  ? properties.map((property) =>
                      property.id === ids.text ? { ...property, name: "Updated notes" } : property,
                    )
                  : properties
              }
              view={
                change === "column-width"
                  ? {
                      ...view,
                      properties: view.properties.map((property) => ({ ...property, width: 300 })),
                    }
                  : view
              }
              page={
                change === "row-values"
                  ? {
                      ...page,
                      rows: page.rows.map((row) => ({ ...row, title: `${row.title} updated` })),
                    }
                  : page
              }
              onOpenEntry={after}
              onResize={vi.fn()}
            />,
          ),
        );
        expect(button.isConnected).toBe(true);
        expect(document.activeElement).toBe(button);
        expect(container.querySelector(`[data-entry-trigger="${ids.entryA}"]`)).toBe(button);
        act(() => button.click());
        expect(before).not.toHaveBeenCalled();
        expect(after).toHaveBeenCalledExactlyOnceWith(ids.entryA, button);
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    },
  );

  it.each(["Enter", " "])("does not turn entry-button %s activation into cell editing", (key) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() =>
        root.render(
          <TableView
            properties={properties}
            view={view}
            page={page}
            onOpenEntry={vi.fn()}
            onResize={vi.fn()}
          />,
        ),
      );
      const button = container.querySelector<HTMLButtonElement>("[data-entry-trigger]");
      if (button === null) throw new Error("Missing entry button");
      act(() => {
        button.focus();
        button.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
      expect(button.isConnected).toBe(true);
      expect(container.querySelector('[data-grid-mode="editing"]')).toBeNull();
      const cell = button.closest("td");
      if (cell === null) throw new Error("Missing title cell");
      act(() =>
        cell.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
      );
      expect(container.querySelector('[data-grid-mode="editing"]')).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

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
