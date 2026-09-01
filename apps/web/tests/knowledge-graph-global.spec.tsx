import { generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultGraphControlState,
  GraphControls,
  graphQueryFromControls,
  resetGraphControlState,
} from "../src/features/knowledge-graph/graph-controls.tsx";

describe("global graph controls", () => {
  it("combines visible filters and resets them in one action", () => {
    const rootId = generateUuidV7();
    const state = createDefaultGraphControlState({ kind: "workspace" });
    state.scope = { kind: "branch", rootId };
    state.nodeKinds = ["page", "file"];
    state.relationTypes = ["page:link"];
    state.structured = [{ field: "status", operator: "equals", value: "En cours" }];
    state.includeIsolated = true;
    const query = graphQueryFromControls(state);
    expect(query).toMatchObject({
      scope: { kind: "branch", rootId },
      filters: {
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
