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

  it("builds the default neighborhood from content links and admits hierarchy only as opt-in", () => {
    const page = node("Page");
    const linked = node("Liée");
    const child = node("Enfant");
    const graph = normalizeGraphSource(
      source(
        [page, linked, child],
        [
          edge(page.id, linked.id),
          edge(page.id, child.id, {
            relationType: "hierarchy:contains",
            origin: "hierarchy",
          }),
        ],
      ),
    );
    const semantic = defaultGraphQuery({ kind: "neighborhood", centerId: page.id, depth: 1 });
    expect(projectGraph(graph, semantic).nodes.map(({ id }) => id)).toEqual([page.id, linked.id]);

    const withHierarchy = defaultGraphQuery({
      kind: "neighborhood",
      centerId: page.id,
      depth: 1,
    });
    withHierarchy.filters.edgeLayers = ["knowledge", "hierarchy"];
    expect(new Set(projectGraph(graph, withHierarchy).nodes.map(({ id }) => id))).toEqual(
      new Set([page.id, child.id, linked.id]),
    );
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
