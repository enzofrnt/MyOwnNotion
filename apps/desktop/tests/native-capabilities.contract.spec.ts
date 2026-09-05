import { describe, expect, it } from "vitest";
import { performOpenExternal } from "../src/native-capabilities.ts";
import { DEFAULT_WINDOW_STATE } from "../src/window-state.ts";

describe("native capability contracts", () => {
  it("opens only approved https URLs", async () => {
    const opened: string[] = [];
    const allowed = await performOpenExternal(
      { openExternal: async (url) => opened.push(url) === 1 },
      "https://example.invalid/help",
    );
    expect(allowed).toEqual({ ok: true });
    expect(opened).toEqual(["https://example.invalid/help"]);
  });

  it("refuses javascript and file schemes", async () => {
    const denied = await performOpenExternal(
      { openExternal: async () => true },
      "javascript:alert(1)",
    );
    expect(denied.ok).toBe(false);
  });

  it("exposes window-state without content", () => {
    expect(DEFAULT_WINDOW_STATE.lastRoute).toBeNull();
    expect(JSON.stringify(DEFAULT_WINDOW_STATE)).not.toMatch(/token|cookie/i);
  });
});
