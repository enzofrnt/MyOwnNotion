import { type KnowledgeGraphModel, layoutKnowledgeGraph, type Uuid } from "@myownnotion/domain";
import { useEffect, useMemo, useState } from "react";

export function KnowledgeGraph({
  graph,
  onNavigate,
}: {
  readonly graph: KnowledgeGraphModel;
  readonly onNavigate: (itemId: Uuid) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<Uuid | null>(graph.selectedItemId);
  useEffect(() => setSelectedNodeId(graph.selectedItemId), [graph.selectedItemId]);
  const positioned = useMemo(() => layoutKnowledgeGraph(graph), [graph]);
  const positions = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;

  if (graph.nodes.length === 0) {
    return (
      <p className="empty-state" data-testid="knowledge-graph-empty">
        No linked pages to graph yet.
      </p>
    );
  }

  return (
    <div className="knowledge-graph" data-testid={`knowledge-graph-${graph.mode}`}>
      <div className="knowledge-graph-viewport">
        <svg
          viewBox="0 0 800 480"
          role="img"
          aria-label={`${graph.mode === "local" ? "Local" : "Global"} knowledge graph with ${graph.nodes.length} pages and ${graph.edges.length} connections`}
        >
          <defs>
            <marker
              id={`knowledge-arrow-${graph.mode}`}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" className="knowledge-graph-arrow" />
            </marker>
          </defs>
          <g>
            {graph.edges.map((edge) => {
              const source = positions.get(edge.sourceItemId);
              const target = positions.get(edge.targetItemId);
              return source === undefined || target === undefined ? null : (
                <line
                  key={edge.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className="knowledge-graph-edge"
                  markerEnd={`url(#knowledge-arrow-${graph.mode})`}
                />
              );
            })}
          </g>
          {positioned.map((node) => (
            <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
              <a
                href={`#page-${node.id}`}
                tabIndex={0}
                aria-label={`${node.label}, ${node.incomingCount} incoming and ${node.outgoingCount} outgoing links`}
                className="knowledge-graph-node"
                data-selected={selectedNodeId === node.id}
                data-match={node.matchesFilter}
                onClick={(event) => {
                  event.preventDefault();
                  setSelectedNodeId(node.id);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  onNavigate(node.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === " ") {
                    event.preventDefault();
                    setSelectedNodeId(node.id);
                  }
                }}
              >
                <circle r={selectedNodeId === node.id ? 24 : 19} />
                <text y="34" textAnchor="middle">
                  {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
                </text>
              </a>
            </g>
          ))}
        </svg>
      </div>

      <div className="knowledge-node-summary" aria-live="polite">
        {selectedNode === null ? (
          <p>Select a page to inspect its connections.</p>
        ) : (
          <p>
            <strong>{selectedNode.label}</strong>: {selectedNode.incomingCount} incoming,{" "}
            {selectedNode.outgoingCount} outgoing.
            <button type="button" onClick={() => onNavigate(selectedNode.id)}>
              Open page
            </button>
          </p>
        )}
      </div>

      <section className="knowledge-graph-list" aria-label="Knowledge graph pages and connections">
        <h3>Accessible graph list</h3>
        <ul>
          {graph.nodes.map((node) => (
            <li className="knowledge-graph-list-item" key={node.id} data-match={node.matchesFilter}>
              <button type="button" onClick={() => onNavigate(node.id)}>
                Open {node.label}
              </button>
              <span>
                {node.incomingCount} incoming, {node.outgoingCount} outgoing
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
