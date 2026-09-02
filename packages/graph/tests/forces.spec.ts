import { describe, expect, it } from "vitest";
import {
  createGraphForceRuntime,
  DEFAULT_GRAPH_FORCES,
  defaultGraphQuery,
  graphCenterGravity,
  graphRepelCharge,
  layoutGraph,
  normalizeGraphSource,
  parseGraphForceSettings,
  projectGraph,
} from "../src/index.ts";
import { edge, node, source } from "./fixtures.ts";

function extent(layout: ReturnType<typeof layoutGraph>): number {
  return Math.hypot(layout.width, layout.height);
}

describe("Obsidian-style graph forces", () => {
  it("keeps the published graph.json defaults and slider bounds", () => {
    expect(parseGraphForceSettings(undefined)).toEqual(DEFAULT_GRAPH_FORCES);
    expect(DEFAULT_GRAPH_FORCES).toEqual({
      centerForce: 0.5,
      repelForce: 10,
      linkForce: 1,
      linkDistance: 250,
    });
    expect(parseGraphForceSettings({ linkDistance: 12 }).linkDistance).toBe(30);
    expect(parseGraphForceSettings({ repelForce: 99 }).repelForce).toBe(20);
    expect(graphCenterGravity(0.5)).toBeCloseTo(0.07);
    expect(graphRepelCharge(10, 250)).toBeCloseTo(-4375);
  });

  it("lengthens settled links when link distance increases", () => {
    const hub = node("Hub");
    const leaf = node("Feuille");
    const projection = projectGraph(
      normalizeGraphSource(source([hub, leaf], [edge(leaf.id, hub.id)])),
      defaultGraphQuery({ kind: "workspace" }),
    );
    const short = layoutGraph(projection, { ...DEFAULT_GRAPH_FORCES, linkDistance: 80 });
    const long = layoutGraph(projection, { ...DEFAULT_GRAPH_FORCES, linkDistance: 400 });
    const gap = (layout: typeof short, left: typeof hub.id, right: typeof leaf.id): number => {
      const from = layout.positions.find((position) => position.id === left);
      const to = layout.positions.find((position) => position.id === right);
      if (from === undefined || to === undefined) return 0;
      return Math.hypot(from.x - to.x, from.y - to.y);
    };
    expect(gap(long, hub.id, leaf.id)).toBeGreaterThan(gap(short, hub.id, leaf.id));
  });

  it("compacts the cloud when center force increases and stays bounded with repulsion on", () => {
    const hub = node("Hub");
    const leaves = [node("A"), node("B"), node("C"), node("D"), node("E")];
    const projection = projectGraph(
      normalizeGraphSource(
        source(
          [hub, ...leaves],
          leaves.map((leaf) => edge(leaf.id, hub.id)),
        ),
      ),
      defaultGraphQuery({ kind: "workspace" }),
    );
    const loose = layoutGraph(projection, { ...DEFAULT_GRAPH_FORCES, centerForce: 0.15 });
    const tight = layoutGraph(projection, { ...DEFAULT_GRAPH_FORCES, centerForce: 1 });
    expect(extent(tight)).toBeLessThan(extent(loose));
    expect(extent(layoutGraph(projection))).toBeLessThan(1800);
  });

  it("keeps a dragged node pinned until it is released", () => {
    const hub = node("Hub");
    const leaf = node("Feuille");
    const projection = projectGraph(
      normalizeGraphSource(source([hub, leaf], [edge(leaf.id, hub.id)])),
      defaultGraphQuery({ kind: "workspace" }),
    );
    const runtime = createGraphForceRuntime(projection);
    runtime.settle();
    runtime.pin(leaf.id, 40, -25);
    runtime.alphaTarget = 0.3;
    runtime.reheat(0.3);
    for (let tick = 0; tick < 12; tick += 1) runtime.tick(DEFAULT_GRAPH_FORCES);
    const pinned = runtime.snapshot().positions.find((position) => position.id === leaf.id);
    expect(pinned?.x).toBe(40);
    expect(pinned?.y).toBe(-25);
    runtime.unpin(leaf.id);
    runtime.alphaTarget = 0;
    runtime.reheat(0.5);
    for (let tick = 0; tick < 8; tick += 1) runtime.tick(DEFAULT_GRAPH_FORCES);
    const released = runtime.snapshot().positions.find((position) => position.id === leaf.id);
    expect(released?.x).not.toBe(40);
  });
});
