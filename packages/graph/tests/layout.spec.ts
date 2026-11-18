import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  createGraphForceRuntime,
  DEFAULT_GRAPH_FORCES,
  defaultGraphQuery,
  graphNodeRadius,
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
    expect(first.positions.every(({ radius }) => radius >= 3.6 && radius <= 13)).toBe(true);
    expect(
      Math.hypot(hubPosition?.x ?? 0, hubPosition?.y ?? 0) +
        Math.hypot(leafPosition?.x ?? 0, leafPosition?.y ?? 0),
    ).toBeGreaterThan(0);
  });

  it("keeps linked rest length near the link-distance slider", () => {
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
    expect(distance(a.id, b.id)).toBeGreaterThan(80);
    expect(distance(a.id, b.id)).toBeLessThan(400);
    expect(new Set(layout.positions.map(({ component }) => component)).size).toBe(2);
  });

  it("keeps disconnected trees as separate components in a bounded cloud", () => {
    const leftHub = node("Gauche");
    const rightHub = node("Droite");
    const leftLeaves = [node("L1"), node("L2"), node("L3")];
    const rightLeaves = [node("R1"), node("R2"), node("R3")];
    const layout = layoutGraph(
      projectGraph(
        normalizeGraphSource(
          source(
            [leftHub, rightHub, ...leftLeaves, ...rightLeaves],
            [
              ...leftLeaves.map((leaf) => edge(leaf.id, leftHub.id)),
              ...rightLeaves.map((leaf) => edge(leaf.id, rightHub.id)),
            ],
          ),
        ),
        defaultGraphQuery({ kind: "workspace" }),
      ),
    );
    const span = Math.hypot(layout.width, layout.height);
    expect(span).toBeLessThan(2500);
    expect(new Set(layout.positions.map(({ component }) => component)).size).toBe(2);
  });

  it("covers cycles, duplicate pairs, zero forces, pins, and overlapping nodes", () => {
    const a = node("A");
    const b = node("B");
    const c = node("C");
    const projection = projectGraph(
      normalizeGraphSource(
        source([a, b, c], [edge(a.id, b.id), edge(b.id, c.id), edge(c.id, a.id)]),
      ),
      defaultGraphQuery({ kind: "workspace" }),
    );
    const firstEdge = projection.edges[0];
    if (firstEdge === undefined) throw new Error("triangle fixture requires an edge");
    const layout = layoutGraph(
      {
        ...projection,
        edges: [
          ...projection.edges,
          { ...firstEdge, key: `${firstEdge.key}-dup` },
          { ...firstEdge, key: "orphan", targetId: generateUuidV7() },
        ],
      },
      { ...DEFAULT_GRAPH_FORCES, centerForce: 0, repelForce: 0 },
    );
    expect(layout.positions).toHaveLength(3);
    expect(new Set(layout.positions.map(({ component }) => component)).size).toBe(1);
    expect(graphNodeRadius(-4)).toBe(3.6);
    expect(graphNodeRadius(10_000)).toBe(13);

    const runtime = createGraphForceRuntime(projection);
    runtime.pin(generateUuidV7(), 1, 2);
    runtime.unpin(generateUuidV7());
    runtime.pin(a.id, 0, 0);
    runtime.pin(b.id, 0, 0);
    runtime.tick({ ...DEFAULT_GRAPH_FORCES, repelForce: 0 });
    runtime.tick(DEFAULT_GRAPH_FORCES);
    runtime.pin(a.id, 0, 0);
    runtime.pin(c.id, 8_000, 0);
    runtime.tick({ ...DEFAULT_GRAPH_FORCES, linkDistance: 30 });
    runtime.unpin(a.id);
    runtime.unpin(c.id);
    runtime.reheat();
    runtime.reheat(2);
    expect(runtime.settle(DEFAULT_GRAPH_FORCES, 0).positions).toHaveLength(3);
    runtime.pin(a.id, Number.NaN, Number.NaN);
    runtime.pin(b.id, Number.NaN, Number.NaN);
    runtime.pin(c.id, Number.NaN, Number.NaN);
    expect(runtime.snapshot()).toEqual({ width: 800, height: 520, positions: [] });
  });
});

describe("live layout (062)", () => {
  it("keeps already placed nodes where they were and places a new node near its neighbour", () => {
    const a = node("A");
    const b = node("B");
    const before = projectGraph(
      normalizeGraphSource(source([a, b], [edge(a.id, b.id)])),
      defaultGraphQuery({ kind: "workspace" }),
    );
    const first = createGraphForceRuntime(before).settle(DEFAULT_GRAPH_FORCES, 120);
    const seed = new Map(first.positions.map((position) => [position.id, position]));

    const c = node("C");
    const after = projectGraph(
      normalizeGraphSource(source([a, b, c], [edge(a.id, b.id), edge(a.id, c.id)])),
      defaultGraphQuery({ kind: "workspace" }),
    );
    const seeded = createGraphForceRuntime(after, seed).snapshot();
    const at = (id: string) => seeded.positions.find((position) => position.id === id);
    const was = (id: string) => first.positions.find((position) => position.id === id);
    expect(at(a.id)?.x).toBeCloseTo(was(a.id)?.x ?? Number.NaN, 0);
    expect(at(b.id)?.y).toBeCloseTo(was(b.id)?.y ?? Number.NaN, 0);
    const placedA = at(a.id);
    const placedC = at(c.id);
    expect(placedA).toBeDefined();
    expect(placedC).toBeDefined();
    expect(
      Math.hypot((placedC?.x ?? 0) - (placedA?.x ?? 0), (placedC?.y ?? 0) - (placedA?.y ?? 0)),
    ).toBeLessThan(60);
  });
});
