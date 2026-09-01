import { describeRelationType, type GraphProjection } from "@myownnotion/graph";
import { GRAPH_COPY, GRAPH_KIND_LABELS } from "./graph-copy.ts";

export function GraphList({
  projection,
  selectedId,
  onSelect,
}: {
  readonly projection: GraphProjection;
  readonly selectedId: string | null;
  readonly onSelect: (itemId: GraphProjection["nodes"][number]["id"]) => void;
}) {
  const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
  return (
    <ul className="knowledge-graph-list" data-testid="knowledge-graph-list">
      {projection.nodes.map((node) => {
        const incoming = projection.edges.filter(({ targetId }) => targetId === node.id);
        const outgoing = projection.edges.filter(({ sourceId }) => sourceId === node.id);
        return (
          <li
            key={node.id}
            data-graph-node={node.id}
            data-selected={node.id === selectedId || undefined}
          >
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-pressed={node.id === selectedId}
            >
              <span>{node.icon || (node.kind === "folder" ? "📁" : "•")}</span>
              <span className="knowledge-graph-list__identity">
                <strong>{node.name || GRAPH_COPY.noName}</strong>
                <small>
                  {GRAPH_KIND_LABELS[node.kind]} ·{" "}
                  {node.lifecycle === "active" ? "Actif" : "Dans la corbeille"} ·{" "}
                  {node.incomingRelationCount} entrante
                  {node.incomingRelationCount > 1 ? "s" : ""} · {node.outgoingRelationCount}{" "}
                  sortante{node.outgoingRelationCount > 1 ? "s" : ""}
                </small>
              </span>
            </button>
            <details>
              <summary>Voir les relations</summary>
              <ul>
                {incoming.map((edge) => (
                  <li key={`in-${edge.key}`}>
                    ← {nodes.get(edge.sourceId)?.name || GRAPH_COPY.noName} ·{" "}
                    {describeRelationType(edge.relationType).label}
                    {edge.multiplicity > 1 ? ` ×${edge.multiplicity}` : ""}
                    {edge.availability === "active" ? "" : " · Indisponible"}
                  </li>
                ))}
                {outgoing.map((edge) => (
                  <li key={`out-${edge.key}`}>
                    → {nodes.get(edge.targetId)?.name || GRAPH_COPY.noName} ·{" "}
                    {describeRelationType(edge.relationType).label}
                    {edge.multiplicity > 1 ? ` ×${edge.multiplicity}` : ""}
                    {edge.availability === "active" ? "" : " · Indisponible"}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
