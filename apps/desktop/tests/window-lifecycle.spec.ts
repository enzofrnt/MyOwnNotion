import { describe, expect, it } from "vitest";
import { sanitizeWindowState } from "../src/window-state.ts";

describe("window lifecycle", () => {
  it("restores bounds onto a visible display", () => {
    const restored = sanitizeWindowState(
      {
        bounds: { x: 80, y: 80, width: 1200, height: 800 },
        isMaximized: false,
        lastRoute: "/notes",
        lastProfileId: "p1",
      },
      [{ x: 0, y: 0, width: 1440, height: 900 }],
    );
    expect(restored.bounds.width).toBe(1200);
    expect(restored.lastRoute).toBe("/notes");
  });
});
