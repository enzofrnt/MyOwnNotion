import {
  projectCanvasConnections,
  resolveCanvasCardLabel,
  validateCanvasBlockAttributes,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { buildCanvasFixture } from "../fixtures/canvas.ts";

describe("freeform canvas performance", () => {
  it("validates and projects 500 cards, 1,000 connections, and 200 strokes within one second", () => {
    const canvas = buildCanvasFixture(500, 1_000, 200);
    const durations: number[] = [];
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const started = performance.now();
      const validated = validateCanvasBlockAttributes(canvas);
      expect(validated.ok).toBe(true);
      if (!validated.ok) throw new Error("Canvas fixture did not validate");
      expect(projectCanvasConnections(validated.value)).toHaveLength(1_000);
      expect(validated.value.cards.map((card) => resolveCanvasCardLabel(card, []))).toHaveLength(
        500,
      );
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Number.POSITIVE_INFINITY;
    console.info(`[perf] 500-card/1,000-connection/200-stroke canvas p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(1_000);
  });
});
