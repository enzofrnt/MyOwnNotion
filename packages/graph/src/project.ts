import { isUuid, type Uuid } from "@myownnotion/domain";
import type {
  AggregatedGraphEdge,
  GraphAvailability,
  GraphCoverage,
  GraphNode,
  GraphProjection,
  GraphQuery,
  GraphRelations,
  GraphScope,
  NormalizedGraphSource,
  RawGraphEdge,
  RawGraphNode,
  StructuredGraphFilter,
} from "./types.ts";

const MIN_NODES = 20;
const MAX_NODES = 200;
const MIN_EDGES = 20;
const MAX_EDGES = 400;

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].toSorted();
}

export function defaultGraphQuery(scope: GraphScope): GraphQuery {
  return {
    scope,
    filters: {
      nodeKinds: [],
      relationTypes: [],
      attachment: "all",
      mediaTypes: [],
      lifecycle: "active",
      structured: [],
      includeIsolated: false,
    },
    limits: { maxNodes: MAX_NODES, maxEdges: MAX_EDGES },
  };
}

export function normalizeGraphQuery(input: GraphQuery): GraphQuery {
  const scope: GraphScope =
    input.scope.kind === "selection"
      ? {
          kind: "selection",
          itemIds: uniqueSorted(input.scope.itemIds.filter(isUuid)).slice(0, MAX_NODES),
        }
      : input.scope.kind === "neighborhood"
        ? {
            ...input.scope,
            depth: Math.max(1, Math.min(3, Math.trunc(input.scope.depth))) as 1 | 2 | 3,
          }
        : input.scope;
  return {
    scope,
    filters: {
      ...input.filters,
      nodeKinds: uniqueSorted(input.filters.nodeKinds),
      relationTypes: uniqueSorted(input.filters.relationTypes),
      mediaTypes: uniqueSorted(input.filters.mediaTypes),
      structured: [...input.filters.structured].toSorted((left, right) =>
        `${left.field}:${left.operator}:${String(left.value)}`.localeCompare(
          `${right.field}:${right.operator}:${String(right.value)}`,
        ),
      ),
    },
    limits: {
      maxNodes: Math.max(MIN_NODES, Math.min(MAX_NODES, Math.trunc(input.limits.maxNodes))),
      maxEdges: Math.max(MIN_EDGES, Math.min(MAX_EDGES, Math.trunc(input.limits.maxEdges))),
    },
  };
}

function availabilityOf(
  edge: Pick<RawGraphEdge, "sourceId" | "targetId">,
  nodes: ReadonlyMap<string, RawGraphNode>,
): GraphAvailability {
  const source = nodes.get(edge.sourceId);
  const target = nodes.get(edge.targetId);
  if (source === undefined || target === undefined) return "unavailable";
  if (source.lifecycle === "trashed" && target.lifecycle === "trashed") return "unavailable";
  if (source.lifecycle === "trashed") return "source-trashed";
  if (target.lifecycle === "trashed") return "target-trashed";
  return "active";
}

function edgeKey(edge: Pick<RawGraphEdge, "sourceId" | "targetId" | "relationType">): string {
  return `${edge.sourceId}\u0000${edge.targetId}\u0000${edge.relationType}`;
}

export function aggregateEdges(
  edges: readonly RawGraphEdge[],
  nodes: ReadonlyMap<string, RawGraphNode>,
): AggregatedGraphEdge[] {
  const groups = new Map<string, RawGraphEdge[]>();
  for (const edge of edges) {
    const list = groups.get(edgeKey(edge)) ?? [];
    list.push(edge);
    groups.set(edgeKey(edge), list);
  }
  return [...groups.entries()]
    .flatMap(([key, occurrences]) => {
      const first = occurrences[0] as RawGraphEdge;
      const occurrenceIds = uniqueSorted(occurrences.map(({ id }) => id));
      const availabilities = occurrences.map((edge) => availabilityOf(edge, nodes));
      const availability = availabilities.every((value) => value === "active")
        ? "active"
        : availabilities.includes("unavailable")
          ? "unavailable"
          : availabilities.includes("source-trashed")
            ? "source-trashed"
            : "target-trashed";
      return [
        {
          key,
          sourceId: first.sourceId,
          targetId: first.targetId,
          relationType: first.relationType,
          occurrenceIds,
          multiplicity: occurrenceIds.length,
          origins: uniqueSorted(occurrences.map(({ origin }) => origin)),
          availability,
        } satisfies AggregatedGraphEdge,
      ];
    })
    .toSorted((left, right) => left.key.localeCompare(right.key));
}

