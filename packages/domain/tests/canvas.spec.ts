import {
  canvasPointToScreen,
  createEmptyCanvasAttributes,
  generateUuidV7,
  projectCanvasConnections,
  resolveCanvasCardLabel,
  screenPointToCanvas,
  validateCanvasBlockAttributes,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { buildCanvasFixture } from "../../../tests/fixtures/canvas.ts";

describe("freeform canvas domain", () => {
  it("accepts stable text/page cards, directed connections, complete strokes, and viewport", () => {
    const canvas = buildCanvasFixture();
    expect(validateCanvasBlockAttributes(canvas)).toEqual({ ok: true, value: canvas });
  });

  it("creates an empty canonical canvas", () => {
    const canvasId = generateUuidV7();
    expect(createEmptyCanvasAttributes(canvasId)).toEqual({
      canvasId,
      schemaVersion: 1,
      cards: [],
      connections: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
  });

  it.each([
    [
      "unknown field",
      (canvas: ReturnType<typeof buildCanvasFixture>) => ({ ...canvas, secret: 1 }),
    ],
    [
      "duplicate card identity",
      (canvas: ReturnType<typeof buildCanvasFixture>) => ({
        ...canvas,
        cards: [canvas.cards[0], canvas.cards[0]],
        connections: [],
      }),
    ],
    [
      "dangling connection",
      (canvas: ReturnType<typeof buildCanvasFixture>) => ({
        ...canvas,
        connections: [{ ...canvas.connections[0], targetCardId: generateUuidV7() }],
      }),
    ],
    [
      "self connection",
      (canvas: ReturnType<typeof buildCanvasFixture>) => ({
        ...canvas,
        connections: [
          {
            ...canvas.connections[0],
            targetCardId: canvas.connections[0]?.sourceCardId,
          },
        ],
      }),
    ],
    [
      "duplicate directed pair",
      (canvas: ReturnType<typeof buildCanvasFixture>) => ({
        ...canvas,
        connections: [
          canvas.connections[0],
          { ...canvas.connections[0], connectionId: generateUuidV7() },
        ],
      }),
    ],
    [
      "invalid stroke point",
      (canvas: ReturnType<typeof buildCanvasFixture>) => ({
        ...canvas,
        strokes: [
          {
            ...canvas.strokes[0],
            points: [
              { x: 0, y: 0 },
              { x: Number.NaN, y: 2 },
            ],
          },
        ],
      }),
    ],
  ])("rejects %s without private content", (_label, mutate) => {
    const result = validateCanvasBlockAttributes(mutate(buildCanvasFixture()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.title).toBe("Invalid canvas block structure");
  });

  it("enforces card, connection, stroke, point, geometry, text, label, and viewport limits", () => {
    expect(validateCanvasBlockAttributes(buildCanvasFixture(501, 0, 0)).ok).toBe(false);
    expect(validateCanvasBlockAttributes(buildCanvasFixture(50, 1_001, 0)).ok).toBe(false);
    expect(validateCanvasBlockAttributes(buildCanvasFixture(2, 0, 201)).ok).toBe(false);
    const canvas = buildCanvasFixture(2, 1, 1);
    const cases = [
      { ...canvas, cards: [{ ...canvas.cards[0], x: 1_000_001 }] },
      { ...canvas, cards: [{ ...canvas.cards[0], width: 159 }] },
      { ...canvas, cards: [{ ...canvas.cards[0], kind: "text", text: "x".repeat(4_001) }] },
      { ...canvas, connections: [{ ...canvas.connections[0], label: "x".repeat(121) }] },
      { ...canvas, strokes: [{ ...canvas.strokes[0], points: [{ x: 0, y: 0 }] }] },
      { ...canvas, viewport: { ...canvas.viewport, zoom: 4.01 } },
    ];
    for (const candidate of cases) expect(validateCanvasBlockAttributes(candidate).ok).toBe(false);
  });

  it("projects current connection centers without mutating canonical order", () => {
    const canvas = buildCanvasFixture(3, 2, 0);
    const before = structuredClone(canvas);
    const projected = projectCanvasConnections(canvas);
    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({
      connectionId: canvas.connections[0]?.connectionId,
      source: {
        x: (canvas.cards[0]?.x ?? 0) + (canvas.cards[0]?.width ?? 0) / 2,
        y: (canvas.cards[0]?.y ?? 0) + (canvas.cards[0]?.height ?? 0) / 2,
      },
    });
    expect(canvas).toEqual(before);
  });

  it("converts world and screen coordinates exactly through a saved viewport", () => {
    const viewport = { x: 25, y: -40, zoom: 2 };
    const world = { x: -125.5, y: 90.25 };
    const screen = canvasPointToScreen(world, viewport);
    expect(screen).toEqual({ x: -226, y: 140.5 });
    expect(screenPointToCanvas(screen, viewport)).toEqual(world);
  });

  it("resolves current page labels and retains explicit unavailable targets", () => {
    const canvas = buildCanvasFixture(4, 0, 0);
    const pageCard = canvas.cards.find((card) => card.kind === "page");
    if (pageCard === undefined || pageCard.kind !== "page") throw new Error("Page card missing");
    expect(
      resolveCanvasCardLabel(pageCard, [{ id: pageCard.targetItemId, name: "Current title" }]),
    ).toEqual({
      label: "Current title",
      availability: "available",
    });
    expect(resolveCanvasCardLabel(pageCard, [])).toEqual({
      label: "Unavailable page",
      availability: "unavailable",
    });
  });
});
