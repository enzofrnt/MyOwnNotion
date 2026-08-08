import {
  type CanvasBlockAttributes,
  type CanvasCard,
  type CanvasPageCandidate,
  type CanvasPoint,
  type CanvasStrokeWidth,
  projectCanvasConnections,
  resolveCanvasCardLabel,
  screenPointToCanvas,
  type Uuid,
} from "@myownnotion/domain";
import { useRef, useState } from "react";

interface DragState {
  readonly cardId: Uuid;
  readonly clientX: number;
  readonly clientY: number;
  readonly x: number;
  readonly y: number;
}

export function CanvasSurface({
  canvas,
  pageCandidates,
  selectedCardId,
  drawMode,
  strokeWidth,
  onSelectCard,
  onMoveCard,
  onCommitStroke,
}: {
  readonly canvas: CanvasBlockAttributes;
  readonly pageCandidates: readonly CanvasPageCandidate[];
  readonly selectedCardId: Uuid | null;
  readonly drawMode: boolean;
  readonly strokeWidth: CanvasStrokeWidth;
  readonly onSelectCard: (cardId: Uuid) => void;
  readonly onMoveCard: (cardId: Uuid, x: number, y: number) => void;
  readonly onCommitStroke: (width: CanvasStrokeWidth, points: readonly CanvasPoint[]) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const drawRef = useRef<CanvasPoint[] | null>(null);
  const [draftStroke, setDraftStroke] = useState<readonly CanvasPoint[]>([]);
  const connections = projectCanvasConnections(canvas);

  const relativePoint = (clientX: number, clientY: number): CanvasPoint | null => {
    const rectangle = surfaceRef.current?.getBoundingClientRect();
    if (rectangle === undefined) return null;
    return screenPointToCanvas(
      { x: clientX - rectangle.left, y: clientY - rectangle.top },
      canvas.viewport,
    );
  };

  const startDraw = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = relativePoint(event.clientX, event.clientY);
    if (point === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawRef.current = [point];
    setDraftStroke([point]);
  };

  const appendDrawPoint = (clientX: number, clientY: number) => {
    const current = drawRef.current;
    if (current === null || current.length >= 1_000) return;
    const point = relativePoint(clientX, clientY);
    const previous = current.at(-1);
    if (
      point === null ||
      (previous !== undefined && Math.hypot(point.x - previous.x, point.y - previous.y) < 2)
    ) {
      return;
    }
    const next = [...current, point];
    drawRef.current = next;
    setDraftStroke(next);
  };

  const continueDraw = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drawRef.current !== null) {
      event.preventDefault();
      event.stopPropagation();
    }
    appendDrawPoint(event.clientX, event.clientY);
  };

  const commitDraw = () => {
    const points = drawRef.current;
    drawRef.current = null;
    setDraftStroke([]);
    if (points !== null && points.length >= 2) onCommitStroke(strokeWidth, points);
  };

  const finishDraw = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drawRef.current !== null) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commitDraw();
  };

  const startMouseDraw = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!drawMode || event.button !== 0 || drawRef.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const point = relativePoint(event.clientX, event.clientY);
    if (point === null) return;
    drawRef.current = [point];
    setDraftStroke([point]);
  };

  const cardPointerDown = (event: React.PointerEvent<HTMLButtonElement>, card: CanvasCard) => {
    event.stopPropagation();
    onSelectCard(card.cardId);
    if (drawMode || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      cardId: card.cardId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: card.x,
      y: card.y,
    };
  };

  const cardPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.cardId !== event.currentTarget.dataset["cardId"]) return;
    onMoveCard(
      drag.cardId,
      drag.x + (event.clientX - drag.clientX) / canvas.viewport.zoom,
      drag.y + (event.clientY - drag.clientY) / canvas.viewport.zoom,
    );
  };

  const finishCardDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={surfaceRef}
      className="canvas-surface"
      data-draw-mode={drawMode ? "true" : "false"}
      role="application"
      aria-label="Freeform canvas surface"
      onPointerDown={startDraw}
      onPointerMove={continueDraw}
      onPointerUp={finishDraw}
      onPointerCancel={finishDraw}
      onLostPointerCapture={commitDraw}
      onMouseDown={startMouseDraw}
      onMouseMove={(event) => appendDrawPoint(event.clientX, event.clientY)}
      onMouseUp={commitDraw}
    >
      <div
        className="canvas-origin"
        aria-hidden="true"
        style={{ left: canvas.viewport.x, top: canvas.viewport.y }}
      />
      <div
        className="canvas-world"
        style={{
          transform: `translate(${canvas.viewport.x}px, ${canvas.viewport.y}px) scale(${canvas.viewport.zoom})`,
        }}
      >
        <svg className="canvas-vector-layer" aria-hidden="true">
          <defs>
            <marker
              id={`canvas-arrow-${canvas.canvasId}`}
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
          {connections.map((connection) => (
            <line
              key={connection.connectionId}
              x1={connection.source.x}
              y1={connection.source.y}
              x2={connection.target.x}
              y2={connection.target.y}
              markerEnd={`url(#canvas-arrow-${canvas.canvasId})`}
            />
          ))}
          {canvas.strokes.map((stroke) => (
            <polyline
              key={stroke.strokeId}
              points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
              strokeWidth={stroke.width}
            />
          ))}
          {draftStroke.length >= 2 ? (
            <polyline
              data-testid="canvas-draft-stroke"
              points={draftStroke.map((point) => `${point.x},${point.y}`).join(" ")}
              strokeWidth={strokeWidth}
            />
          ) : null}
        </svg>
        {canvas.cards.map((card) => {
          const resolved = resolveCanvasCardLabel(card, pageCandidates);
          return (
            <button
              type="button"
              key={card.cardId}
              className="canvas-card"
              data-card-id={card.cardId}
              data-card-kind={card.kind}
              data-availability={resolved.availability}
              aria-pressed={selectedCardId === card.cardId}
              aria-label={`${card.kind === "page" ? "Page" : "Text"} card: ${resolved.label}`}
              style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
              onPointerDown={(event) => cardPointerDown(event, card)}
              onPointerMove={cardPointerMove}
              onPointerUp={finishCardDrag}
              onPointerCancel={finishCardDrag}
              onLostPointerCapture={finishCardDrag}
              onClick={() => onSelectCard(card.cardId)}
            >
              <span className="canvas-card-kind">{card.kind === "page" ? "Page" : "Note"}</span>
              <span>{resolved.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
