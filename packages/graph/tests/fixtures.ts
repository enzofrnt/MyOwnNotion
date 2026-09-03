import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type { GraphCoverage, RawGraphEdge, RawGraphNode, RawGraphSource } from "../src/index.ts";

export function node(name: string, overrides: Partial<RawGraphNode> = {}): RawGraphNode {
  return {
    id: generateUuidV7(),
    canonicalKind: "page",
    kind: "page",
    lifecycle: "active",
    name,
    icon: null,
    mediaType: null,
    parentIds: [],
    structured: {},
    ...overrides,
  };
}

export function edge(
  sourceId: Uuid,
  targetId: Uuid,
  overrides: Partial<RawGraphEdge> = {},
): RawGraphEdge {
  return {
    id: generateUuidV7(),
    sourceId,
    targetId,
    relationType: "page:link",
    origin: "relationship",
    ...overrides,
  };
}

export function source(
  nodes: readonly RawGraphNode[],
  edges: readonly RawGraphEdge[],
  coverage: GraphCoverage = { state: "complete", cursor: "42" },
): RawGraphSource {
  return { nodes, edges, coverage };
}
