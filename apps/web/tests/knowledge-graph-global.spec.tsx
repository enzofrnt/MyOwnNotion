import { generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
