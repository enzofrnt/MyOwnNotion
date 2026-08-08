import {
  CANVAS_STROKE_WIDTHS,
  type CanvasBlockAttributes,
  type CanvasPageCandidate,
  type CanvasStrokeWidth,
  resolveCanvasCardLabel,
  type Uuid,
  validateCanvasBlockAttributes,
} from "@myownnotion/domain";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import {
  addCanvasConnection,
  addCanvasPageCard,
  addCanvasStroke,
  addCanvasTextCard,
  moveCanvasCard,
  removeCanvasCard,
  removeCanvasConnection,
  removeCanvasStroke,
  renameCanvasConnection,
  resizeCanvasCard,
  updateCanvasTextCard,
  updateCanvasViewport,
} from "./canvas-block.ts";
import { CanvasSurface } from "./canvas-surface.tsx";

export interface CanvasNodeViewOptions {
  readonly sourceItemId: Uuid;
  readonly getPageCandidates: () => readonly CanvasPageCandidate[];
  readonly onNavigatePage: (targetItemId: Uuid) => void;
}

export function CanvasNodeView({
  node,
  updateAttributes,
  selected,
  sourceItemId,
  getPageCandidates,
  onNavigatePage,
}: NodeViewProps & CanvasNodeViewOptions) {
  const parsed = validateCanvasBlockAttributes(node.attrs);
  const [textDraft, setTextDraft] = useState("");
  const [pageTargetId, setPageTargetId] = useState("");
  const [sourceCardId, setSourceCardId] = useState("");
  const [targetCardId, setTargetCardId] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<Uuid | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState<CanvasStrokeWidth>(4);
  const inspectorRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedCardId !== null) inspectorRef.current?.focus();
  }, [selectedCardId]);
  if (!parsed.ok) {
    return (
      <NodeViewWrapper className="canvas-block" data-invalid="true">
        <p role="alert">Canvas content is incompatible and was left unchanged.</p>
      </NodeViewWrapper>
    );
  }
  const canvas = parsed.value;
  const candidates = getPageCandidates().filter((candidate) => candidate.id !== sourceItemId);
  const apply = (next: CanvasBlockAttributes) => updateAttributes(next);
  const selectedCard = canvas.cards.find((card) => card.cardId === selectedCardId) ?? null;
  const selectCard = (cardId: Uuid) => {
    const selectionChanged = selectedCardId !== cardId;
    setSelectedCardId(cardId);
    if (selectionChanged) requestAnimationFrame(() => inspectorRef.current?.focus());
  };
  const pan = (x: number, y: number) =>
    apply(updateCanvasViewport(canvas, { x: canvas.viewport.x + x, y: canvas.viewport.y + y }));
  const zoom = (value: number) =>
    apply(updateCanvasViewport(canvas, { zoom: Math.max(0.25, Math.min(4, value)) }));

  return (
    <NodeViewWrapper
      className="canvas-block"
      contentEditable={false}
      data-canvas-id={canvas.canvasId}
      data-selected={selected ? "true" : "false"}
      data-testid="canvas-block"
    >
      <header className="canvas-heading">
        <div>
          <h3>Freeform canvas</h3>
          <output aria-live="polite">
            {canvas.cards.length} cards · {canvas.connections.length} connections ·{" "}
            {canvas.strokes.length} strokes
          </output>
        </div>
        <div className="canvas-viewport-controls" role="toolbar" aria-label="Canvas viewport">
          <button type="button" aria-label="Pan canvas left" onClick={() => pan(80, 0)}>
            ←
          </button>
          <button type="button" aria-label="Pan canvas right" onClick={() => pan(-80, 0)}>
            →
          </button>
          <button type="button" aria-label="Pan canvas up" onClick={() => pan(0, 80)}>
            ↑
          </button>
          <button type="button" aria-label="Pan canvas down" onClick={() => pan(0, -80)}>
            ↓
          </button>
          <button
            type="button"
            aria-label="Zoom canvas out"
            onClick={() => zoom(canvas.viewport.zoom - 0.25)}
          >
            −
          </button>
          <output aria-label="Canvas zoom">{Math.round(canvas.viewport.zoom * 100)}%</output>
          <button
            type="button"
            aria-label="Zoom canvas in"
            onClick={() => zoom(canvas.viewport.zoom + 0.25)}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => apply(updateCanvasViewport(canvas, { x: 0, y: 0, zoom: 1 }))}
          >
            Reset view
          </button>
        </div>
      </header>

      <div className="canvas-create-controls">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = addCanvasTextCard(canvas, textDraft);
            apply(next);
            if (next !== canvas) setTextDraft("");
          }}
        >
          <label>
            New text card
            <input value={textDraft} onChange={(event) => setTextDraft(event.target.value)} />
          </label>
          <button type="submit">Add text card</button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const target = candidates.find((candidate) => candidate.id === pageTargetId);
            if (target === undefined) return;
            const next = addCanvasPageCard(canvas, target.id);
            apply(next);
            if (next !== canvas) setPageTargetId("");
          }}
        >
          <label>
            Workspace page
            <select value={pageTargetId} onChange={(event) => setPageTargetId(event.target.value)}>
              <option value="">Choose a page</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pageTargetId === ""}>
            Add page card
          </button>
        </form>
      </div>

      <div className="canvas-mode-controls">
        <button
          type="button"
          aria-pressed={drawMode}
          onClick={() => setDrawMode((value) => !value)}
        >
          {drawMode ? "Stop drawing" : "Draw"}
        </button>
        <label>
          Stroke width
          <select
            value={strokeWidth}
            onChange={(event) => setStrokeWidth(Number(event.target.value) as CanvasStrokeWidth)}
          >
            {CANVAS_STROKE_WIDTHS.map((width) => (
              <option key={width} value={width}>
                {width === 2 ? "Thin" : width === 4 ? "Medium" : "Thick"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {canvas.cards.length === 0 ? (
        <p className="empty-state">Add a text card or workspace page to start mapping ideas.</p>
      ) : null}
      <CanvasSurface
        canvas={canvas}
        pageCandidates={candidates}
        selectedCardId={selectedCardId}
        drawMode={drawMode}
        strokeWidth={strokeWidth}
        onSelectCard={selectCard}
        onMoveCard={(cardId, x, y) => apply(moveCanvasCard(canvas, cardId, x, y))}
        onCommitStroke={(width, points) => apply(addCanvasStroke(canvas, width, points))}
      />

      <form
        className="canvas-connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          const source = canvas.cards.find((card) => card.cardId === sourceCardId);
          const target = canvas.cards.find((card) => card.cardId === targetCardId);
          if (source === undefined || target === undefined) return;
          const next = addCanvasConnection(canvas, source.cardId, target.cardId, connectionLabel);
          apply(next);
          if (next !== canvas) setConnectionLabel("");
        }}
      >
        <label>
          Connection from
          <select value={sourceCardId} onChange={(event) => setSourceCardId(event.target.value)}>
            <option value="">Choose a card</option>
            {canvas.cards.map((card) => (
              <option key={card.cardId} value={card.cardId}>
                {resolveCanvasCardLabel(card, candidates).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Connection to
          <select value={targetCardId} onChange={(event) => setTargetCardId(event.target.value)}>
            <option value="">Choose a card</option>
            {canvas.cards.map((card) => (
              <option key={card.cardId} value={card.cardId}>
                {resolveCanvasCardLabel(card, candidates).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Connection label
          <input
            value={connectionLabel}
            maxLength={120}
            onChange={(event) => setConnectionLabel(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={sourceCardId === "" || targetCardId === "" || sourceCardId === targetCardId}
        >
          Connect cards
        </button>
      </form>

      <section className="canvas-semantic-lists" aria-label="Canvas objects">
        <div>
          <h4>Connections</h4>
          {canvas.connections.length === 0 ? (
            <p>No connections.</p>
          ) : (
            <ul>
              {canvas.connections.map((connection) => {
                const source = canvas.cards.find((card) => card.cardId === connection.sourceCardId);
                const target = canvas.cards.find((card) => card.cardId === connection.targetCardId);
                return (
                  <li key={connection.connectionId} data-connection-id={connection.connectionId}>
                    <span>
                      {source === undefined
                        ? "Unavailable card"
                        : resolveCanvasCardLabel(source, candidates).label}{" "}
                      →{" "}
                      {target === undefined
                        ? "Unavailable card"
                        : resolveCanvasCardLabel(target, candidates).label}
                    </span>
                    <input
                      aria-label="Connection name"
                      value={connection.label}
                      onChange={(event) =>
                        apply(
                          renameCanvasConnection(
                            canvas,
                            connection.connectionId,
                            event.target.value,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remove connection"
                      onClick={() => apply(removeCanvasConnection(canvas, connection.connectionId))}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h4>Drawings</h4>
          {canvas.strokes.length === 0 ? (
            <p>No strokes.</p>
          ) : (
            <ul>
              {canvas.strokes.map((stroke, index) => (
                <li key={stroke.strokeId} data-stroke-id={stroke.strokeId}>
                  <span>
                    Stroke {index + 1},{" "}
                    {stroke.width === 2 ? "thin" : stroke.width === 4 ? "medium" : "thick"},{" "}
                    {stroke.points.length} points
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove stroke ${index + 1}`}
                    onClick={() => apply(removeCanvasStroke(canvas, stroke.strokeId))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {selectedCard !== null ? (
        <section
          ref={inspectorRef}
          className="canvas-card-inspector"
          tabIndex={-1}
          aria-label="Selected canvas card editor"
        >
          <h4>Selected card</h4>
          {selectedCard.kind === "text" ? (
            <label>
              Card text
              <textarea
                value={selectedCard.text}
                maxLength={4_000}
                onChange={(event) =>
                  apply(updateCanvasTextCard(canvas, selectedCard.cardId, event.target.value))
                }
              />
            </label>
          ) : (
            <>
              <p data-availability={resolveCanvasCardLabel(selectedCard, candidates).availability}>
                {resolveCanvasCardLabel(selectedCard, candidates).label}
              </p>
              <button
                type="button"
                disabled={
                  resolveCanvasCardLabel(selectedCard, candidates).availability === "unavailable"
                }
                onClick={() => onNavigatePage(selectedCard.targetItemId)}
              >
                Open page
              </button>
            </>
          )}
          <div className="canvas-card-geometry">
            <label>
              Card width
              <input
                type="number"
                min={160}
                max={800}
                value={selectedCard.width}
                onChange={(event) =>
                  apply(
                    resizeCanvasCard(
                      canvas,
                      selectedCard.cardId,
                      Number(event.target.value),
                      selectedCard.height,
                    ),
                  )
                }
              />
            </label>
            <label>
              Card height
              <input
                type="number"
                min={96}
                max={600}
                value={selectedCard.height}
                onChange={(event) =>
                  apply(
                    resizeCanvasCard(
                      canvas,
                      selectedCard.cardId,
                      selectedCard.width,
                      Number(event.target.value),
                    ),
                  )
                }
              />
            </label>
          </div>
          <fieldset className="canvas-move-controls">
            <legend className="visually-hidden">Move selected card</legend>
            <button
              type="button"
              aria-label="Move selected card left"
              onClick={() =>
                apply(
                  moveCanvasCard(canvas, selectedCard.cardId, selectedCard.x - 20, selectedCard.y),
                )
              }
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Move selected card right"
              onClick={() =>
                apply(
                  moveCanvasCard(canvas, selectedCard.cardId, selectedCard.x + 20, selectedCard.y),
                )
              }
            >
              →
            </button>
            <button
              type="button"
              aria-label="Move selected card up"
              onClick={() =>
                apply(
                  moveCanvasCard(canvas, selectedCard.cardId, selectedCard.x, selectedCard.y - 20),
                )
              }
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move selected card down"
              onClick={() =>
                apply(
                  moveCanvasCard(canvas, selectedCard.cardId, selectedCard.x, selectedCard.y + 20),
                )
              }
            >
              ↓
            </button>
          </fieldset>
          <button
            type="button"
            onClick={() => {
              apply(removeCanvasCard(canvas, selectedCard.cardId));
              setSelectedCardId(null);
            }}
          >
            Remove card
          </button>
        </section>
      ) : null}
    </NodeViewWrapper>
  );
}