export function relationshipsForNode(
  source: NormalizedGraphSource,
  itemId: Uuid,
  includeTrashed = false,
): GraphRelations {
  const nodes = new Map(source.nodes.map((node) => [node.id, node]));
  const visible = includeTrashed
    ? source.edges
    : source.edges.filter((edge) => availabilityOf(edge, nodes) === "active");
  const aggregated = aggregateEdges(visible, nodes);
  const sort = (left: AggregatedGraphEdge, right: AggregatedGraphEdge): number =>
    left.relationType.localeCompare(right.relationType) || left.key.localeCompare(right.key);
  return {
    backlinks: aggregated.filter(({ targetId }) => targetId === itemId).toSorted(sort),
    outgoing: aggregated.filter(({ sourceId }) => sourceId === itemId).toSorted(sort),
  };
}

function graphAdjacency(edges: readonly RawGraphEdge[]): Map<Uuid, Uuid[]> {
  const result = new Map<Uuid, Set<Uuid>>();
  for (const edge of edges) {
    const source = result.get(edge.sourceId) ?? new Set<Uuid>();
    const target = result.get(edge.targetId) ?? new Set<Uuid>();
    source.add(edge.targetId);
    target.add(edge.sourceId);
    result.set(edge.sourceId, source);
    result.set(edge.targetId, target);
  }
  return new Map(
    [...result.entries()].map(([id, neighbors]) => [id, [...neighbors].toSorted()] as const),
  );
}

function neighborhood(
  start: Uuid,
  maxDepth: number,
  adjacency: ReadonlyMap<Uuid, readonly Uuid[]>,
): Map<Uuid, number> {
  const depths = new Map<Uuid, number>([[start, 0]]);
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: Uuid[] = [];
    for (const current of frontier) {
      for (const candidate of adjacency.get(current) ?? []) {
        if (depths.has(candidate)) continue;
        depths.set(candidate, depth);
        next.push(candidate);
      }
    }
    frontier = next.toSorted();
  }
  return depths;
}

