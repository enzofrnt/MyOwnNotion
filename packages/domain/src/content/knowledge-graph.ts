import type { Uuid } from "../ids/uuid.ts";
import type { EndpointAvailability } from "./relationships.ts";

export const WIKI_RELATION_TYPE = "link:references";

export interface KnowledgePage {
  readonly id: Uuid;
  readonly name: string;
  readonly kind: "page" | "folder" | "file";
  readonly lifecycle: "active" | "trashed" | "purged";
}

export interface KnowledgeRelationship {
  readonly id: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: string;
  readonly removedRevisionId?: Uuid | null;
}

export interface KnowledgeLinkSummary {
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly sourceName: string;
  readonly targetName: string;
  readonly sourceAvailability: EndpointAvailability;
  readonly targetAvailability: EndpointAvailability;
  readonly occurrenceCount: number;
}

export interface PageKnowledgeSummary {
  readonly incoming: KnowledgeLinkSummary[];
  readonly outgoing: KnowledgeLinkSummary[];
}

export interface KnowledgeGraphNode {
  readonly id: Uuid;
  readonly label: string;
  readonly availability: EndpointAvailability;
  readonly incomingCount: number;
  readonly outgoingCount: number;
  readonly selected: boolean;
  readonly matchesFilter: boolean;
}

export interface KnowledgeGraphEdge {
  readonly id: string;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly occurrenceCount: number;
}

export interface KnowledgeGraphModel {
  readonly mode: "local" | "global";
  readonly selectedItemId: Uuid | null;
  readonly query: string;
  readonly nodes: KnowledgeGraphNode[];
  readonly edges: KnowledgeGraphEdge[];
}

export interface PositionedKnowledgeGraphNode extends KnowledgeGraphNode {
  readonly x: number;
  readonly y: number;
}

function availability(page: KnowledgePage | undefined): EndpointAvailability {
  if (page === undefined || page.lifecycle === "purged") {
    return "unavailable";
  }
  return page.lifecycle === "trashed" ? "trashed" : "active";
}

function activeWikiRelationships(
  relationships: readonly KnowledgeRelationship[],
): KnowledgeRelationship[] {
  return relationships.filter(
    (relationship) =>
      relationship.relationType === WIKI_RELATION_TYPE && relationship.removedRevisionId == null,
  );
}

function aggregateRelationships(
  relationships: readonly KnowledgeRelationship[],
): KnowledgeGraphEdge[] {
  const counts = new Map<string, KnowledgeGraphEdge>();
  for (const relationship of activeWikiRelationships(relationships)) {
    const id = `${relationship.sourceItemId}→${relationship.targetItemId}`;
    const current = counts.get(id);
    counts.set(id, {
      id,
      sourceItemId: relationship.sourceItemId,
      targetItemId: relationship.targetItemId,
      occurrenceCount: (current?.occurrenceCount ?? 0) + 1,
    });
  }
  return [...counts.values()].sort(
    (left, right) =>
      left.sourceItemId.localeCompare(right.sourceItemId) ||
      left.targetItemId.localeCompare(right.targetItemId),
  );
}

export function summarizePageKnowledge(
  pages: readonly KnowledgePage[],
  relationships: readonly KnowledgeRelationship[],
  pageId: Uuid,
): PageKnowledgeSummary {
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const summaries = aggregateRelationships(relationships).map((edge) => {
    const source = pagesById.get(edge.sourceItemId);
    const target = pagesById.get(edge.targetItemId);
    return {
      sourceItemId: edge.sourceItemId,
      targetItemId: edge.targetItemId,
      sourceName: source?.name ?? "Unavailable page",
      targetName: target?.name ?? "Unavailable page",
      sourceAvailability: availability(source),
      targetAvailability: availability(target),
      occurrenceCount: edge.occurrenceCount,
    };
  });
  const compare = (left: KnowledgeLinkSummary, right: KnowledgeLinkSummary) =>
    left.sourceName.localeCompare(right.sourceName) ||
    left.targetName.localeCompare(right.targetName) ||
    left.sourceItemId.localeCompare(right.sourceItemId) ||
    left.targetItemId.localeCompare(right.targetItemId);
  return {
    incoming: summaries.filter((summary) => summary.targetItemId === pageId).sort(compare),
    outgoing: summaries.filter((summary) => summary.sourceItemId === pageId).sort(compare),
  };
}

