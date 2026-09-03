import type { AggregatedGraphEdge, GraphNode } from "@myownnotion/graph";
import { describeRelationType } from "@myownnotion/graph";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";
import { GRAPH_COPY, GRAPH_KIND_LABELS } from "./graph-copy.ts";

function RelationGroup({
  edges,
  heading,
  nodes,
  selectedId,
  direction,
  onOpen,
}: {
  readonly edges: readonly AggregatedGraphEdge[];
  readonly heading: string;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly selectedId: string;
  readonly direction: "incoming" | "outgoing";
  readonly onOpen: (node: GraphNode) => void;
}) {
  return (
    <section className="knowledge-graph-inspector__relations">
      <h3>{heading}</h3>
      {edges.length === 0 ? (
        <p>Aucune relation.</p>
      ) : (
        <ul>
          {edges.map((edge) => {
            const otherId = direction === "incoming" ? edge.sourceId : edge.targetId;
            const other = nodes.get(otherId);
            const relation = describeRelationType(edge.relationType);
            return (
              <li key={edge.key}>
                <button
                  type="button"
                  disabled={other === undefined || other.lifecycle !== "active"}
                  onClick={() => other !== undefined && onOpen(other)}
                >
                  <span>{other?.icon ?? (other?.kind === "folder" ? "📁" : "•")}</span>
                  <span className="knowledge-graph-inspector__identity">
                    <strong>{other?.name || GRAPH_COPY.noName}</strong>
                    <small>
                      {relation.label} · {edge.multiplicity}{" "}
                      {edge.multiplicity > 1 ? "occurrences" : "occurrence"}
                      {edge.availability === "active" ? "" : " · Indisponible"}
                    </small>
                  </span>
                </button>
                <span className="sr-only">Relation avec {selectedId}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function GraphInspector({
  node,
  nodes,
  edges,
  onOpen,
  onClose,
}: {
  readonly node: GraphNode;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly AggregatedGraphEdge[];
  readonly onOpen: (node: GraphNode) => void;
  readonly onClose: () => void;
}) {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const backlinks = edges.filter(({ targetId }) => targetId === node.id);
  const outgoing = edges.filter(({ sourceId }) => sourceId === node.id);
  return (
    <aside
      className="knowledge-graph-inspector"
      aria-label={`Relations de ${node.name || GRAPH_COPY.noName}`}
    >
      <header>
        <div>
          <span className="knowledge-graph-inspector__kind">{GRAPH_KIND_LABELS[node.kind]}</span>
          <h2>
            {node.icon ? `${node.icon} ` : ""}
            {node.name || GRAPH_COPY.noName}
          </h2>
          <p>{node.lifecycle === "active" ? "Actif" : "Dans la corbeille"}</p>
        </div>
        <Button size="square" variant="ghost" aria-label="Fermer le détail" onClick={onClose}>
          <AppIcon name="close" />
        </Button>
      </header>
      {node.parentIds.length > 0 ? (
        <p>
          Emplacement{node.parentIds.length > 1 ? "s" : ""} :{" "}
          {node.parentIds
            .map((parentId) => byId.get(parentId)?.name || GRAPH_COPY.noName)
            .join(", ")}
        </p>
      ) : (
        <p>Emplacement : racine du workspace</p>
      )}
      <Button disabled={node.lifecycle !== "active"} onClick={() => onOpen(node)}>
        Ouvrir la page
      </Button>
      <RelationGroup
        edges={backlinks}
        heading={GRAPH_COPY.backlinks}
        nodes={byId}
        selectedId={node.id}
        direction="incoming"
        onOpen={onOpen}
      />
      <RelationGroup
        edges={outgoing}
        heading={GRAPH_COPY.outgoing}
        nodes={byId}
        selectedId={node.id}
        direction="outgoing"
        onOpen={onOpen}
      />
    </aside>
  );
}
