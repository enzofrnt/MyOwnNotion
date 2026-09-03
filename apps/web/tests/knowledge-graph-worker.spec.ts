import { generateUuidV7 } from "@myownnotion/domain";
import { defaultGraphQuery, type RawGraphSource } from "@myownnotion/graph";
import { describe, expect, it } from "vitest";
import { runKnowledgeGraphProjection } from "../src/features/knowledge-graph/knowledge-graph.worker.ts";

describe("knowledge graph worker", () => {
  it("normalizes and projects a graph without retaining a second canonical store", () => {
    const sourceId = generateUuidV7();
    const targetId = generateUuidV7();
    const node = (id: typeof sourceId, name: string) => ({
      id,
      canonicalKind: "page" as const,
      kind: "page" as const,
      lifecycle: "active" as const,
      name,
      icon: null,
      mediaType: null,
      parentIds: [],
      structured: {},
    });
    const source: RawGraphSource = {
      nodes: [node(sourceId, "Source"), node(targetId, "Cible")],
      edges: [
        {
          id: generateUuidV7(),
          sourceId,
          targetId,
          relationType: "page:link",
          origin: "relationship",
        },
      ],
      coverage: { state: "complete", cursor: "42" },
    };
    const result = runKnowledgeGraphProjection({
      source,
      query: defaultGraphQuery({ kind: "workspace" }),
    });
    expect(result.projection.nodes).toHaveLength(2);
    expect(result.projection.edges).toHaveLength(1);
    expect(result.source.coverage).toEqual(source.coverage);
  });
});