export function buildKnowledgeGraph(
  pages: readonly KnowledgePage[],
  relationships: readonly KnowledgeRelationship[],
  options: {
    readonly mode: "local" | "global";
    readonly selectedItemId?: Uuid | null;
    readonly query?: string;
  },
): KnowledgeGraphModel {
  const selectedItemId = options.selectedItemId ?? null;
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const activePages = new Set(
    pages
      .filter((page) => page.kind === "page" && page.lifecycle === "active")
      .map((page) => page.id),
  );
  const activeEdges = aggregateRelationships(relationships).filter(
    (edge) => activePages.has(edge.sourceItemId) && activePages.has(edge.targetItemId),
  );
  const visibleIds = new Set<Uuid>();
  if (options.mode === "local" && selectedItemId !== null && activePages.has(selectedItemId)) {
    visibleIds.add(selectedItemId);
    for (const edge of activeEdges) {
      if (edge.sourceItemId === selectedItemId || edge.targetItemId === selectedItemId) {
        visibleIds.add(edge.sourceItemId);
        visibleIds.add(edge.targetItemId);
      }
    }
  } else if (options.mode === "global") {
    for (const edge of activeEdges) {
      visibleIds.add(edge.sourceItemId);
      visibleIds.add(edge.targetItemId);
    }
  }
  const edges = activeEdges.filter(
    (edge) => visibleIds.has(edge.sourceItemId) && visibleIds.has(edge.targetItemId),
  );
  const normalizedQuery = (options.query ?? "").trim().toLocaleLowerCase();
  const nodes = [...visibleIds]
    .map((id) => {
      const page = pagesById.get(id);
      const incomingCount = edges
        .filter((edge) => edge.targetItemId === id)
        .reduce((sum, edge) => sum + edge.occurrenceCount, 0);
      const outgoingCount = edges
        .filter((edge) => edge.sourceItemId === id)
        .reduce((sum, edge) => sum + edge.occurrenceCount, 0);
      const label = page?.name ?? "Unavailable page";
      return {
        id,
        label,
        availability: availability(page),
        incomingCount,
        outgoingCount,
        selected: id === selectedItemId,
        matchesFilter:
          normalizedQuery.length === 0 || label.toLocaleLowerCase().includes(normalizedQuery),
      };
    })
    .sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    );
  return {
    mode: options.mode,
    selectedItemId,
    query: options.query ?? "",
    nodes,
    edges,
  };
}

export function layoutKnowledgeGraph(
  graph: KnowledgeGraphModel,
  width = 800,
  height = 480,
): PositionedKnowledgeGraphNode[] {
  if (graph.nodes.length === 0) {
    return [];
  }
  const centerX = width / 2;
  const centerY = height / 2;
  const selected = graph.nodes.find((node) => node.id === graph.selectedItemId);
  const remaining = graph.nodes.filter((node) => node.id !== selected?.id);
  const positioned: PositionedKnowledgeGraphNode[] = [];
  if (graph.mode === "local" && selected !== undefined) {
    positioned.push({ ...selected, x: centerX, y: centerY });
  }
  const nodes = graph.mode === "local" && selected !== undefined ? remaining : graph.nodes;
  const perRing = 20;
  nodes.forEach((node, index) => {
    const ring = Math.floor(index / perRing);
    const ringStart = ring * perRing;
    const ringCount = Math.min(perRing, nodes.length - ringStart);
    const angle = (2 * Math.PI * (index - ringStart)) / Math.max(1, ringCount) - Math.PI / 2;
    const maxRadius = Math.max(40, Math.min(width, height) / 2 - 48);
    const radius = Math.min(maxRadius, 110 + ring * 70);
    positioned.push({
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });
  return positioned;
}
