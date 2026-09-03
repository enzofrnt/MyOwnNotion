import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  defaultGraphQuery,
  describeRelationType,
  normalizeGraphQuery,
  normalizeGraphSource,
} from "../src/index.ts";
import { edge, node, source } from "./fixtures.ts";

describe("knowledge graph contracts", () => {
  it("uses French presentation for known and forward-compatible relation types", () => {
    expect(describeRelationType("page:link")).toMatchObject({ known: true, label: "Lien interne" });
    expect(describeRelationType("future:meaning")).toMatchObject({
      known: false,
      label: "Relation non reconnue",
    });
  });

  it("quarantines malformed relationships without exposing their payload", () => {
    const first = node("Premier");
    const second = node("Second");
    const normalized = normalizeGraphSource(
      source(
        [first, second],
        [
          edge(first.id, second.id),
          edge(first.id, second.id, { relationType: "private title without namespace" }),
          edge(first.id, generateUuidV7()),
        ],
      ),
    );

    expect(normalized.edges).toHaveLength(1);
    expect(normalized.diagnostics).toEqual({
      invalidEdges: 1,
      invalidNodes: 0,
      missingEndpoints: 1,
      unknownRelationTypes: 0,
    });
    expect(JSON.stringify(normalized.diagnostics)).not.toContain("private title");
  });

  it("bounds depth, selection and rendering limits", () => {
    const ids = Array.from({ length: 250 }, () => generateUuidV7());
    const query = normalizeGraphQuery({
      scope: { kind: "selection", itemIds: ids },
      filters: {
        edgeLayers: ["attachment", "knowledge", "knowledge"],
        nodeKinds: [],
        relationTypes: [],
        mediaTypes: [],
        lifecycle: "active",
        structured: [],
        includeIsolated: true,
      },
      limits: { maxNodes: 10_000, maxEdges: 10_000 },
    });
    expect(query.scope.kind).toBe("selection");
    if (query.scope.kind === "selection") expect(query.scope.itemIds).toHaveLength(200);
    expect(query.filters.edgeLayers).toEqual(["attachment", "knowledge"]);
    expect(query.limits).toEqual({ maxNodes: 200, maxEdges: 400 });
  });

  it("starts from knowledge relationships without structural placements", () => {
    expect(defaultGraphQuery({ kind: "workspace" }).filters.edgeLayers).toEqual(["knowledge"]);
  });
});
