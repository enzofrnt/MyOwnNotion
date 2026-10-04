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
  it("uses the source property icon in headers and falls back for an unknown catalog mark", () => {
    const markup = (icon: string | null) =>
      renderToStaticMarkup(
        createElement(TableView, {
          properties: properties.map((p) => (p.id === ids.text ? { ...p, icon } : p)),
          view,
          page,
          onOpenEntry: vi.fn(),
        }),
      );
    expect(markup("lightbulb")).toContain('data-icon="lightbulb"');
    expect(markup("future-symbol")).not.toContain('data-icon="future-symbol"');
    expect(markup(null)).not.toContain('data-icon="lightbulb"');
    expect(markup(null)).toContain("Aa");
  });
  it("keeps the returned entry button's cell active after clearing the temporary return target", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (returnFocusEntryId: typeof ids.entryB | null) =>
      root.render(
        <TableView
          properties={properties}
          view={view}
          page={page}
          returnFocusEntryId={returnFocusEntryId}
          onOpenEntry={vi.fn()}
          onResize={vi.fn()}
        />,
      );
    try {
      act(() => render(ids.entryB));
      const button = container.querySelector<HTMLButtonElement>(
        `[data-entry-trigger="${ids.entryB}"]`,
      );
      if (button === null) throw new Error("Missing returned entry");
      act(() => button.focus());
      act(() => render(null));
      expect(document.activeElement).toBe(button);
      expect(button.closest("[role=gridcell]")?.getAttribute("tabindex")).toBe("0");
      expect(container.querySelectorAll('[role=gridcell][tabindex="0"]')).toHaveLength(1);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

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

  it("shows the known page and folder glyphs on title buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(TableView, {
        properties,
        view,
        page: {
          ...page,
          availableCount: 3,
          expectedCount: 3,
          rows: [
            {
              ...page.rows[0],
              entryId: ids.entryA,
              itemKind: "folder",
              holdsContent: false,
              title: "Dossier",
            },
            {
              ...page.rows[1],
              entryId: ids.entryB,
              itemKind: "page",
              holdsContent: true,
              title: "Page remplie",
            },
            {
              ...page.rows[1],
              entryId: asUuid("018f4000-0000-7000-8000-000000000008"),
              itemKind: "page",
              holdsContent: false,
              title: "Page vide",
            },
          ],
        },
        onOpenEntry: vi.fn(),
        onResize: vi.fn(),
      }),
    );
    expect(markup).toContain('data-icon="folder"');
    expect(markup).toContain('data-icon="fileText"');
    expect(markup).toContain('data-icon="file"');
  });

  it("replaces the default title glyph with the page or folder icon", () => {
    const markup = renderToStaticMarkup(
      createElement(TableView, {
        properties,
        view,
        page: {
          ...page,
          rows: [
            {
              ...page.rows[0],
              entryId: ids.entryA,
              itemKind: "page",
              icon: "📌",
              title: "Page marquée",
            },
            {
              ...page.rows[1],
              entryId: ids.entryB,
              itemKind: "folder",
              icon: null,
              title: "Dossier",
            },
          ],
        },
        onOpenEntry: vi.fn(),
        onResize: vi.fn(),
      }),
    );
    expect(markup).toContain("📌");
    expect(markup).toContain('data-item-emoji="true"');
    expect(markup).toContain('data-icon="folder"');
    expect(markup.match(/data-item-emoji="true"/g)).toHaveLength(1);
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
    expect(markup).toContain("Largeur de Title : 240 pixels");
    expect(markup).toContain("Largeur de Notes : 180 pixels");
    expect(markup).toContain("database-column-resize");
    expect(markup).toContain('aria-live="polite"');
  });

  it("writes a status from the cell menu without a save form", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const statusId = asUuid("018f4000-0000-7000-8000-000000000010");
    const optionId = asUuid("018f4000-0000-7000-8000-000000000011");
    const statusProperty: DatabaseProperty = {
      id: statusId,
      name: "bob",
      type: "status",
      positionKey: "c",
      state: "active",
      config: {
        options: [
          {
            id: optionId,
            label: "ta soeur",
            positionKey: "a",
            tone: "neutral",
            state: "active",
          },
        ],
      },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onUpdateEntry = vi.fn(async () => undefined);
    const onOpenEntry = vi.fn();
    try {
      act(() =>
        root.render(
          <TableView
            properties={[...properties, statusProperty]}
            view={{
              ...view,
              properties: [
                ...view.properties,
                { propertyId: statusId, visible: true, positionKey: "c", width: 180 },
              ],
            }}
            page={page}
            onOpenEntry={onOpenEntry}
            onUpdateEntry={onUpdateEntry}
            onResize={vi.fn()}
          />,
        ),
      );
      const trigger = container.querySelector<HTMLButtonElement>("button.option-menu__trigger");
      if (trigger === null) throw new Error("Missing status control");
      expect(trigger.textContent).toContain("—");
      expect(container.querySelector(".database-cell-editor")).toBeNull();
      act(() => trigger.click());
      const item = document.querySelector<HTMLElement>(`[data-option-id="${optionId}"]`);
      if (item === null) throw new Error("Missing status option");
      await act(async () => {
        item.click();
        await Promise.resolve();
      });
      expect(onUpdateEntry).toHaveBeenCalledExactlyOnceWith(ids.entryA, {
        kind: "property",
        propertyId: statusId,
        value: { kind: "status", optionId },
      });
      expect(onOpenEntry).not.toHaveBeenCalled();
      expect(container.querySelector(".database-cell-editor")).toBeNull();
      expect(container.querySelector(".database-cell-editor__actions")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("edits a text cell in place from a click and commits on blur", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onUpdateEntry = vi.fn(async () => undefined);
    const onOpenEntry = vi.fn();
    try {
      act(() =>
        root.render(
          <TableView
            properties={properties}
            view={view}
            page={page}
            onOpenEntry={onOpenEntry}
            onUpdateEntry={onUpdateEntry}
            onResize={vi.fn()}
          />,
        ),
      );
      const notes = container.querySelectorAll<HTMLTableCellElement>("tbody td")[1];
      if (notes === undefined) throw new Error("Missing notes cell");
      act(() => notes.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      const input = container.querySelector<HTMLInputElement>(".database-cell-inline-field input");
      if (input === null) throw new Error("Missing inline editor");
      expect(input.classList.contains("database-cell-inline-input")).toBe(true);
      expect(input.placeholder).toBe("Vide");
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(input.selectionEnd);
      expect(notes.classList.contains("database-cell--text")).toBe(true);
      expect(container.querySelector(".database-cell-editor")).toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "Updated");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        await Promise.resolve();
      });
      expect(onUpdateEntry).toHaveBeenCalledExactlyOnceWith(ids.entryA, {
        kind: "property",
        propertyId: ids.text,
        value: { kind: "text", value: "Updated" },
      });
      expect(onOpenEntry).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it.each(["title", "text"])(
    "preserves a replacement selection in a %s cell before queued focus settles",
    async (kind) => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const frames = new Map<number, FrameRequestCallback>();
      let nextFrame = 0;
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        const id = ++nextFrame;
        frames.set(id, callback);
        return id;
      });
      vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
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
              onUpdateEntry={vi.fn()}
              onResize={vi.fn()}
            />,
          ),
        );
        const cell =
          container.querySelectorAll<HTMLTableCellElement>("tbody td")[kind === "title" ? 0 : 1];
        if (cell === undefined) throw new Error("Missing editable cell");
        act(() => {
          cell.focus();
          cell.dispatchEvent(
            new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }),
          );
        });
        const input = cell.querySelector<HTMLInputElement>("input");
        if (input === null) throw new Error("Missing editor");
        input.select();
        await act(async () => {
          await Promise.resolve();
          const pending = [...frames.values()];
          frames.clear();
          for (const frame of pending) frame(16);
        });
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
        expect(input.value).toBe(kind === "title" ? "Alpha" : "First");
      } finally {
        act(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
      }
    },
  );

  it("renames a title from a cell click and opens the entry from the hover control", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onUpdateEntry = vi.fn(async () => undefined);
    const onOpenEntry = vi.fn();
    try {
      act(() =>
        root.render(
          <TableView
            properties={properties}
            view={view}
            page={page}
            onOpenEntry={onOpenEntry}
            onUpdateEntry={onUpdateEntry}
            onResize={vi.fn()}
          />,
        ),
      );
      const titleCell = container.querySelector<HTMLTableCellElement>("tbody td");
      if (titleCell === null) throw new Error("Missing title cell");
      act(() => titleCell.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      const input = container.querySelector<HTMLInputElement>("[data-title-edit]");
      if (input === null) throw new Error("Missing title editor");
      expect(input.value).toBe("Alpha");
      expect(input.selectionStart).toBe(input.value.length);
      expect(input.selectionEnd).toBe(input.value.length);
      expect(document.activeElement).toBe(input);
      expect(onOpenEntry).not.toHaveBeenCalled();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "Alpha 2");
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        await Promise.resolve();
      });
      expect(onUpdateEntry).toHaveBeenCalledExactlyOnceWith(ids.entryA, {
        kind: "title",
        title: "Alpha 2",
      });
      const open = container.querySelector<HTMLButtonElement>(".database-cell-title__open");
      if (open === null) throw new Error("Missing open control");
      act(() => open.click());
      expect(onOpenEntry).toHaveBeenCalledExactlyOnceWith(ids.entryA, open);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
