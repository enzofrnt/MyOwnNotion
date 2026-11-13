import { describeRelationType, type GraphNodeKind, type GraphProjection } from "@myownnotion/graph";
import { GraphEdgeSwatch, GraphNodeSwatch } from "./graph-controls.tsx";
import { GRAPH_KIND_LABELS } from "./graph-copy.ts";

const KIND_ORDER: readonly GraphNodeKind[] = [
  "page",
  "folder",
  "database",
  "database_view",
  "task",
  "file",
];

/**
 * Key to the map: only the element kinds and relation types actually drawn.
 * Each relation keeps its line style next to its colour, so the type never
 * depends on colour alone (spec 010, FR-018).
 */
export function GraphLegend({ projection }: { readonly projection: GraphProjection }) {
  const presentKinds = new Set(projection.nodes.map(({ kind }) => kind));
  const kinds = KIND_ORDER.filter((kind) => presentKinds.has(kind));
  const relations = [...new Set(projection.edges.map(({ relationType }) => relationType))]
    .toSorted()
    .map((type) => ({ type, label: describeRelationType(type).label }));
  if (kinds.length === 0) return null;
  return (
    <ul
      className="knowledge-graph-legend"
      aria-label="Légende du graphe"
      data-testid="graph-legend"
    >
      {kinds.map((kind) => (
        <li key={kind}>
          <GraphNodeSwatch kind={kind} />
          {GRAPH_KIND_LABELS[kind]}
        </li>
      ))}
      {relations.map(({ type, label }) => (
        <li key={type} data-legend="relation">
          <GraphEdgeSwatch relation={type} />
          {label}
        </li>
      ))}
    </ul>
  );
}
