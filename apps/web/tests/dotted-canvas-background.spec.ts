// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DOTTED_CANVAS_GAP_BASE,
  DOTTED_CANVAS_GAP_MIN,
  getDottedCanvasGap,
  updateDottedCanvasBackground,
} from "../src/ui/dotted-canvas-background.ts";

describe("dotted canvas background", () => {
  it("keeps the base gap at unit zoom", () => {
    expect(getDottedCanvasGap(1)).toBe(DOTTED_CANVAS_GAP_BASE);
  });

  it("keeps dots readable at any zoom without clamping", () => {
    for (const zoom of [0.01, 0.05, 0.3, 0.49, 0.5, 0.99, 1, 1.7, 2.99, 3, 4, 8]) {
      const gap = getDottedCanvasGap(zoom);
      expect(gap).toBeGreaterThanOrEqual(DOTTED_CANVAS_GAP_MIN);
      expect(gap).toBeLessThan(2 * DOTTED_CANVAS_GAP_MIN + 1e-9);
    }
  });

  it("locks the lattice to the world: the gap is the base times a power of two times the zoom", () => {
    for (const zoom of [0.07, 0.33, 0.8, 1.25, 2.6, 3.9]) {
      const level = Math.log2(getDottedCanvasGap(zoom) / (DOTTED_CANVAS_GAP_BASE * zoom));
      expect(Math.abs(level - Math.round(level))).toBeLessThan(1e-9);
    }
  });

  it("puts a dot on the world origin and keeps the offset inside one tile", () => {
    const host = document.createElement("div");
    updateDottedCanvasBackground(host, { zoom: 1, translateX: 12, translateY: -4 });
    // Tile 20px, dot at its centre: origin dot at (12, -4) → tile starts at (2, -14) ≡ (2, 6).
    expect(host.style.backgroundPosition).toBe("2px 6px");
    expect(host.style.backgroundSize).toBe("20px 20px");

    updateDottedCanvasBackground(host, { zoom: 1, translateX: 12 + 20 * 5000, translateY: -4 });
    expect(host.style.backgroundPosition).toBe("2px 6px");
  });
});
