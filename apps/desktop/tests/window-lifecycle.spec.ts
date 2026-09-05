import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireSingleInstanceLock, releaseSingleInstanceLock } from "../src/single-instance.ts";
import { sanitizeWindowState } from "../src/window-state.ts";

describe("window lifecycle", () => {
  it("keeps a single instance lock", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "desktop-lock-"));
    try {
      expect(acquireSingleInstanceLock(dir)).toBe(true);
      expect(acquireSingleInstanceLock(dir)).toBe(false);
      releaseSingleInstanceLock(dir);
      expect(acquireSingleInstanceLock(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
