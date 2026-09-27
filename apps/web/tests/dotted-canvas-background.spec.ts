// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DOTTED_CANVAS_GAP_BASE,
  getDottedCanvasGap,
  updateDottedCanvasBackground,
} from "../src/ui/dotted-canvas-background.ts";

describe("dotted canvas background", () => {
  it("keeps the base gap at unit zoom", () => {
    expect(getDottedCanvasGap(1)).toBe(DOTTED_CANVAS_GAP_BASE);
  });

  it("clamps extreme zoom so dots stay readable", () => {
    expect(getDottedCanvasGap(0.05)).toBeGreaterThanOrEqual(10);
    expect(getDottedCanvasGap(8)).toBeLessThanOrEqual(50);
  });

  it("writes pan and gap onto the host element", () => {
    const host = document.createElement("div");
    updateDottedCanvasBackground(host, { zoom: 1, translateX: 12, translateY: -4 });
    expect(host.style.backgroundPosition).toBe("12px -4px");
    expect(host.style.backgroundSize).toBe("20px 20px");
  });
});
