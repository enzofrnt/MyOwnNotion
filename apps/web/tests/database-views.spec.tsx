import type { DatabaseDto } from "@myownnotion/contracts";
import { type DatabaseDefinition, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DatabasePage } from "../src/features/databases/database-page.tsx";
import { createSavedView, DatabaseToolbar } from "../src/features/databases/database-toolbar.tsx";
import { FilterEditor } from "../src/features/databases/filter-editor.tsx";
import { SortGroupEditor } from "../src/features/databases/sort-group-editor.tsx";
import {
  readDatabaseViewContext,
  resolveActiveDatabaseViewId,
  writeDatabaseViewContext,
} from "../src/features/databases/use-database-view.ts";

const ids = {
  database: generateUuidV7(),
  revision: generateUuidV7(),
  title: generateUuidV7(),
  status: generateUuidV7(),
  date: generateUuidV7(),
  todo: generateUuidV7(),
  table: generateUuidV7(),
  list: generateUuidV7(),
  filter: generateUuidV7(),
  entry: generateUuidV7(),
};

function tableView(overrides: Partial<DatabaseView> = {}): DatabaseView {
  return {
    id: ids.table,
    name: "Table principale",
    type: "table",
    positionKey: "a",
    state: "active",
    properties: [
      { propertyId: ids.title, visible: true, positionKey: "a", width: 260 },
      { propertyId: ids.status, visible: true, positionKey: "b", width: 180 },
    ],
    filter: {
      mode: "any",
      criteria: [
        {
          id: ids.filter,
          propertyId: ids.status,
          operator: "equals",
          operand: { kind: "status", optionId: ids.todo },
        },
      ],
    },
    sorts: [{ propertyId: ids.title, direction: "ascending", missing: "last" }],
    group: { propertyId: ids.status },
    options: { density: "comfortable", freezeTitle: true },
    ...overrides,
  } as DatabaseView;
}

function definition(views: readonly DatabaseView[] = [tableView()]): DatabaseDefinition {
  return {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: ids.database,
    properties: [
      {
        id: ids.title,
        name: "Title",
        type: "title",
        positionKey: "a",
        state: "active",
        config: {},
      },
      {
        id: ids.status,
        name: "Status",
        type: "status",
        positionKey: "b",
        state: "active",
        config: {
          options: [
            { id: ids.todo, label: "To do", positionKey: "a", tone: "neutral", state: "active" },
          ],
        },
      },
    ],
    views,
    taskRoles: null,
  };
}

describe("saved database views (T041)", () => {
  it("creates independent table/list views without duplicating entries", () => {
    const base = definition();
    const withList = createSavedView(base, base.views[0] as DatabaseView, "list", "Compact list");
    expect(withList.views).toHaveLength(2);
    expect(withList.views[1]).toMatchObject({
      name: "Compact list",
      type: "list",
      state: "active",
    });
    expect(withList.views[1]?.id).not.toBe(withList.views[0]?.id);
    expect(withList.databaseId).toBe(base.databaseId);
  });

  it("renders named tabs, creation, duplication, ordering and visible columns", () => {
    const list = createSavedView(definition(), tableView(), "list", "Compact list").views[1];
    if (list === undefined) throw new Error("expected list view");
    const current = definition([tableView(), list]);
    const markup = renderToStaticMarkup(
      createElement(DatabaseToolbar, {
        definition: current,
        activeViewId: ids.table,
        onSelectView: vi.fn(),
        onChange: vi.fn(),
      }),
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Nouvelle vue tableau");
    expect(markup).toContain("Nouvelle vue liste");
    expect(markup).toContain("Dupliquer la vue");
    expect(markup).toContain("Renommer la vue");
    expect(markup).toContain("Déplacer la vue vers la droite");
    expect(markup).toContain("Propriétés visibles");
    expect(markup).toContain("Déplacer la colonne Status vers la gauche");
  });

  it("keeps ALL/ANY, typed rules, sort order and grouping readable", () => {
    const view = tableView();
    const current = definition([view]);
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(FilterEditor, {
          properties: current.properties,
          view,
          onChange: vi.fn(),
        }),
        createElement(SortGroupEditor, {
          properties: current.properties,
          view,
          onChange: vi.fn(),
        }),
      ),
    );
    expect(markup).toContain("Au moins une règle");
    expect(markup).toContain("Status");
    expect(markup).toContain("est égal à");
    expect(markup).toContain("Croissant");
    expect(markup).toContain("Remonter le tri");
    expect(markup).toContain("Regrouper par");
  });

  it("edits both bounds of a readable date period", () => {
    const dateProperty = {
      id: ids.date,
      name: "Due date",
      type: "date",
      positionKey: "c",
      state: "active",
      config: { mode: "date" },
    } as const;
    const view = tableView({
      filter: {
        mode: "all",
        criteria: [
          {
            id: ids.filter,
            propertyId: ids.date,
            operator: "between",
            operand: {
              kind: "date-range",
              from: { kind: "date", date: "2026-08-01" },
              to: { kind: "date", date: "2026-08-31" },
            },
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      createElement(FilterEditor, {
        properties: [...definition().properties, dateProperty],
        view,
        onChange: vi.fn(),
      }),
    );
    expect(markup).toContain("Période pour Due date");
    expect(markup).toContain('aria-label="Début pour Due date"');
    expect(markup).toContain('aria-label="Fin pour Due date"');
    expect(markup.match(/type="date"/g)).toHaveLength(2);
  });

  it("preserves view position and selection in browser history state", () => {
    const context = {
      activeViewId: ids.table,
      selectedEntryId: ids.entry,
      scrollTop: 348,
    } as const;
    const state = writeDatabaseViewContext({ unrelated: "kept" }, ids.database, context);
    expect(state["unrelated"]).toBe("kept");
    expect(readDatabaseViewContext(state, ids.database, ids.table)).toEqual(context);
    expect(readDatabaseViewContext(state, ids.database, ids.list)).toBeNull();
  });

  it("keeps an explicit tab selection when an older definition effect settles", () => {
    expect(
      resolveActiveDatabaseViewId({
        activeViewIds: [ids.table, ids.list],
        currentViewId: ids.table,
        requestedViewId: ids.list,
        urlViewId: ids.table,
        firstActiveViewId: ids.table,
        databaseChanged: false,
      }),
    ).toBe(ids.list);
  });

  it("renders a semantic compact list and explicit complete coverage", () => {
    const list = createSavedView(definition(), tableView(), "list", "Compact list").views[1];
    if (list === undefined) throw new Error("expected list view");
    const current = definition([list]);
    const database: DatabaseDto = {
      databaseId: ids.database,
      definitionRevisionId: ids.revision,
      lifecycle: "active",
      name: "Projects",
      definition: current,
    };
    const markup = renderToStaticMarkup(
      createElement(DatabasePage, {
        database,
        entries: [
          {
            databaseId: ids.database,
            entryId: ids.entry,
            revisionId: generateUuidV7(),
            lifecycle: "active",
            title: "Alpha",
            document: null,
            values: { [ids.status]: { kind: "status", optionId: ids.todo } },
            relationTargets: {},
          },
        ],
        onReplaceDefinition: vi.fn(),
        onCreateEntry: vi.fn(),
        onOpenEntry: vi.fn(),
      }),
    );
    expect(markup).toContain("Résultat complet · 1 entrée");
    expect(markup).toContain("database-list");
    expect(markup).toContain("Alpha");
    expect(markup).toContain("Status");
  });
});
