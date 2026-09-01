import type { Uuid } from "@myownnotion/domain";

export type CanonicalGraphItemKind = "page" | "folder" | "file";
export type GraphNodeKind = CanonicalGraphItemKind | "database" | "task";
export type GraphLifecycle = "active" | "trashed" | "purged";
export type GraphEdgeOrigin = "relationship" | "hierarchy" | "attachment";
export type GraphAvailability = "active" | "source-trashed" | "target-trashed" | "unavailable";

export type GraphCoverage =
  | { readonly state: "complete"; readonly cursor: string }
  | {
      readonly state: "partial";
      readonly reason: "initial-sync" | "missing-local-values" | "projection-error";
      readonly cursor: string | null;
    };

export interface RawGraphNode {
  readonly id: Uuid;
  readonly canonicalKind: CanonicalGraphItemKind;
  readonly kind: GraphNodeKind;
  readonly lifecycle: GraphLifecycle;
  readonly name: string | null;
  readonly icon: string | null;
  readonly mediaType: string | null;
  readonly parentIds: readonly Uuid[];
  readonly structured: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RawGraphEdge {
  readonly id: string;
  readonly sourceId: Uuid;
  readonly targetId: Uuid;
  readonly relationType: string;
  readonly origin: GraphEdgeOrigin;
}

export interface RawGraphSource {
  readonly nodes: readonly RawGraphNode[];
  readonly edges: readonly RawGraphEdge[];
  readonly coverage: GraphCoverage;
}

export interface GraphDiagnostics {
  readonly invalidNodes: number;
  readonly invalidEdges: number;
  readonly missingEndpoints: number;
  readonly unknownRelationTypes: number;
}

export interface NormalizedGraphSource {
  readonly nodes: readonly RawGraphNode[];
  readonly edges: readonly RawGraphEdge[];
  readonly coverage: GraphCoverage;
  readonly diagnostics: GraphDiagnostics;
}

export type GraphScope =
  | { readonly kind: "workspace" }
  | { readonly kind: "branch"; readonly rootId: Uuid }
  | {
      readonly kind: "neighborhood";
      readonly centerId: Uuid;
      readonly depth: 1 | 2 | 3;
    }
  | { readonly kind: "selection"; readonly itemIds: readonly Uuid[] };

export interface StructuredGraphFilter {
  readonly field: string;
  readonly operator: "equals" | "contains" | "before" | "after";
  readonly value: string | number | boolean;
}

export interface GraphFilters {
  nodeKinds: GraphNodeKind[];
  relationTypes: string[];
  attachment: "all" | "only" | "exclude";
  mediaTypes: string[];
  lifecycle: "active" | "including-trashed";
  structured: StructuredGraphFilter[];
  includeIsolated: boolean;
}

export interface GraphQuery {
  scope: GraphScope;
  filters: GraphFilters;
  limits: { maxNodes: number; maxEdges: number };
}

export interface AggregatedGraphEdge {
  readonly key: string;
  readonly sourceId: Uuid;
  readonly targetId: Uuid;
  readonly relationType: string;
  readonly occurrenceIds: readonly string[];
  readonly multiplicity: number;
  readonly origins: readonly GraphEdgeOrigin[];
  readonly availability: GraphAvailability;
}

export interface GraphNode extends RawGraphNode {
  readonly incomingRelationCount: number;
  readonly outgoingRelationCount: number;
  readonly incomingOccurrenceCount: number;
  readonly outgoingOccurrenceCount: number;
  readonly depth: number | null;
}

export interface GraphProjectionSummary {
  readonly candidateNodeCount: number;
  readonly visibleNodeCount: number;
  readonly candidateRelationCount: number;
  readonly visibleRelationCount: number;
  readonly occurrenceCount: number;
  readonly componentCount: number;
  readonly isolatedNodeCount: number;
}

export interface GraphProjection {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly AggregatedGraphEdge[];
  readonly focusId: Uuid | null;
  readonly coverage: GraphCoverage;
  readonly diagnostics: GraphDiagnostics;
  readonly summary: GraphProjectionSummary;
  readonly truncation: {
    readonly truncated: boolean;
    readonly omittedNodes: number;
    readonly omittedEdges: number;
  };
}

export interface GraphRelations {
  readonly backlinks: readonly AggregatedGraphEdge[];
  readonly outgoing: readonly AggregatedGraphEdge[];
}

export interface GraphLayoutPosition {
  readonly id: Uuid;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly component: number;
}

export interface GraphLayout {
  readonly width: number;
  readonly height: number;
  readonly positions: readonly GraphLayoutPosition[];
}
