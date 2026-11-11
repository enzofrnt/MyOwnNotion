import { generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphLegend } from "../src/features/knowledge-graph/graph-legend.tsx";
import { DEFAULT_GRAPH_PREFERENCES } from "../src/features/knowledge-graph/graph-preferences.ts";
import { initialGraphControls } from "../src/features/knowledge-graph/knowledge-graph-view.tsx";
import {
  createDefaultGraphControlState,
  GraphControls,
  graphControlFilterCount,
  graphQueryFromControls,
  resetGraphControlState,
} from "../src/features/knowledge-graph/graph-controls.tsx";

describe("global graph controls", () => {
  it("combines visible filters and resets them in one action", () => {
    const rootId = generateUuidV7();
    const state = createDefaultGraphControlState({ kind: "workspace" });
    state.scope = { kind: "branch", rootId };
    state.edgeLayers = ["knowledge", "hierarchy"];
    state.nodeKinds = ["page", "file"];
    state.relationTypes = ["page:link"];
    state.structured = [{ field: "status", operator: "equals", value: "En cours" }];
    state.includeIsolated = true;
    const query = graphQueryFromControls(state);
    expect(query).toMatchObject({
      scope: { kind: "branch", rootId },
      filters: {
        edgeLayers: ["knowledge", "hierarchy"],
        nodeKinds: ["page", "file"],
        relationTypes: ["page:link"],
        structured: [{ field: "status", operator: "equals", value: "En cours" }],
        includeIsolated: true,
      },
    });
    expect(resetGraphControlState(state)).toEqual(
      createDefaultGraphControlState({ kind: "workspace" }),
    );
  });

  it("counts only filters that diverge from the default view", () => {
    const state = createDefaultGraphControlState({ kind: "workspace" });
    expect(graphControlFilterCount(state)).toBe(0);
    state.includeIsolated = true;
    state.nodeKinds = ["page"];
    expect(graphControlFilterCount(state)).toBe(2);
  });

  it("starts with knowledge only and exposes structural layers separately", () => {
    const state = createDefaultGraphControlState({ kind: "workspace" });
    expect(state.edgeLayers).toEqual(["knowledge"]);
    const markup = renderToStaticMarkup(
      createElement(GraphControls, {
        state,
        items: [],
        relationTypes: [],
        structuredDimensions: [],
        onChange: () => undefined,
      }),
    );
    // Nothing singled out: “Tous” is the pressed state and the way back to it.
    expect(markup).toMatch(/aria-pressed="true"[^>]*aria-label="Types d’élément : tous"/u);
    expect(markup).toContain('aria-label="À propos de Hiérarchie"');
    expect(markup).toContain("Calques du graphe");
    expect(markup).toContain("Connaissances");
    expect(markup).toContain("Hiérarchie");
    expect(markup).toContain("Pièces jointes");
  });

  it("exposes manual selection and user-facing relation and structured labels", () => {
    const itemId = generateUuidV7();
    const state = createDefaultGraphControlState({ kind: "workspace" });
    state.scope = { kind: "selection", itemIds: [itemId] };
    const markup = renderToStaticMarkup(
      createElement(GraphControls, {
        state,
        items: [{ id: itemId, name: "Page choisie" }],
        relationTypes: ["page:link"],
        structuredDimensions: [
          { field: "status", label: "Statut", kind: "value", values: ["En cours"] },
          { field: "dueDate", label: "Échéance", kind: "date", values: ["2026-08-31"] },
        ],
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain("Éléments sélectionnés");
    expect(markup).toContain("Page choisie");
    expect(markup).toContain("Lien interne");
    expect(markup).toContain("Statut");
    expect(markup).toContain("Échéance");
  });

  it("opens a local graph on the element's own defaults, not on the global graph's filters", () => {
    const centerId = generateUuidV7();
    const scope = { kind: "neighborhood", centerId, depth: 2 } as const;
    // Filters left on the global graph that would hide a database and its content.
    const preferences = {
      ...DEFAULT_GRAPH_PREFERENCES,
      depth: 3 as const,
      nodeKinds: ["page" as const],
      relationTypes: ["page:link"],
      includeIsolated: true,
    };

    const database = initialGraphControls(scope, "database", preferences);
    expect(database.nodeKinds).toEqual([]);
    expect(database.relationTypes).toEqual([]);
    expect(database.includeIsolated).toBe(false);
    expect(database.edgeLayers).toEqual(["knowledge", "hierarchy"]);
    expect(database.scope).toEqual({ kind: "neighborhood", centerId, depth: 3 });
    // The preset is the default of this view, not an "active filter".
    expect(
      graphControlFilterCount(
        initialGraphControls(scope, "database", { ...preferences, depth: 2 }),
      ),
    ).toBe(0);

    expect(initialGraphControls(scope, "folder", preferences).edgeLayers).toEqual([
      "knowledge",
      "hierarchy",
    ]);
    // A page's children are not its knowledge neighbourhood (spec 010, US2 scenario 6).
    expect(initialGraphControls(scope, "page", preferences).edgeLayers).toEqual(["knowledge"]);

    // The global graph still resumes what the owner left on it.
    const global = initialGraphControls({ kind: "workspace" }, null, preferences);
    expect(global.nodeKinds).toEqual(["page"]);
    expect(global.relationTypes).toEqual(["page:link"]);
    expect(global.includeIsolated).toBe(true);
  });

  it("keys only the kinds and relations drawn on the map", () => {
    const pageId = generateUuidV7();
    const databaseId = generateUuidV7();
    const node = (id: string, kind: "page" | "database") => ({ id, kind });
    const markup = renderToStaticMarkup(
      createElement(GraphLegend, {
        projection: {
          nodes: [node(pageId, "page"), node(databaseId, "database")],
          edges: [{ relationType: "database:property" }],
        } as never,
      }),
    );
    expect(markup).toContain("Légende du graphe");
    expect(markup).toContain(">Page<");
    expect(markup).toContain(">Base de données<");
    expect(markup).not.toContain(">Dossier<");
    expect(markup).toContain('data-relation="database:property"');
    expect(markup).toContain("Propriété reliée");
    expect(markup).not.toContain("Lien interne");
  });
});
