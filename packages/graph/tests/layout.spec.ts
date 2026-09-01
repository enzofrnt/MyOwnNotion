import { describe, expect, it } from "vitest";
import {
  defaultGraphQuery,
  layoutGraph,
  normalizeGraphSource,
  projectGraph,
} from "../src/index.ts";
import { edge, node, source } from "./fixtures.ts";

describe("relation-driven graph layout", () => {
  it("is deterministic and gives referenced hubs a larger bounded radius", () => {
    const hub = node("Hub");
    const leaves = [node("A"), node("B"), node("C"), node("D")];
    const edges = leaves.map((leaf) => edge(leaf.id, hub.id));
    const projection = projectGraph(
      normalizeGraphSource(source([hub, ...leaves], edges)),
      defaultGraphQuery({ kind: "workspace" }),
    );

    const first = layoutGraph(projection);
    const second = layoutGraph({
      ...projection,
      nodes: [...projection.nodes].reverse(),
      edges: [...projection.edges].reverse(),
    });
    expect(first).toEqual(second);
    const hubPosition = first.positions.find(({ id }) => id === hub.id);
    const leafPosition = first.positions.find(({ id }) => id === leaves[0]?.id);
    expect(hubPosition?.radius).toBeGreaterThan(leafPosition?.radius ?? Number.MAX_SAFE_INTEGER);
    expect(first.positions.every(({ radius }) => radius >= 24 && radius <= 42)).toBe(true);
  });

  it("keeps linked nodes closer than unrelated component centers", () => {
    const a = node("A");
    const b = node("B");
    const isolated = node("Isolée");
    const query = defaultGraphQuery({ kind: "workspace" });
    query.filters.includeIsolated = true;
    const layout = layoutGraph(
      projectGraph(normalizeGraphSource(source([a, b, isolated], [edge(a.id, b.id)])), query),
    );
    const positions = new Map(layout.positions.map((position) => [position.id, position]));
    const distance = (left: typeof a.id, right: typeof a.id): number => {
      const from = positions.get(left);
      const to = positions.get(right);
      if (from === undefined || to === undefined) return Number.POSITIVE_INFINITY;
      return Math.hypot(from.x - to.x, from.y - to.y);
    };
    expect(distance(a.id, b.id)).toBeLessThan(distance(a.id, isolated.id));
  });
});
