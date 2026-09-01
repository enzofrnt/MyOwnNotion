import { describe, expect, it } from "vitest";
import {
  parseGraphPreferences,
  serializeGraphPreferences,
} from "../src/features/knowledge-graph/graph-preferences.ts";

describe("device-local graph preferences", () => {
  it("serializes only bounded technical presentation choices", () => {
    const serialized = serializeGraphPreferences({
      mode: "list",
      depth: 3,
      nodeKinds: ["page"],
      relationTypes: ["page:link"],
      includeIsolated: true,
      zoom: 1.5,
    });
    expect(serialized).not.toContain("title");
    expect(serialized).not.toContain("selectedId");
    expect(parseGraphPreferences(serialized)).toMatchObject({ mode: "list", depth: 3, zoom: 1.5 });
  });

  it("drops malformed or unbounded stored values", () => {
    expect(parseGraphPreferences('{"mode":"canvas","depth":99,"zoom":500}')).toMatchObject({
      depth: 3,
      zoom: 2,
    });
  });
});