function scopeIdentities(
  source: NormalizedGraphSource,
  scope: GraphScope,
): { ids: Set<Uuid>; depths: Map<Uuid, number>; focusId: Uuid | null } {
  const nodes = new Map(source.nodes.map((node) => [node.id, node]));
  if (scope.kind === "workspace") {
    return { ids: new Set(nodes.keys()), depths: new Map(), focusId: null };
  }
  if (scope.kind === "selection") {
    const ids = new Set(scope.itemIds.filter((id) => nodes.has(id)));
    return { ids, depths: new Map(), focusId: null };
  }
  if (scope.kind === "neighborhood") {
    if (!nodes.has(scope.centerId))
      return { ids: new Set(), depths: new Map(), focusId: scope.centerId };
    const depths = neighborhood(scope.centerId, scope.depth, graphAdjacency(source.edges));
    return { ids: new Set(depths.keys()), depths, focusId: scope.centerId };
  }

  if (!nodes.has(scope.rootId)) return { ids: new Set(), depths: new Map(), focusId: scope.rootId };
  const children = new Map<Uuid, Uuid[]>();
  for (const node of source.nodes) {
    for (const parentId of node.parentIds) {
      const list = children.get(parentId) ?? [];
      list.push(node.id);
      children.set(parentId, list);
    }
  }
  const ids = new Set<Uuid>();
  const depths = new Map<Uuid, number>();
  const queue: Array<{ id: Uuid; depth: number }> = [{ id: scope.rootId, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift() as { id: Uuid; depth: number };
    if (ids.has(current.id)) continue;
    ids.add(current.id);
    depths.set(current.id, current.depth);
    for (const child of (children.get(current.id) ?? []).toSorted()) {
      queue.push({ id: child, depth: current.depth + 1 });
    }
  }
  return { ids, depths, focusId: scope.rootId };
}

function structuredMatch(node: RawGraphNode, filter: StructuredGraphFilter): boolean {
  const candidate = node.structured[filter.field];
  if (candidate === undefined || candidate === null) return false;
  if (filter.operator === "equals") return candidate === filter.value;
  const left = String(candidate);
  const right = String(filter.value);
  if (filter.operator === "contains") return left.includes(right);
  if (filter.operator === "before") return left < right;
  return left > right;
}

function componentCount(ids: ReadonlySet<Uuid>, edges: readonly AggregatedGraphEdge[]): number {
  const adjacency = new Map<Uuid, Uuid[]>();
  for (const edge of edges) {
    adjacency.set(edge.sourceId, [...(adjacency.get(edge.sourceId) ?? []), edge.targetId]);
    adjacency.set(edge.targetId, [...(adjacency.get(edge.targetId) ?? []), edge.sourceId]);
  }
  const remaining = new Set(ids);
  let count = 0;
  while (remaining.size > 0) {
    count += 1;
    const start = remaining.values().next().value as Uuid;
    const stack = [start];
    remaining.delete(start);
    while (stack.length > 0) {
      const current = stack.pop() as Uuid;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!remaining.delete(neighbor)) continue;
        stack.push(neighbor);
      }
    }
  }
  return count;
}

