import {
  createGraphForceRuntime,
  DEFAULT_GRAPH_FORCES,
  type GraphForceRuntime,
  type GraphForceSettings,
  type GraphProjection,
} from "@myownnotion/graph";
import {
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { GRAPH_COPY } from "./graph-copy.ts";
import {
  applyWheelZoom,
  clampGraphZoom,
  consumeTrackpadCoast,
  createTrackpadCoastState,
} from "./graph-view-transform.ts";

function shortLabel(value: string | null): string {
  const label = value?.trim() || GRAPH_COPY.noName;
  return label.length <= 26 ? label : `${label.slice(0, 23)}…`;
}

/** World-space type size: labels shrink on screen when zoomed out, like Obsidian. */
const LABEL_FONT = 12;

/** Obsidian text-fade at default multiplier 0: ghosted when zoomed out, solid when close. */
function labelAlpha(zoom: number, pinned: boolean): number {
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
  const width = Math.max(24, text.length * LABEL_FONT * 0.58);
  const height = LABEL_FONT * 1.2;
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

function visibleLabelIds(
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
  const fade = labelAlpha(zoom, false);
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
    const text = shortLabel(node.name);
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

function edgeEmphasis(
  highlightedIds: ReadonlySet<string> | null,
  sourceId: string,
  targetId: string,
): "normal" | "active" | "dimmed" {
  if (highlightedIds === null) return "normal";
  return highlightedIds.has(sourceId) && highlightedIds.has(targetId) ? "active" : "dimmed";
}

const NODE_DRAG_THRESHOLD = 4;

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export interface GraphCanvasHandle {
  fitView: () => void;
}

export interface GraphCanvasProps {
  readonly projection: GraphProjection;
  readonly selectedId: string | null;
  readonly initialZoom?: number;
  readonly forces?: GraphForceSettings;
  readonly onSelect: (itemId: GraphProjection["nodes"][number]["id"]) => void;
  readonly onOpen?: (itemId: GraphProjection["nodes"][number]["id"]) => void;
  readonly onClearSelection?: () => void;
  readonly onZoomChange?: (zoom: number) => void;
}

// Babel/Vite parse `forwardRef<Handle, Props>(` as a comparison in this TSX file.
export const GraphCanvas = forwardRef(function GraphCanvas(
  {
    projection,
    selectedId,
    initialZoom = 1,
    forces = DEFAULT_GRAPH_FORCES,
    onSelect,
    onOpen,
    onClearSelection,
    onZoomChange,
  }: GraphCanvasProps,
  ref: ForwardedRef<GraphCanvasHandle>,
) {
  const runtimeRef = useRef<GraphForceRuntime | null>(null);
  const forcesRef = useRef(forces);
  const loopRef = useRef(0);
  forcesRef.current = forces;
  const [layout, setLayout] = useState(() =>
    createGraphForceRuntime(projection).settle(forces, 36),
  );
  const positions = useMemo(
    () => new Map(layout.positions.map((position) => [position.id, position])),
    [layout.positions],
  );
  const container = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly panX: number;
    readonly panY: number;
  } | null>(null);
  const nodeDrag = useRef<{
    pointerId: number;
    id: GraphProjection["nodes"][number]["id"];
    originX: number;
    originY: number;
    clientX: number;
    clientY: number;
    moved: boolean;
  } | null>(null);
  const skipNodeClick = useRef(false);
  const stepRef = useRef<() => void>(() => undefined);
  stepRef.current = () => {
    const current = runtimeRef.current;
    if (current === null) {
      loopRef.current = 0;
      return;
    }
    setLayout(current.tick(forcesRef.current));
    if (current.alpha >= 0.001 || nodeDrag.current !== null || current.alphaTarget > 0) {
      loopRef.current = requestAnimationFrame(() => stepRef.current());
      return;
    }
    loopRef.current = 0;
  };
  const ensureLoop = (): void => {
    if (loopRef.current !== 0 || prefersReducedMotion()) return;
    loopRef.current = requestAnimationFrame(() => stepRef.current());
  };
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;
  const [dragging, setDragging] = useState<"pan" | "node" | false>(false);
  const resolvedPositions = positions;
  const [hoveredId, setHoveredId] = useState<GraphProjection["nodes"][number]["id"] | null>(null);
  const [viewport, setViewport] = useState({ width: layout.width, height: layout.height });
  const viewWidth = viewport.width / zoom;
  const viewHeight = viewport.height / zoom;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const changeZoom = (next: number): void => {
    const clamped = clampGraphZoom(next);
    zoomRef.current = clamped;
    setZoom(clamped);
    onZoomChangeRef.current?.(clamped);
  };
  const changeZoomRef = useRef(changeZoom);
  changeZoomRef.current = changeZoom;
  const highlightedIds = useMemo(() => {
    if (hoveredId === null) return null;
    const highlighted = new Set([hoveredId]);
    for (const edge of projection.edges) {
      if (edge.sourceId === hoveredId) highlighted.add(edge.targetId);
      if (edge.targetId === hoveredId) highlighted.add(edge.sourceId);
    }
    return highlighted;
  }, [hoveredId, projection.edges]);
  const labeledIds = useMemo(
    () =>
      visibleLabelIds(projection, resolvedPositions, selectedId, hoveredId, highlightedIds, zoom),
    [highlightedIds, hoveredId, resolvedPositions, projection, selectedId, zoom],
  );
  const worldBox = useMemo(() => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const position of layout.positions) {
      minX = Math.min(minX, position.x - position.radius);
      minY = Math.min(minY, position.y - position.radius);
      maxX = Math.max(maxX, position.x + position.radius);
      maxY = Math.max(maxY, position.y + position.radius);
    }
    if (!Number.isFinite(minX))
      return { minX: 0, minY: 0, width: layout.width, height: layout.height };
    return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }, [layout.height, layout.positions, layout.width]);
  const fitView = (): void => {
    const next = clampGraphZoom(
      Math.min(viewport.width / worldBox.width, viewport.height / worldBox.height) * 0.92,
    );
    const nextPan = {
      x: worldBox.minX - (viewport.width / next - worldBox.width) / 2,
      y: worldBox.minY - (viewport.height / next - worldBox.height) / 2,
    };
    panRef.current = nextPan;
    setPan(nextPan);
    changeZoom(next);
  };
  useImperativeHandle(ref, () => ({ fitView }));
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const coastRef = useRef(createTrackpadCoastState());
  useEffect(() => {
    const target = svg.current;
    if (target === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (consumeTrackpadCoast(coastRef.current, event, performance.now())) return;
      const rect = target.getBoundingClientRect();
      const fractionX = rect.width <= 0 ? 0.5 : (event.clientX - rect.left) / rect.width;
      const fractionY = rect.height <= 0 ? 0.5 : (event.clientY - rect.top) / rect.height;
      const next = applyWheelZoom({
        panX: panRef.current.x,
        panY: panRef.current.y,
        viewportWidth: viewportRef.current.width,
        viewportHeight: viewportRef.current.height,
        zoom: zoomRef.current,
        fractionX,
        fractionY,
        event,
      });
      if (next === null) return;
      panRef.current = { x: next.panX, y: next.panY };
      setPan(panRef.current);
      changeZoomRef.current(next.zoom);
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
    // Bind after each commit so the listener survives the first layout of the SVG.
  });
  useEffect(() => {
    const host = container.current;
    if (host === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const width = Math.max(1, entry.contentRect.width);
      const height = Math.max(1, entry.contentRect.height);
      if (width < 32 || height < 32) return;
      setViewport((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const topologyRef = useRef("");
  const forcesKeyRef = useRef("");
  useEffect(() => {
    const nextKey = `${projection.nodes.map((node) => node.id).join(",")} ${projection.edges.map((edge) => edge.key).join(",")}`;
    const topologyChanged = topologyRef.current !== nextKey || runtimeRef.current === null;
    const nextForcesKey = `${forces.centerForce}:${forces.repelForce}:${forces.linkForce}:${forces.linkDistance}`;
    const forcesChanged = forcesKeyRef.current !== nextForcesKey;
    forcesKeyRef.current = nextForcesKey;
    if (topologyChanged) {
      topologyRef.current = nextKey;
      const created = createGraphForceRuntime(projection);
      runtimeRef.current = created;
      const settled = created.settle(forces, 120);
      setLayout(settled);
      const host = container.current;
      if (host !== null && host.clientWidth >= 64 && host.clientHeight >= 64) {
        const width = host.clientWidth;
        const height = host.clientHeight;
        setViewport({ width, height });
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const position of settled.positions) {
          minX = Math.min(minX, position.x - position.radius);
          minY = Math.min(minY, position.y - position.radius);
          maxX = Math.max(maxX, position.x + position.radius);
          maxY = Math.max(maxY, position.y + position.radius);
        }
        const boxWidth = Math.max(1, maxX - minX);
        const boxHeight = Math.max(1, maxY - minY);
        const fit = Math.min(width / boxWidth, height / boxHeight) * 0.92;
        const nextZoom = clampGraphZoom(fit);
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
        onZoomChangeRef.current?.(nextZoom);
        const fittedPan = {
          x: minX - (width / nextZoom - boxWidth) / 2,
          y: minY - (height / nextZoom - boxHeight) / 2,
        };
        panRef.current = fittedPan;
        setPan(fittedPan);
      }
    }
    if (!topologyChanged && prefersReducedMotion() && forcesChanged) {
      const frozen = runtimeRef.current;
      if (frozen !== null) {
        setLayout(frozen.settle(forces, 120));
      }
    }
    if (topologyChanged) {
      runtimeRef.current?.reheat(0.12);
    } else if (forcesChanged) {
      runtimeRef.current?.reheat(0.3);
    }
    cancelAnimationFrame(loopRef.current);
    loopRef.current = 0;
    if (!prefersReducedMotion()) {
      loopRef.current = requestAnimationFrame(() => stepRef.current());
    }
    return () => {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = 0;
    };
  }, [forces, projection]);
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if ((event.target as Element).closest("[data-graph-node]") !== null) return;
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging("pan");
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const moving = nodeDrag.current;
    if (moving !== null && moving.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scaleX = viewWidth / rect.width;
      const scaleY = viewHeight / rect.height;
      const x = moving.originX + (event.clientX - moving.clientX) * scaleX;
      const y = moving.originY + (event.clientY - moving.clientY) * scaleY;
      if (
        !moving.moved &&
        Math.hypot(event.clientX - moving.clientX, event.clientY - moving.clientY) >=
          NODE_DRAG_THRESHOLD
      ) {
        moving.moved = true;
      }
      runtimeRef.current?.pin(moving.id, x, y);
      setLayout(runtimeRef.current?.snapshot() ?? layout);
      return;
    }
    const start = drag.current;
    if (start === null || start.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nextPan = {
      x: start.panX - (event.clientX - start.clientX) * (viewWidth / rect.width),
      y: start.panY - (event.clientY - start.clientY) * (viewHeight / rect.height),
    };
    panRef.current = nextPan;
    setPan(nextPan);
  };
  const finishPointerDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const moving = nodeDrag.current;
    if (moving !== null && moving.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      skipNodeClick.current = moving.moved;
      runtimeRef.current?.unpin(moving.id);
      if (runtimeRef.current !== null) runtimeRef.current.alphaTarget = 0;
      nodeDrag.current = null;
      setDragging(false);
      ensureLoop();
      return;
    }
    const start = drag.current;
    if (start === null || start.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drag.current = null;
    setDragging(false);
  };
  const beginNodeDrag = (
    event: ReactPointerEvent<SVGGElement>,
    itemId: GraphProjection["nodes"][number]["id"],
  ): void => {
    event.stopPropagation();
    const position = resolvedPositions.get(itemId);
    if (position === undefined) return;
    nodeDrag.current = {
      pointerId: event.pointerId,
      id: itemId,
      originX: position.x,
      originY: position.y,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
    };
    svg.current?.setPointerCapture?.(event.pointerId);
    runtimeRef.current?.pin(itemId, position.x, position.y);
    if (runtimeRef.current !== null) {
      runtimeRef.current.alphaTarget = 0.3;
      runtimeRef.current.reheat(0.3);
    }
    setDragging("node");
    ensureLoop();
  };
  const handleNodeClick = (
    event: MouseEvent<SVGGElement>,
    itemId: GraphProjection["nodes"][number]["id"],
  ): void => {
    if (skipNodeClick.current) {
      skipNodeClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onSelect(itemId);
  };

  const focusDirectional = (
    currentId: GraphProjection["nodes"][number]["id"],
    direction: "ArrowRight" | "ArrowDown" | "ArrowLeft" | "ArrowUp",
  ): void => {
    const current = resolvedPositions.get(currentId);
    if (current === undefined) return;
    const vertical = direction === "ArrowDown" || direction === "ArrowUp";
    const sign = direction === "ArrowRight" || direction === "ArrowDown" ? 1 : -1;
    const next = projection.nodes
      .flatMap((node) => {
        const position = resolvedPositions.get(node.id);
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
      changeZoom(zoom + 0.25);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(zoom - 0.25);
    } else if (event.key === "0") {
      event.preventDefault();
      panRef.current = { x: 0, y: 0 };
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
      <output className="ui-visually-hidden" aria-label="Niveau de zoom">
        {Math.round(zoom * 100)} %
      </output>
      <svg
        ref={svg}
        viewBox={`${pan.x} ${pan.y} ${viewWidth} ${viewHeight}`}
        data-dragging={dragging}
        data-zoom={zoom < 0.75 ? "overview" : "close"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
      >
        <title>Carte interactive du graphe de connaissances</title>
        <g className="knowledge-graph-canvas__edges">
          {projection.edges.map((edge) => {
            const source = resolvedPositions.get(edge.sourceId);
            const target = resolvedPositions.get(edge.targetId);
            if (source === undefined || target === undefined) return null;
            const emphasis = edgeEmphasis(highlightedIds, edge.sourceId, edge.targetId);
            return (
              <g key={edge.key} data-availability={edge.availability} data-emphasis={emphasis}>
                <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} />
              </g>
            );
          })}
        </g>
        <g className="knowledge-graph-canvas__nodes">
          {projection.nodes.map((node) => {
            const position = resolvedPositions.get(node.id);
            if (position === undefined) return null;
            const radius = position.radius;
            const labelPinned =
              node.id === selectedId ||
              node.id === hoveredId ||
              node.id === projection.focusId ||
              (highlightedIds?.has(node.id) ?? false);
            const opacity = labeledIds.has(node.id) ? labelAlpha(zoom, labelPinned) : 0;
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG graph nodes cannot contain HTML buttons; keyboard handling preserves button semantics.
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={`${node.name || GRAPH_COPY.noName}, ${node.incomingRelationCount} entrantes, ${node.outgoingRelationCount} sortantes`}
                aria-pressed={node.id === selectedId}
                data-graph-node={node.id}
                data-kind={node.kind}
                data-lifecycle={node.lifecycle}
                data-emphasis={
                  highlightedIds === null
                    ? "normal"
                    : highlightedIds.has(node.id)
                      ? "active"
                      : "dimmed"
                }
                transform={`translate(${position.x} ${position.y})`}
                onPointerDown={(event) => beginNodeDrag(event, node.id)}
                onClick={(event) => handleNodeClick(event, node.id)}
                onDoubleClick={() => {
                  if (skipNodeClick.current) return;
                  onOpen?.(node.id);
                }}
                onPointerEnter={() => setHoveredId(node.id)}
                onPointerLeave={() => {
                  if (nodeDrag.current?.id === node.id) return;
                  setHoveredId(null);
                }}
                onKeyDown={(event) => onNodeKeyDown(event, node.id)}
              >
                <circle className="knowledge-graph-canvas__hit" r={Math.max(radius + 8, 16)} />
                {node.id === selectedId || node.id === projection.focusId ? (
                  <circle className="knowledge-graph-canvas__halo" r={radius + 3} />
                ) : null}
                <circle className="knowledge-graph-canvas__dot" r={radius} />
                {opacity > 0 ? (
                  <text
                    className="knowledge-graph-canvas__label"
                    y={radius + (node.id === hoveredId ? 16 : 13)}
                    fontSize={LABEL_FONT}
                    opacity={opacity}
                  >
                    {shortLabel(node.name)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </section>
  );
});
