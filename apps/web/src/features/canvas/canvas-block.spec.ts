import { createEmptyCanvasAttributes, generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
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

describe("canvas block editing commands", () => {
  it("adds stable text/page cards and rejects empty text or duplicate identities", () => {
    const textId = generateUuidV7();
    const pageId = generateUuidV7();
    const targetId = generateUuidV7();
    let canvas = addCanvasTextCard(
      createEmptyCanvasAttributes(generateUuidV7()),
      " First idea ",
      () => textId,
    );
    canvas = addCanvasPageCard(canvas, targetId, () => pageId);
    expect(canvas.cards).toEqual([
      expect.objectContaining({ cardId: textId, kind: "text", text: "First idea" }),
      expect.objectContaining({ cardId: pageId, kind: "page", targetItemId: targetId }),
    ]);
    expect(addCanvasTextCard(canvas, "   ")).toBe(canvas);
    expect(addCanvasTextCard(canvas, "Collision", () => textId)).toBe(canvas);
  });

  it("edits, moves, and resizes one card without changing identity", () => {
    const cardId = generateUuidV7();
    let canvas = addCanvasTextCard(
      createEmptyCanvasAttributes(generateUuidV7()),
      "Original",
      () => cardId,
    );
    canvas = updateCanvasTextCard(canvas, cardId, "Edited");
    canvas = moveCanvasCard(canvas, cardId, -240.5, 900.25);
    canvas = resizeCanvasCard(canvas, cardId, 320, 180);
    expect(canvas.cards[0]).toEqual({
      cardId,
      kind: "text",
      text: "Edited",
      x: -240.5,
      y: 900.25,
      width: 320,
      height: 180,
    });
    expect(resizeCanvasCard(canvas, cardId, 100, 180)).toBe(canvas);
  });

  it("updates bounded viewport independently from cards", () => {
    const canvas = addCanvasTextCard(createEmptyCanvasAttributes(generateUuidV7()), "Idea");
    const updated = updateCanvasViewport(canvas, { x: 80, y: -120, zoom: 2 });
    expect(updated.viewport).toEqual({ x: 80, y: -120, zoom: 2 });
    expect(updated.cards).toEqual(canvas.cards);
    expect(updateCanvasViewport(updated, { zoom: 8 })).toBe(updated);
  });

  it("creates, renames, removes connections and cleans incident edges with a card", () => {
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const connectionId = generateUuidV7();
    let canvas = addCanvasTextCard(
      createEmptyCanvasAttributes(generateUuidV7()),
      "First",
      () => firstId,
    );
    canvas = addCanvasTextCard(canvas, "Second", () => secondId);
    canvas = addCanvasConnection(canvas, firstId, secondId, "leads to", () => connectionId);
    expect(canvas.connections).toEqual([
      { connectionId, sourceCardId: firstId, targetCardId: secondId, label: "leads to" },
    ]);
    expect(addCanvasConnection(canvas, firstId, secondId, "duplicate")).toBe(canvas);
    canvas = renameCanvasConnection(canvas, connectionId, "supports");
    expect(canvas.connections[0]?.label).toBe("supports");
    expect(removeCanvasConnection(canvas, generateUuidV7())).toBe(canvas);
    expect(removeCanvasCard(canvas, firstId)).toMatchObject({
      cards: [expect.objectContaining({ cardId: secondId })],
      connections: [],
    });
  });

  it("commits and removes complete stable strokes only", () => {
    const strokeId = generateUuidV7();
    const empty = createEmptyCanvasAttributes(generateUuidV7());
    const canvas = addCanvasStroke(
      empty,
      4,
      [
        { x: 0, y: 0 },
        { x: 12, y: -7 },
      ],
      () => strokeId,
    );
    expect(canvas.strokes).toEqual([
      {
        strokeId,
        width: 4,
        points: [
          { x: 0, y: 0 },
          { x: 12, y: -7 },
        ],
      },
    ]);
    expect(addCanvasStroke(canvas, 2, [{ x: 0, y: 0 }])).toBe(canvas);
    expect(removeCanvasStroke(canvas, strokeId).strokes).toEqual([]);
  });
});
