import { describeRelationType, type GraphProjection, layoutGraph } from "@myownnotion/graph";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";
import { GRAPH_COPY } from "./graph-copy.ts";

function shortLabel(value: string | null): string {
  const label = value?.trim() || GRAPH_COPY.noName;
  return label.length <= 26 ? label : `${label.slice(0, 23)}…`;
}

export function GraphCanvas({
  projection,
  selectedId,
  initialZoom = 1,
  onSelect,
  onClearSelection,
  onZoomChange,
}: {
  readonly projection: GraphProjection;
  readonly selectedId: string | null;
  readonly initialZoom?: number;
  readonly onSelect: (itemId: GraphProjection["nodes"][number]["id"]) => void;
  readonly onClearSelection?: () => void;
  readonly onZoomChange?: (zoom: number) => void;
}) {
  const layout = useMemo(() => layoutGraph(projection), [projection]);
  const positions = useMemo(
    () => new Map(layout.positions.map((position) => [position.id, position])),
    [layout.positions],
  );
  const container = useRef<HTMLElement>(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewWidth = layout.width / zoom;
  const viewHeight = layout.height / zoom;
  const changeZoom = (next: number): void => {
    setZoom(next);
    onZoomChange?.(next);
  };

  const focusDirectional = (
    currentId: GraphProjection["nodes"][number]["id"],
    direction: "ArrowRight" | "ArrowDown" | "ArrowLeft" | "ArrowUp",
  ): void => {
    const current = positions.get(currentId);
    if (current === undefined) return;
    const vertical = direction === "ArrowDown" || direction === "ArrowUp";
    const sign = direction === "ArrowRight" || direction === "ArrowDown" ? 1 : -1;
    const next = projection.nodes
      .flatMap((node) => {
        const position = positions.get(node.id);
        if (position === undefined || node.id === currentId) return [];
        const primary = (vertical ? position.y - current.y : position.x - current.x) * sign;
        if (primary <= 0) return [];
        const secondary = Math.abs(vertical ? position.x - current.x : position.y - current.y);
        return [{ node, score: primary + secondary * 2 }];
      })
      .toSorted(
        (left, right) => left.score - right.score || left.node.id.localeCompare(right.node.id),
      )[0]?.node;
    if (next === undefined) return;
    container.current?.querySelector<SVGGElement>(`[data-graph-node="${next.id}"]`)?.focus();
  };
  const onNodeKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    itemId: GraphProjection["nodes"][number]["id"],
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(itemId);
    } else if (
      event.key === "ArrowRight" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp"
    ) {
      event.preventDefault();
      focusDirectional(itemId, event.key);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(Math.min(2, zoom + 0.25));
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(Math.max(0.5, zoom - 0.25));
    } else if (event.key === "0") {
      event.preventDefault();
      setPan({ x: 0, y: 0 });
      changeZoom(1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClearSelection?.();
      event.currentTarget.focus();
    }
  };

  return (
    <section
      className="knowledge-graph-canvas"
      ref={container}
      data-testid="knowledge-graph-canvas"
      aria-label="Carte du graphe. Utilisez Tab puis les flèches pour parcourir les éléments."
    >
      <div
        className="knowledge-graph-canvas__toolbar"
        role="toolbar"
        aria-label="Point de vue du graphe"
      >
        <Button
          size="square"
          variant="ghost"
          aria-label="Dézoomer"
          onClick={() => changeZoom(Math.max(0.5, zoom - 0.25))}
        >
          <AppIcon name="zoomOut" />
        </Button>
        <output aria-label="Niveau de zoom">{Math.round(zoom * 100)} %</output>
        <Button
          size="square"
          variant="ghost"
          aria-label="Zoomer"
          onClick={() => changeZoom(Math.min(2, zoom + 0.25))}
        >
          <AppIcon name="zoomIn" />
        </Button>
        <Button size="compact" variant="ghost" onClick={() => setPan({ x: 0, y: 0 })}>
          Recentrer
        </Button>
        <Button
          size="compact"
          variant="ghost"
          onClick={() => {
            setPan({ x: 0, y: 0 });
            changeZoom(1);
          }}
        >
          Ajuster
        </Button>
        <Button
          size="square"
          variant="ghost"
          aria-label="Déplacer à gauche"
          onClick={() => setPan((value) => ({ ...value, x: value.x - 80 }))}
        >
          <AppIcon name="arrowLeft" />
        </Button>
        <Button
          size="square"
          variant="ghost"
          aria-label="Déplacer à droite"
          onClick={() => setPan((value) => ({ ...value, x: value.x + 80 }))}
        >
          <AppIcon name="arrowRight" />
        </Button>
        <Button
          size="square"
          variant="ghost"
          aria-label="Déplacer vers le haut"
          onClick={() => setPan((value) => ({ ...value, y: value.y - 80 }))}
        >
          <AppIcon name="arrowUp" />
        </Button>
        <Button
          size="square"
          variant="ghost"
          aria-label="Déplacer vers le bas"
          onClick={() => setPan((value) => ({ ...value, y: value.y + 80 }))}
        >
          <AppIcon name="arrowDown" />
        </Button>
      </div>
      <svg viewBox={`${pan.x} ${pan.y} ${viewWidth} ${viewHeight}`}>
        <title>Carte interactive du graphe de connaissances</title>
        <defs>
          <marker
            id="knowledge-graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <g className="knowledge-graph-canvas__edges">
          {projection.edges.map((edge) => {
            const source = positions.get(edge.sourceId);
            const target = positions.get(edge.targetId);
            if (source === undefined || target === undefined) return null;
            const label = describeRelationType(edge.relationType).label;
            return (
              <g key={edge.key} data-availability={edge.availability}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  markerEnd="url(#knowledge-graph-arrow)"
                />
                <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 8}>
                  {label}
                  {edge.multiplicity > 1 ? ` ×${edge.multiplicity}` : ""}
                </text>
              </g>
            );
          })}
        </g>
        <g className="knowledge-graph-canvas__nodes">
          {projection.nodes.map((node) => {
            const position = positions.get(node.id);
            if (position === undefined) return null;
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG graph nodes cannot contain HTML buttons; keyboard handling and the equivalent list view preserve button semantics.
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={`${node.name || GRAPH_COPY.noName}, ${node.incomingRelationCount} entrantes, ${node.outgoingRelationCount} sortantes`}
                aria-pressed={node.id === selectedId}
                data-graph-node={node.id}
                data-kind={node.kind}
                data-lifecycle={node.lifecycle}
                transform={`translate(${position.x} ${position.y})`}
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => onNodeKeyDown(event, node.id)}
              >
                <circle r={node.id === projection.focusId ? 35 : 29} />
                <text className="knowledge-graph-canvas__icon" y="5">
                  {node.icon || (node.kind === "folder" ? "📁" : "•")}
                </text>
                <text className="knowledge-graph-canvas__label" y="49">
                  {shortLabel(node.name)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </section>
  );
}
