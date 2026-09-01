import { describe, expect, it } from "vitest";
import {
  defaultGraphQuery,
  layoutGraph,
  normalizeGraphSource,
  projectGraph,
} from "../src/index.ts";
import { edge, node, source } from "./fixtures.ts";

describe("local graph", () => {
  it("walks incoming and outgoing edges to the requested depth without looping", () => {
    const a = node("A");
    const b = node("B");
    const c = node("C");
    const d = node("D");
    const graph = normalizeGraphSource(
      source(
        [a, b, c, d],
        [edge(a.id, b.id), edge(c.id, b.id), edge(c.id, d.id), edge(d.id, a.id)],
      ),
    );

    const one = projectGraph(
      graph,
      defaultGraphQuery({ kind: "neighborhood", centerId: b.id, depth: 1 }),
    );
    const two = projectGraph(
      graph,
      defaultGraphQuery({ kind: "neighborhood", centerId: b.id, depth: 2 }),
    );
    expect(one.nodes.map(({ id }) => id)).toEqual([b.id, a.id, c.id]);
    expect(two.nodes.map(({ id }) => id)).toEqual([b.id, a.id, c.id, d.id]);
  });

  it("produces a stable centered layout", () => {
    const a = node("A");
    const b = node("B");
    const graph = normalizeGraphSource(source([a, b], [edge(a.id, b.id)]));
    const projection = projectGraph(
      graph,
      defaultGraphQuery({ kind: "neighborhood", centerId: a.id, depth: 2 }),
    );
    expect(layoutGraph(projection)).toEqual(layoutGraph(projection));
    expect(layoutGraph(projection).positions.find(({ id }) => id === a.id)).toMatchObject({
      depth: 0,
    });
  });
});
