import {
  type CanvasBlockAttributes,
  type CanvasPoint,
  type CanvasStrokeWidth,
  generateUuidV7,
  isUuid,
  type Uuid,
  validateCanvasBlockAttributes,
} from "@myownnotion/domain";

export type CanvasIdFactory = () => Uuid;

function validated(
  candidate: CanvasBlockAttributes,
  fallback: CanvasBlockAttributes,
): CanvasBlockAttributes {
  const result = validateCanvasBlockAttributes(candidate);
  return result.ok ? result.value : fallback;
}

function defaultPosition(canvas: CanvasBlockAttributes): CanvasPoint {
  const index = canvas.cards.length;
  return { x: (index % 4) * 220, y: Math.floor(index / 4) * 160 };
}

export function addCanvasTextCard(
  canvas: CanvasBlockAttributes,
  text: string,
  idFactory: CanvasIdFactory = generateUuidV7,
): CanvasBlockAttributes {
  const normalized = text.trim();
  if (normalized.length === 0 || normalized.length > 4_000 || canvas.cards.length >= 500) {
    return canvas;
  }
  const cardId = idFactory();
  return validated(
    {
      ...canvas,
      cards: [
        ...canvas.cards,
        {
          cardId,
          kind: "text",
          text: normalized,
          ...defaultPosition(canvas),
          width: 200,
          height: 120,
        },
      ],
    },
    canvas,
  );
}

export function addCanvasPageCard(
  canvas: CanvasBlockAttributes,
  targetItemId: Uuid,
  idFactory: CanvasIdFactory = generateUuidV7,
): CanvasBlockAttributes {
  if (!isUuid(targetItemId) || canvas.cards.length >= 500) return canvas;
  return validated(
    {
      ...canvas,
      cards: [
        ...canvas.cards,
        {
          cardId: idFactory(),
          kind: "page",
          targetItemId,
          ...defaultPosition(canvas),
          width: 220,
          height: 120,
        },
      ],
    },
    canvas,
  );
}

export function updateCanvasTextCard(
  canvas: CanvasBlockAttributes,
  cardId: Uuid,
  text: string,
): CanvasBlockAttributes {
  const normalized = text.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 4_000 ||
    !canvas.cards.some((card) => card.cardId === cardId && card.kind === "text")
  ) {
    return canvas;
  }
  return validated(
    {
      ...canvas,
      cards: canvas.cards.map((card) =>
        card.cardId === cardId && card.kind === "text" ? { ...card, text: normalized } : card,
      ),
    },
    canvas,
  );
}

export function moveCanvasCard(
  canvas: CanvasBlockAttributes,
  cardId: Uuid,
  x: number,
  y: number,
): CanvasBlockAttributes {
  if (!canvas.cards.some((card) => card.cardId === cardId)) return canvas;
  return validated(
    {
      ...canvas,
      cards: canvas.cards.map((card) => (card.cardId === cardId ? { ...card, x, y } : card)),
    },
    canvas,
  );
}

export function resizeCanvasCard(
  canvas: CanvasBlockAttributes,
  cardId: Uuid,
  width: number,
  height: number,
): CanvasBlockAttributes {
  if (!canvas.cards.some((card) => card.cardId === cardId)) return canvas;
  return validated(
    {
      ...canvas,
      cards: canvas.cards.map((card) =>
        card.cardId === cardId ? { ...card, width, height } : card,
      ),
    },
    canvas,
  );
}

export function removeCanvasCard(
  canvas: CanvasBlockAttributes,
  cardId: Uuid,
): CanvasBlockAttributes {
  if (!canvas.cards.some((card) => card.cardId === cardId)) return canvas;
  return validated(
    {
      ...canvas,
      cards: canvas.cards.filter((card) => card.cardId !== cardId),
      connections: canvas.connections.filter(
        (connection) => connection.sourceCardId !== cardId && connection.targetCardId !== cardId,
      ),
    },
    canvas,
  );
}

export function updateCanvasViewport(
  canvas: CanvasBlockAttributes,
  patch: Partial<CanvasBlockAttributes["viewport"]>,
): CanvasBlockAttributes {
  return validated({ ...canvas, viewport: { ...canvas.viewport, ...patch } }, canvas);
}

export function addCanvasConnection(
  canvas: CanvasBlockAttributes,
  sourceCardId: Uuid,
  targetCardId: Uuid,
  label: string,
  idFactory: CanvasIdFactory = generateUuidV7,
): CanvasBlockAttributes {
  const normalized = label.trim();
  if (normalized.length > 120 || canvas.connections.length >= 1_000) return canvas;
  return validated(
    {
      ...canvas,
      connections: [
        ...canvas.connections,
        { connectionId: idFactory(), sourceCardId, targetCardId, label: normalized },
      ],
    },
    canvas,
  );
}

export function renameCanvasConnection(
  canvas: CanvasBlockAttributes,
  connectionId: Uuid,
  label: string,
): CanvasBlockAttributes {
  const normalized = label.trim();
  if (
    normalized.length > 120 ||
    !canvas.connections.some((connection) => connection.connectionId === connectionId)
  ) {
    return canvas;
  }
  return validated(
    {
      ...canvas,
      connections: canvas.connections.map((connection) =>
        connection.connectionId === connectionId
          ? { ...connection, label: normalized }
          : connection,
      ),
    },
    canvas,
  );
}

export function removeCanvasConnection(
  canvas: CanvasBlockAttributes,
  connectionId: Uuid,
): CanvasBlockAttributes {
  if (!canvas.connections.some((connection) => connection.connectionId === connectionId)) {
    return canvas;
  }
  return validated(
    {
      ...canvas,
      connections: canvas.connections.filter(
        (connection) => connection.connectionId !== connectionId,
      ),
    },
    canvas,
  );
}

export function addCanvasStroke(
  canvas: CanvasBlockAttributes,
  width: CanvasStrokeWidth,
  points: readonly CanvasPoint[],
  idFactory: CanvasIdFactory = generateUuidV7,
): CanvasBlockAttributes {
  if (canvas.strokes.length >= 200) return canvas;
  return validated(
    {
      ...canvas,
      strokes: [...canvas.strokes, { strokeId: idFactory(), width, points: [...points] }],
    },
    canvas,
  );
}

export function removeCanvasStroke(
  canvas: CanvasBlockAttributes,
  strokeId: Uuid,
): CanvasBlockAttributes {
  if (!canvas.strokes.some((stroke) => stroke.strokeId === strokeId)) return canvas;
  return validated(
    { ...canvas, strokes: canvas.strokes.filter((stroke) => stroke.strokeId !== strokeId) },
    canvas,
  );
}
