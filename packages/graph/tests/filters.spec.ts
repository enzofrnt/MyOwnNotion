import { describe, expect, it } from "vitest";
import { defaultGraphQuery, normalizeGraphSource, projectGraph } from "../src/index.ts";
import { edge, node, source } from "./fixtures.ts";

describe("global scopes and filters", () => {
  it("keeps a hierarchy branch and never pulls connected nodes from outside it", () => {
    const root = node("Dossier", { kind: "folder", canonicalKind: "folder" });
    const inside = node("Dedans", { parentIds: [root.id] });
    const outside = node("Dehors");
    const graph = normalizeGraphSource(
      source([root, inside, outside], [edge(inside.id, outside.id)]),
    );
    const query = defaultGraphQuery({ kind: "branch", rootId: root.id });
    query.filters.includeIsolated = true;
    expect(projectGraph(graph, query).nodes.map(({ id }) => id)).toEqual([root.id, inside.id]);
  });

  it("intersects content, relation, attachment, format and lifecycle filters", () => {
    const page = node("Page");
    const image = node("Image", {
      kind: "file",
      canonicalKind: "file",
      mediaType: "image/png",
    });
    const pdf = node("PDF", {
      kind: "file",
      canonicalKind: "file",
      mediaType: "application/pdf",
    });
    const graph = normalizeGraphSource(
      source(
        [page, image, pdf],
        [
          edge(page.id, image.id, { relationType: "file:attachment", origin: "attachment" }),
          edge(page.id, pdf.id, { relationType: "file:attachment", origin: "attachment" }),
        ],
      ),
    );
    const query = defaultGraphQuery({ kind: "workspace" });
    query.filters.nodeKinds = ["file"];
    query.filters.attachment = "only";
    query.filters.mediaTypes = ["image/"];
    query.filters.includeIsolated = true;
    expect(projectGraph(graph, query).nodes.map(({ id }) => id)).toEqual([image.id]);
  });

  it("reports honest totals when rendering is bounded and reset restores defaults", () => {
    const nodes = Array.from({ length: 25 }, (_, index) => node(String(index)));
    const graph = normalizeGraphSource(source(nodes, []));
    const query = defaultGraphQuery({ kind: "workspace" });
    query.filters.includeIsolated = true;
    query.limits.maxNodes = 20;
    const projection = projectGraph(graph, query);
    expect(projection.nodes).toHaveLength(20);
    expect(projection.summary.candidateNodeCount).toBe(25);
    expect(projection.truncation).toMatchObject({ truncated: true, omittedNodes: 5 });
    expect(defaultGraphQuery({ kind: "workspace" }).filters.includeIsolated).toBe(false);
  });
});
