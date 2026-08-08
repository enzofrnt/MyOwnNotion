import {
  type CanvasBlockAttributes,
  type CanvasCard,
  type CanvasConnection,
  type CanvasStroke,
  generateUuidV7,
} from "@myownnotion/domain";

export function buildCanvasFixture(
  cardCount = 6,
  connectionCount = Math.max(0, cardCount - 1),
  strokeCount = 2,
): CanvasBlockAttributes {
  const cards: CanvasCard[] = Array.from({ length: cardCount }, (_, index) => {
    const base = {
      cardId: generateUuidV7(),
      x: (index % 5) * 240 - 480,
      y: Math.floor(index / 5) * 180 - 180,
      width: 200,
      height: 120,
    };
    return index % 4 === 3
      ? { ...base, kind: "page" as const, targetItemId: generateUuidV7() }
      : { ...base, kind: "text" as const, text: `Canvas card ${index}` };
  });
  const connections: CanvasConnection[] = Array.from(
    { length: Math.min(connectionCount, Math.max(0, cardCount * (cardCount - 1))) },
    (_, index) => {
      const sourceIndex = index % Math.max(1, cardCount);
      const targetIndex =
        (Math.floor(index / Math.max(1, cardCount)) + sourceIndex + 1) % Math.max(1, cardCount);
      return {
        connectionId: generateUuidV7(),
        sourceCardId: cards[sourceIndex]?.cardId ?? generateUuidV7(),
        targetCardId: cards[targetIndex]?.cardId ?? generateUuidV7(),
        label: index % 2 === 0 ? `Connection ${index}` : "",
      };
    },
  );
  const strokes: CanvasStroke[] = Array.from({ length: strokeCount }, (_, strokeIndex) => ({
    strokeId: generateUuidV7(),
    width: ([2, 4, 8] as const)[strokeIndex % 3] ?? 2,
    points: Array.from({ length: 8 }, (_, pointIndex) => ({
      x: strokeIndex * 20 + pointIndex * 12,
      y: strokeIndex * -30 + pointIndex * 7,
    })),
  }));
  return {
    canvasId: generateUuidV7(),
    schemaVersion: 1,
    cards,
    connections,
    strokes,
    viewport: { x: 20, y: -15, zoom: 1.25 },
  };
}

export function buildCanvasDocument(canvas = buildCanvasFixture()) {
  return {
    format: "myownnotion.document+json" as const,
    formatVersion: 6,
    body: {
      type: "doc",
      content: [{ type: "canvasBlock", attrs: canvas }],
    },
  };
}
