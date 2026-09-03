import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_PREFERENCES,
  parseGraphPreferences,
  serializeGraphPreferences,
} from "../src/features/knowledge-graph/graph-preferences.ts";

describe("device-local graph preferences", () => {
  it("serializes only bounded technical presentation choices", () => {
    const serialized = serializeGraphPreferences({
      ...DEFAULT_GRAPH_PREFERENCES,
      depth: 3,
      edgeLayers: ["knowledge", "hierarchy"],
      nodeKinds: ["page"],
      relationTypes: ["page:link"],
      includeIsolated: true,
      zoom: 1.5,
    });
    expect(serialized).not.toContain("title");
    expect(serialized).not.toContain("selectedId");
    expect(serialized).not.toContain('"mode"');
    expect(parseGraphPreferences(serialized)).toMatchObject({
      depth: 3,
      edgeLayers: ["hierarchy", "knowledge"],
      zoom: 1.5,
    });
  });

  it("drops malformed, unbounded, or obsolete stored values", () => {
    expect(parseGraphPreferences('{"mode":"list","depth":99,"zoom":500}')).toMatchObject({
      depth: 3,
      edgeLayers: ["knowledge"],
      zoom: 4,
    });
    expect(parseGraphPreferences('{"zoom":0}')).toMatchObject({ zoom: 1, depth: 2 });
  });
});