export function projectGraph(
  rawSource: NormalizedGraphSource,
  rawQuery: GraphQuery,
): GraphProjection {
  const query = normalizeGraphQuery(rawQuery);
  const nodesById = new Map(rawSource.nodes.map((node) => [node.id, node]));
  const { ids: scopeIds, depths, focusId } = scopeIdentities(rawSource, query.scope);
  const missingStructuredValues =
    query.filters.structured.length > 0 &&
    [...scopeIds].some((id) =>
      query.filters.structured.some(
        (filter) => nodesById.get(id)?.structured[filter.field] === undefined,
      ),
    );

  let eligibleNodes = rawSource.nodes.filter((node) => {
    if (!scopeIds.has(node.id)) return false;
    if (query.filters.lifecycle === "active" && node.lifecycle !== "active") return false;
    if (query.filters.nodeKinds.length > 0 && !query.filters.nodeKinds.includes(node.kind))
      return false;
    if (
      query.filters.mediaTypes.length > 0 &&
      (node.mediaType === null ||
        !query.filters.mediaTypes.some((mediaType) => node.mediaType?.startsWith(mediaType)))
    ) {
      return false;
    }
    return query.filters.structured.every((filter) => structuredMatch(node, filter));
  });
  let eligibleIds = new Set(eligibleNodes.map(({ id }) => id));
  let eligibleEdges = rawSource.edges.filter((edge) => {
    if (!eligibleIds.has(edge.sourceId) || !eligibleIds.has(edge.targetId)) return false;
    if (
      query.filters.relationTypes.length > 0 &&
      !query.filters.relationTypes.includes(edge.relationType)
    ) {
      return false;
    }
    if (query.filters.attachment === "only" && edge.origin !== "attachment") return false;
    if (query.filters.attachment === "exclude" && edge.origin === "attachment") return false;
    return true;
  });

  let aggregated = aggregateEdges(eligibleEdges, nodesById);
  if (!query.filters.includeIsolated) {
    const connected = new Set<Uuid>();
    for (const edge of aggregated) {
      connected.add(edge.sourceId);
      connected.add(edge.targetId);
    }
    if (focusId !== null && eligibleIds.has(focusId)) connected.add(focusId);
    eligibleNodes = eligibleNodes.filter(({ id }) => connected.has(id));
    eligibleIds = new Set(eligibleNodes.map(({ id }) => id));
    eligibleEdges = eligibleEdges.filter(
      ({ sourceId, targetId }) => eligibleIds.has(sourceId) && eligibleIds.has(targetId),
    );
    aggregated = aggregateEdges(eligibleEdges, nodesById);
  }

  const incoming = new Map<Uuid, { relations: number; occurrences: number }>();
  const outgoing = new Map<Uuid, { relations: number; occurrences: number }>();
  for (const edge of aggregated) {
    const source = outgoing.get(edge.sourceId) ?? { relations: 0, occurrences: 0 };
    const target = incoming.get(edge.targetId) ?? { relations: 0, occurrences: 0 };
    outgoing.set(edge.sourceId, {
      relations: source.relations + 1,
      occurrences: source.occurrences + edge.multiplicity,
    });
    incoming.set(edge.targetId, {
      relations: target.relations + 1,
      occurrences: target.occurrences + edge.multiplicity,
    });
  }

  const enriched: GraphNode[] = eligibleNodes.map((node) => ({
    ...node,
    incomingRelationCount: incoming.get(node.id)?.relations ?? 0,
    outgoingRelationCount: outgoing.get(node.id)?.relations ?? 0,
    incomingOccurrenceCount: incoming.get(node.id)?.occurrences ?? 0,
    outgoingOccurrenceCount: outgoing.get(node.id)?.occurrences ?? 0,
    depth: depths.get(node.id) ?? null,
  }));
  const ordered = enriched.toSorted((left, right) => {
    const leftDepth = left.depth ?? Number.MAX_SAFE_INTEGER;
    const rightDepth = right.depth ?? Number.MAX_SAFE_INTEGER;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
    const leftDegree = left.incomingRelationCount + left.outgoingRelationCount;
    const rightDegree = right.incomingRelationCount + right.outgoingRelationCount;
    return rightDegree - leftDegree || left.id.localeCompare(right.id);
  });
  const visibleNodes = ordered.slice(0, query.limits.maxNodes);
  const visibleIds = new Set(visibleNodes.map(({ id }) => id));
  const renderableEdges = aggregated.filter(
    ({ sourceId, targetId }) => visibleIds.has(sourceId) && visibleIds.has(targetId),
  );
  const visibleEdges = renderableEdges.slice(0, query.limits.maxEdges);
  const isolatedNodeCount = enriched.filter(
    ({ incomingRelationCount, outgoingRelationCount }) =>
      incomingRelationCount === 0 && outgoingRelationCount === 0,
  ).length;
  const coverage: GraphCoverage = missingStructuredValues
    ? {
        state: "partial",
        reason: "missing-local-values",
        cursor: rawSource.coverage.cursor,
      }
    : rawSource.coverage;

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    focusId,
    coverage,
    diagnostics: rawSource.diagnostics,
    summary: {
      candidateNodeCount: enriched.length,
      visibleNodeCount: visibleNodes.length,
      candidateRelationCount: aggregated.length,
      visibleRelationCount: visibleEdges.length,
      occurrenceCount: aggregated.reduce((sum, edge) => sum + edge.multiplicity, 0),
      componentCount: componentCount(new Set(enriched.map(({ id }) => id)), aggregated),
      isolatedNodeCount,
    },
    truncation: {
      truncated:
        visibleNodes.length < enriched.length || visibleEdges.length < renderableEdges.length,
      omittedNodes: Math.max(0, enriched.length - visibleNodes.length),
      omittedEdges: Math.max(0, renderableEdges.length - visibleEdges.length),
    },
  };
}
