import {
  createGraphForceRuntime,
  DEFAULT_GRAPH_FORCES,
  type GraphForceRuntime,
  type GraphForceSettings,
  type GraphLayout,
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
  useLayoutEffect,
  useRef,
} from "react";
import { updateDottedCanvasBackground } from "../../ui/dotted-canvas-background.ts";
import {
  GRAPH_LABEL_FONT,
  graphPositionMap,
  graphViewBox,
  paintGraphCamera,
  paintGraphLayout,
  shortGraphLabel,
} from "./graph-canvas-paint.ts";
import { GRAPH_COPY } from "./graph-copy.ts";
import {
  applyWheelZoom,
  clampGraphZoom,
  consumeTrackpadCoast,
  createTrackpadCoastState,
} from "./graph-view-transform.ts";

const NODE_DRAG_THRESHOLD = 4;

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function layoutWorldBox(layout: GraphLayout): {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
} {
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
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, width: layout.width, height: layout.height };
  }
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
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
  // The live layout lives in a ref only. A React state copy re-applied on
  // every render would flash the pre-drag positions whenever a parent render
  // (zoom preference save, selection) races the force tick.
  const layoutRef = useRef<GraphLayout>(createGraphForceRuntime(projection).settle(forces, 36));
  const container = useRef<HTMLElement>(null);
  const dottedBg = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const zoomOutput = useRef<HTMLOutputElement>(null);
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
  const zoomRef = useRef(initialZoom);
  const panRef = useRef({ x: 0, y: 0 });
  const viewportRef = useRef({
    width: layoutRef.current.width,
    height: layoutRef.current.height,
  });
  const hoveredIdRef = useRef<GraphProjection["nodes"][number]["id"] | null>(null);
  const projectionRef = useRef(projection);
  projectionRef.current = projection;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const paint = (): void => {
    const target = svg.current;
    if (target === null) return;
    const current = layoutRef.current;
    const zoom = zoomRef.current;
    paintGraphCamera(
      target,
      zoomOutput.current,
      panRef.current.x,
      panRef.current.y,
      viewportRef.current.width,
      viewportRef.current.height,
      zoom,
    );
    if (dottedBg.current !== null) {
      // World pan → screen translation so dots track the SVG camera.
      updateDottedCanvasBackground(dottedBg.current, {
        zoom,
        translateX: -panRef.current.x * zoom,
        translateY: -panRef.current.y * zoom,
      });
    }
    paintGraphLayout(
      target,
      projectionRef.current,
      graphPositionMap(current),
      selectedIdRef.current,
      hoveredIdRef.current,
      zoom,
    );
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const stepRef = useRef<() => void>(() => undefined);
  stepRef.current = () => {
    const current = runtimeRef.current;
    if (current === null) {
      loopRef.current = 0;
      return;
    }
    layoutRef.current = current.tick(forcesRef.current);
    paintRef.current();
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
  const changeZoom = (next: number): void => {
    const clamped = clampGraphZoom(next);
    zoomRef.current = clamped;
    onZoomChangeRef.current?.(clamped);
    paint();
  };
  const changeZoomRef = useRef(changeZoom);
  changeZoomRef.current = changeZoom;
  const fitView = (): void => {
    const box = layoutWorldBox(layoutRef.current);
    const next = clampGraphZoom(
      Math.min(viewportRef.current.width / box.width, viewportRef.current.height / box.height) *
        0.92,
    );
    panRef.current = {
      x: box.minX - (viewportRef.current.width / next - box.width) / 2,
      y: box.minY - (viewportRef.current.height / next - box.height) / 2,
    };
    changeZoom(next);
  };
  useImperativeHandle(ref, () => ({ fitView }));
  const coastRef = useRef(createTrackpadCoastState());
  useEffect(() => {
    const host = container.current;
    if (host === null) return;
    const target = svg.current ?? host;
    const onWheel = (event: Event): void => {
      if (!(event instanceof WheelEvent)) return;
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
      changeZoomRef.current(next.zoom);
    };
    target.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => target.removeEventListener("wheel", onWheel, { capture: true });
  }, []);
  useEffect(() => {
    const host = container.current;
    if (host === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const width = Math.max(1, entry.contentRect.width);
      const height = Math.max(1, entry.contentRect.height);
      if (width < 32 || height < 32) return;
      const prev = viewportRef.current;
      if (prev.width === width && prev.height === height) return;
      // Keep the world point under the viewport centre stable while the stage
      // resizes (sidebar drag, window chrome). Otherwise pan feels “lost”.
      const zoom = zoomRef.current;
      const centerX = panRef.current.x + prev.width / (2 * zoom);
      const centerY = panRef.current.y + prev.height / (2 * zoom);
      viewportRef.current = { width, height };
      panRef.current = {
        x: centerX - width / (2 * zoom),
        y: centerY - height / (2 * zoom),
      };
      paintRef.current();
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
    if (!topologyChanged && !forcesChanged) {
      // Parent re-rendered with a new projection object of the same topology —
      // do not restart the force loop (that flashes the last settled layout).
      paintRef.current();
      return;
    }
    if (topologyChanged) {
      topologyRef.current = nextKey;
      const created = createGraphForceRuntime(projection);
      runtimeRef.current = created;
      const settled = created.settle(forces, 120);
      layoutRef.current = settled;
      const host = container.current;
      if (host !== null && host.clientWidth >= 64 && host.clientHeight >= 64) {
        const width = host.clientWidth;
        const height = host.clientHeight;
        viewportRef.current = { width, height };
        const box = layoutWorldBox(settled);
        const nextZoom = clampGraphZoom(Math.min(width / box.width, height / box.height) * 0.92);
        zoomRef.current = nextZoom;
        onZoomChangeRef.current?.(nextZoom);
        panRef.current = {
          x: box.minX - (width / nextZoom - box.width) / 2,
          y: box.minY - (height / nextZoom - box.height) / 2,
        };
      }
    }
    if (!topologyChanged && prefersReducedMotion() && forcesChanged) {
      const frozen = runtimeRef.current;
      if (frozen !== null) {
        layoutRef.current = frozen.settle(forces, 120);
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
    } else {
      paintRef.current();
    }
    return () => {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = 0;
    };
  }, [forces, projection]);
  useLayoutEffect(() => {
    paint();
  });
  const setDragging = (value: "pan" | "node" | false): void => {
    const target = svg.current;
    if (target === null) return;
    if (value === false) target.removeAttribute("data-dragging");
    else target.setAttribute("data-dragging", value);
  };
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if ((event.target as Element).closest("[data-graph-node]") !== null) return;
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging("pan");
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const viewWidth = viewportRef.current.width / zoomRef.current;
    const viewHeight = viewportRef.current.height / zoomRef.current;
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
      layoutRef.current = runtimeRef.current?.snapshot() ?? layoutRef.current;
      paint();
      return;
    }
    const start = drag.current;
    if (start === null || start.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    panRef.current = {
      x: start.panX - (event.clientX - start.clientX) * (viewWidth / rect.width),
      y: start.panY - (event.clientY - start.clientY) * (viewHeight / rect.height),
    };
    paint();
  };
  const releasePointerCaptureSafe = (target: Element, pointerId: number): void => {
    try {
      if (target.hasPointerCapture?.(pointerId) === true) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer already released or the element was detached.
    }
  };
  const finishNodeDrag = (pointerId: number): void => {
    const moving = nodeDrag.current;
    if (moving === null || moving.pointerId !== pointerId) return;
    const target = svg.current;
    if (target !== null) releasePointerCaptureSafe(target, pointerId);
    skipNodeClick.current = moving.moved;
    runtimeRef.current?.unpin(moving.id);
    if (runtimeRef.current !== null) runtimeRef.current.alphaTarget = 0;
    nodeDrag.current = null;
    setDragging(false);
    ensureLoop();
  };
  const finishPanDrag = (pointerId: number): void => {
    const start = drag.current;
    if (start === null || start.pointerId !== pointerId) return;
    const target = svg.current;
    if (target !== null) releasePointerCaptureSafe(target, pointerId);
    drag.current = null;
    setDragging(false);
  };
  const finishPointerDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    finishNodeDrag(event.pointerId);
    finishPanDrag(event.pointerId);
  };
  const releaseAllPointerDrags = (): void => {
    const moving = nodeDrag.current;
    if (moving !== null) finishNodeDrag(moving.pointerId);
    const start = drag.current;
    if (start !== null) finishPanDrag(start.pointerId);
  };
  const finishNodeDragRef = useRef(finishNodeDrag);
  finishNodeDragRef.current = finishNodeDrag;
  const finishPanDragRef = useRef(finishPanDrag);
  finishPanDragRef.current = finishPanDrag;
  const releaseAllPointerDragsRef = useRef(releaseAllPointerDrags);
  releaseAllPointerDragsRef.current = releaseAllPointerDrags;
  useEffect(() => {
    const onWindowPointerEnd = (event: PointerEvent): void => {
      finishNodeDragRef.current(event.pointerId);
      finishPanDragRef.current(event.pointerId);
    };
    window.addEventListener("pointerup", onWindowPointerEnd, true);
    window.addEventListener("pointercancel", onWindowPointerEnd, true);
    return () => {
      window.removeEventListener("pointerup", onWindowPointerEnd, true);
      window.removeEventListener("pointercancel", onWindowPointerEnd, true);
      releaseAllPointerDragsRef.current();
    };
  }, []);
  const beginNodeDrag = (
    event: ReactPointerEvent<SVGGElement>,
    itemId: GraphProjection["nodes"][number]["id"],
  ): void => {
    event.stopPropagation();
    const position = graphPositionMap(layoutRef.current).get(itemId);
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
    const positions = graphPositionMap(layoutRef.current);
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
      changeZoom(zoomRef.current + 0.25);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(zoomRef.current - 0.25);
    } else if (event.key === "0") {
      event.preventDefault();
      panRef.current = { x: 0, y: 0 };
      changeZoom(1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClearSelection?.();
      event.currentTarget.focus();
    }
  };

  const hoverNode = (itemId: GraphProjection["nodes"][number]["id"] | null): void => {
    if (hoveredIdRef.current === itemId) return;
    hoveredIdRef.current = itemId;
    paint();
  };
  // Positions are owned by `paintGraphLayout` (layoutRef). Emitting them from
  // React state would flash the last settled layout whenever a parent re-render
  // races the force tick (zoom preference save, selection, sidebar resize).

  return (
    <section
      className="knowledge-graph-canvas"
      ref={container}
      data-testid="knowledge-graph-canvas"
      aria-label="Carte du graphe. Utilisez Tab puis les flèches pour parcourir les éléments."
    >
      <div
        ref={dottedBg}
        className="ui-dotted-canvas-background knowledge-graph-canvas__dots"
        aria-hidden="true"
        data-testid="knowledge-graph-dotted-bg"
      />
      <output ref={zoomOutput} className="ui-visually-hidden" aria-label="Niveau de zoom">
        {Math.round(zoomRef.current * 100)} %
      </output>
      <svg
        ref={svg}
        viewBox={graphViewBox(
          panRef.current.x,
          panRef.current.y,
          viewportRef.current.width,
          viewportRef.current.height,
          zoomRef.current,
        )}
        data-zoom={zoomRef.current < 0.75 ? "overview" : "close"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
      >
        <title>Carte interactive du graphe de connaissances</title>
        <g className="knowledge-graph-canvas__edges">
          {projection.edges.map((edge) => (
            <g
              key={edge.key}
              data-graph-edge={edge.key}
              data-availability={edge.availability}
              data-emphasis="normal"
            >
              <line />
            </g>
          ))}
        </g>
        <g className="knowledge-graph-canvas__nodes">
          {projection.nodes.map((node) => {
            const radius = 8;
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
                data-emphasis="normal"
                onPointerDown={(event) => beginNodeDrag(event, node.id)}
                onClick={(event) => handleNodeClick(event, node.id)}
                onDoubleClick={() => {
                  if (skipNodeClick.current) return;
                  onOpen?.(node.id);
                }}
                onPointerEnter={() => hoverNode(node.id)}
                onPointerOver={() => hoverNode(node.id)}
                onPointerLeave={() => {
                  if (nodeDrag.current?.id === node.id) return;
                  hoverNode(null);
                }}
                onKeyDown={(event) => onNodeKeyDown(event, node.id)}
              >
                <circle className="knowledge-graph-canvas__hit" r={Math.max(radius + 8, 16)} />
                {node.id === selectedId || node.id === projection.focusId ? (
                  <circle className="knowledge-graph-canvas__halo" r={radius + 3} />
                ) : null}
                <circle className="knowledge-graph-canvas__dot" r={radius} />
                <text
                  className="knowledge-graph-canvas__label"
                  y={radius + 13}
                  fontSize={GRAPH_LABEL_FONT}
                  opacity={0}
                >
                  {shortGraphLabel(node.name)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </section>
  );
});
