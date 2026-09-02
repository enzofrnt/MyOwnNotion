import type { GraphLayout, GraphLayoutPosition, GraphProjection } from "@myownnotion/graph";
import { GRAPH_COPY } from "./graph-copy.ts";

/** World-space type size: labels shrink on screen when zoomed out, like Obsidian. */
export const GRAPH_LABEL_FONT = 12;

export function shortGraphLabel(value: string | null): string {
  const label = value?.trim() || GRAPH_COPY.noName;
  return label.length <= 26 ? label : `${label.slice(0, 23)}…`;
}

/** Obsidian text-fade at default multiplier 0: ghosted when zoomed out, solid when close. */
export function graphLabelAlpha(zoom: number, pinned: boolean): number {
  if (pinned) return 1;
  return Math.min(1, Math.max(0, (zoom - 0.55) / 0.5));
}

interface LabelBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function labelBox(x: number, y: number, radius: number, text: string): LabelBox {
  const width = Math.max(24, text.length * GRAPH_LABEL_FONT * 0.58);
  const height = GRAPH_LABEL_FONT * 1.2;
  const top = y + radius + 4;
  return {
    left: x - width / 2,
    right: x + width / 2,
    top,
    bottom: top + height,
  };
}

function boxesOverlap(left: LabelBox, right: LabelBox, pad: number): boolean {
  return (
    left.left < right.right + pad &&
    left.right + pad > right.left &&
    left.top < right.bottom + pad &&
    left.bottom + pad > right.top
  );
}

export function graphPositionMap(layout: GraphLayout): ReadonlyMap<string, GraphLayoutPosition> {
  return new Map(layout.positions.map((position) => [position.id, position]));
}

export function visibleGraphLabelIds(
  projection: GraphProjection,
  positions: ReadonlyMap<
    string,
    { readonly x: number; readonly y: number; readonly radius: number }
  >,
  selectedId: string | null,
  hoveredId: string | null,
  highlightedIds: ReadonlySet<string> | null,
  zoom: number,
): ReadonlySet<string> {
  const pinned = new Set<string>();
  if (selectedId !== null) pinned.add(selectedId);
  if (hoveredId !== null) pinned.add(hoveredId);
  if (projection.focusId !== null) pinned.add(projection.focusId);
  if (highlightedIds !== null) {
    for (const id of highlightedIds) pinned.add(id);
  }
  const fade = graphLabelAlpha(zoom, false);
  const ranked = [...projection.nodes].toSorted((left, right) => {
    const pin = Number(pinned.has(right.id)) - Number(pinned.has(left.id));
    if (pin !== 0) return pin;
    return (
      right.incomingOccurrenceCount - left.incomingOccurrenceCount ||
      left.id.localeCompare(right.id)
    );
  });
  const occupied: LabelBox[] = [];
  const visible = new Set<string>();
  const pad = fade < 0.45 ? 4 : 14;
  const maxUnpinned = fade < 0.12 ? 0 : zoom < 0.85 ? 12 : zoom < 1.2 ? 22 : 40;
  let unpinned = 0;
  for (const node of ranked) {
    const position = positions.get(node.id);
    if (position === undefined) continue;
    const radius = position.radius;
    const text = shortGraphLabel(node.name);
    const box = labelBox(position.x, position.y, radius, text);
    const mustShow = pinned.has(node.id);
    if (!mustShow) {
      if (unpinned >= maxUnpinned) continue;
      if (occupied.some((taken) => boxesOverlap(taken, box, pad))) continue;
      unpinned += 1;
    }
    occupied.push(box);
    visible.add(node.id);
  }
  return visible;
}

export function graphEdgeEmphasis(
  highlightedIds: ReadonlySet<string> | null,
  sourceId: string,
  targetId: string,
): "normal" | "active" | "dimmed" {
  if (highlightedIds === null) return "normal";
  return highlightedIds.has(sourceId) && highlightedIds.has(targetId) ? "active" : "dimmed";
}

export function graphNeighborhood(
  projection: GraphProjection,
  hoveredId: string | null,
): ReadonlySet<string> | null {
  if (hoveredId === null) return null;
  const highlighted = new Set([hoveredId]);
  for (const edge of projection.edges) {
    if (edge.sourceId === hoveredId) highlighted.add(edge.targetId);
    if (edge.targetId === hoveredId) highlighted.add(edge.sourceId);
  }
  return highlighted;
}

export function graphViewBox(
  panX: number,
  panY: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): string {
  return `${panX} ${panY} ${viewportWidth / zoom} ${viewportHeight / zoom}`;
}

export function paintGraphCamera(
  svg: SVGSVGElement,
  zoomOutput: HTMLElement | null,
  panX: number,
  panY: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): void {
  svg.setAttribute("viewBox", graphViewBox(panX, panY, viewportWidth, viewportHeight, zoom));
  svg.setAttribute("data-zoom", zoom < 0.75 ? "overview" : "close");
  if (zoomOutput !== null) zoomOutput.textContent = `${Math.round(zoom * 100)} %`;
}

export function paintGraphLayout(
  svg: SVGSVGElement,
  projection: GraphProjection,
  positions: ReadonlyMap<
    string,
    { readonly x: number; readonly y: number; readonly radius: number }
  >,
  selectedId: string | null,
  hoveredId: string | null,
  zoom: number,
): void {
  const highlightedIds = graphNeighborhood(projection, hoveredId);
  const labeledIds = visibleGraphLabelIds(
    projection,
    positions,
    selectedId,
    hoveredId,
    highlightedIds,
    zoom,
  );
  const edgesByKey = new Map(projection.edges.map((edge) => [edge.key, edge]));
  for (const group of svg.querySelectorAll<SVGGElement>("[data-graph-edge]")) {
    const key = group.dataset["graphEdge"];
    const edge = key === undefined ? undefined : edgesByKey.get(key);
    const line = group.querySelector("line");
    if (edge === undefined || line === null) continue;
    const source = positions.get(edge.sourceId);
    const target = positions.get(edge.targetId);
    if (source === undefined || target === undefined) continue;
    line.setAttribute("x1", String(source.x));
    line.setAttribute("y1", String(source.y));
    line.setAttribute("x2", String(target.x));
    line.setAttribute("y2", String(target.y));
    group.setAttribute(
      "data-emphasis",
      graphEdgeEmphasis(highlightedIds, edge.sourceId, edge.targetId),
    );
  }
  for (const group of svg.querySelectorAll<SVGGElement>("[data-graph-node]")) {
    const nodeId = group.dataset["graphNode"];
    if (nodeId === undefined) continue;
    const position = positions.get(nodeId);
    if (position === undefined) continue;
    group.setAttribute("transform", `translate(${position.x} ${position.y})`);
    group.setAttribute(
      "data-emphasis",
      highlightedIds === null ? "normal" : highlightedIds.has(nodeId) ? "active" : "dimmed",
    );
    const label = group.querySelector("text");
    if (label === null) continue;
    const labelPinned =
      nodeId === selectedId ||
      nodeId === hoveredId ||
      nodeId === projection.focusId ||
      (highlightedIds?.has(nodeId) ?? false);
    const opacity = labeledIds.has(nodeId) ? graphLabelAlpha(zoom, labelPinned) : 0;
    label.setAttribute("opacity", String(opacity));
    label.setAttribute("y", String(position.radius + (nodeId === hoveredId ? 16 : 13)));
  }
}
