import { isUuid } from "@myownnotion/domain";
import { describeRelationType, isGraphRelationType } from "./relations.ts";
import type { NormalizedGraphSource, RawGraphEdge, RawGraphNode, RawGraphSource } from "./types.ts";

function nodeSignature(node: RawGraphNode): string {
  return [
    node.id,
    node.kind,
    node.canonicalKind,
    node.lifecycle,
    node.name ?? "",
    node.icon ?? "",
    node.mediaType ?? "",
    [...node.parentIds].toSorted().join(","),
    JSON.stringify(node.structured),
  ].join("\u0000");
}

function edgeSignature(edge: RawGraphEdge): string {
  return [edge.id, edge.sourceId, edge.targetId, edge.relationType, edge.origin].join("\u0000");
}

/** Deterministic and idempotent admission of canonical graph inputs. */
export function normalizeGraphSource(input: RawGraphSource): NormalizedGraphSource {
  let invalidNodes = 0;
  const byNodeId = new Map<string, RawGraphNode>();
  for (const candidate of [...input.nodes].toSorted((left, right) =>
    nodeSignature(left).localeCompare(nodeSignature(right)),
  )) {
    if (!isUuid(candidate.id)) {
      invalidNodes += 1;
      continue;
    }
    if (candidate.lifecycle === "purged") continue;
    if (!byNodeId.has(candidate.id)) {
      byNodeId.set(candidate.id, {
        ...candidate,
        parentIds: [...new Set(candidate.parentIds.filter(isUuid))].toSorted(),
        structured: { ...candidate.structured },
      });
    }
  }

  let invalidEdges = 0;
  let missingEndpoints = 0;
  let unknownRelationTypes = 0;
  const byEdgeId = new Map<string, RawGraphEdge>();
  for (const candidate of [...input.edges].toSorted((left, right) =>
    edgeSignature(left).localeCompare(edgeSignature(right)),
  )) {
    if (
      candidate.id.length === 0 ||
      candidate.id.length > 256 ||
      !isUuid(candidate.sourceId) ||
      !isUuid(candidate.targetId) ||
      !isGraphRelationType(candidate.relationType)
    ) {
      invalidEdges += 1;
      continue;
    }
    if (!byNodeId.has(candidate.sourceId) || !byNodeId.has(candidate.targetId)) {
      missingEndpoints += 1;
      continue;
    }
    if (byEdgeId.has(candidate.id)) continue;
    const edge = { ...candidate };
    byEdgeId.set(edge.id, edge);
    if (!describeRelationType(edge.relationType).known) unknownRelationTypes += 1;
  }

  return {
    nodes: [...byNodeId.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
    edges: [...byEdgeId.values()].toSorted((left, right) =>
      edgeSignature(left).localeCompare(edgeSignature(right)),
    ),
    coverage: input.coverage,
    diagnostics: { invalidNodes, invalidEdges, missingEndpoints, unknownRelationTypes },
  };
}
