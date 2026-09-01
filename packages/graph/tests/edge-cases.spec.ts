import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  aggregateEdges,
  defaultGraphQuery,
  layoutGraph,
  normalizeGraphQuery,
  normalizeGraphSource,
  projectGraph,
  type RawGraphEdge,
} from "../src/index.ts";
import { edge, node, source } from "./fixtures.ts";

const invalidUuid = "not-a-uuid" as Uuid;

describe("knowledge graph defensive edge cases", () => {
  it("normalizes every query scope, ordered filter and lower rendering bound", () => {
    const first = generateUuidV7();
    const second = generateUuidV7();
    const selection = normalizeGraphQuery({
      ...defaultGraphQuery({
        kind: "selection",
        itemIds: [second, invalidUuid, first, first],
      }),
      filters: {
        ...defaultGraphQuery({ kind: "workspace" }).filters,
        nodeKinds: ["task", "page", "task"],
        relationTypes: ["page:link", "file:attachment", "page:link"],
        mediaTypes: ["image/", "application/pdf", "image/"],
        structured: [
          { field: "status", operator: "equals", value: "Todo" },
          { field: "dueDate", operator: "after", value: "2026-08-31" },
        ],
      },
      limits: { maxNodes: 1, maxEdges: 1 },
    });

    expect(selection.scope).toEqual({
      kind: "selection",
      itemIds: [first, second].toSorted(),
    });
    expect(selection.filters.nodeKinds).toEqual(["page", "task"]);
    expect(selection.filters.structured.map(({ field }) => field)).toEqual(["dueDate", "status"]);
    expect(selection.limits).toEqual({ maxNodes: 20, maxEdges: 20 });

    expect(
      normalizeGraphQuery(
        defaultGraphQuery({ kind: "neighborhood", centerId: first, depth: 99 as 1 }),
      ).scope,
    ).toEqual({ kind: "neighborhood", centerId: first, depth: 3 });
    expect(
      normalizeGraphQuery(
        defaultGraphQuery({ kind: "neighborhood", centerId: first, depth: -4 as 1 }),
      ).scope,
    ).toEqual({ kind: "neighborhood", centerId: first, depth: 1 });
  });

  it("quarantines malformed and purged inputs while deterministically deduplicating identities", () => {
    const first = node("A");
    const duplicate = { ...first, name: "Z" };
    const purged = node("Purged", { lifecycle: "purged" });
    const invalid = node("Invalid", { id: invalidUuid });
    const second = node("B", { name: null, parentIds: [invalidUuid, first.id, first.id] });
    const valid = edge(first.id, second.id);
    const malformed: RawGraphEdge[] = [
      { ...edge(first.id, second.id), id: "" },
      { ...edge(first.id, second.id), id: "x".repeat(257) },
      edge(invalidUuid, second.id),
      edge(first.id, invalidUuid),
      edge(first.id, second.id, { relationType: "not namespaced" }),
      edge(first.id, generateUuidV7()),
    ];

    const normalized = normalizeGraphSource(
      source([duplicate, first, purged, invalid, second], [valid, valid, ...malformed]),
    );

    expect(normalized.nodes).toHaveLength(2);
    expect(normalized.nodes.find(({ id }) => id === first.id)?.name).toBe("A");
    expect(normalized.nodes.find(({ id }) => id === second.id)?.parentIds).toEqual([first.id]);
    expect(normalized.edges).toEqual([valid]);
    expect(normalized.diagnostics).toMatchObject({
      invalidNodes: 1,
      invalidEdges: 5,
      missingEndpoints: 1,
    });
  });

  it("keeps every endpoint availability explicit during aggregation", () => {
    const active = node("Active");
    const trashedSource = node("Trashed source", { lifecycle: "trashed" });
    const trashedTarget = node("Trashed target", { lifecycle: "trashed" });
    const absent = generateUuidV7();
    const nodes = new Map([active, trashedSource, trashedTarget].map((value) => [value.id, value]));
    const aggregated = aggregateEdges(
      [
        edge(active.id, absent, { relationType: "missing:endpoint" }),
        edge(trashedSource.id, trashedTarget.id, {
          relationType: "both:trashed",
        }),
        edge(trashedSource.id, active.id, { relationType: "source:trashed" }),
        edge(active.id, trashedTarget.id, { relationType: "target:trashed" }),
      ],
      nodes,
    );

    expect(
      Object.fromEntries(
        aggregated.map(({ relationType, availability }) => [relationType, availability]),
      ),
    ).toEqual({
      "both:trashed": "unavailable",
      "missing:endpoint": "unavailable",
      "source:trashed": "source-trashed",
      "target:trashed": "target-trashed",
    });
  });

  it("covers absent scopes, lifecycle, relation and structured-value filters", () => {
    const root = node("Root", {
      kind: "folder",
      canonicalKind: "folder",
      structured: {
        label: "Alpha",
        score: 2,
        dueDate: "2026-08-01",
        status: "Todo",
      },
    });
    const child = node("Child", {
      parentIds: [root.id],
      structured: {
        label: "Beta",
        score: 10,
        dueDate: "2026-09-30",
        status: null,
      },
    });
    const cycle = node("Cycle", {
      parentIds: [child.id, root.id],
      structured: {},
    });
    const trashed = node("Trashed", {
      lifecycle: "trashed",
      parentIds: [cycle.id],
    });
    const file = node("File", {
      kind: "file",
      canonicalKind: "file",
      mediaType: null,
    });
    const isolated = node("Isolated");
    const graph = normalizeGraphSource(
      source(
        [root, child, cycle, trashed, file, isolated],
        [
          edge(root.id, child.id),
          edge(child.id, cycle.id, { relationType: "future:semantic" }),
          edge(root.id, file.id, {
            relationType: "file:attachment",
            origin: "attachment",
          }),
        ],
      ),
    );
    const absent = generateUuidV7();

    const selection = defaultGraphQuery({ kind: "selection", itemIds: [root.id, absent] });
    selection.filters.includeIsolated = true;
    expect(projectGraph(graph, selection).nodes.map(({ id }) => id)).toEqual([root.id]);
    expect(
      projectGraph(graph, defaultGraphQuery({ kind: "neighborhood", centerId: absent, depth: 2 })),
    ).toMatchObject({ nodes: [], focusId: absent });
    expect(
      projectGraph(graph, defaultGraphQuery({ kind: "branch", rootId: absent })),
    ).toMatchObject({ nodes: [], focusId: absent });
    expect(
      projectGraph(
        graph,
        defaultGraphQuery({ kind: "neighborhood", centerId: isolated.id, depth: 2 }),
      ).nodes.map(({ id }) => id),
    ).toEqual([isolated.id]);

    const branchQuery = defaultGraphQuery({ kind: "branch", rootId: root.id });
    branchQuery.filters.includeIsolated = true;
    expect(projectGraph(graph, branchQuery).nodes.map(({ id }) => id)).toEqual([
      root.id,
      child.id,
      cycle.id,
    ]);

    for (const filter of [
      { field: "label", operator: "contains" as const, value: "ph" },
      { field: "score", operator: "equals" as const, value: 2 },
      { field: "dueDate", operator: "before" as const, value: "2026-08-31" },
      { field: "dueDate", operator: "after" as const, value: "2026-09-01" },
    ]) {
      const query = defaultGraphQuery({ kind: "workspace" });
      query.filters.structured = [filter];
      query.filters.includeIsolated = true;
      const projection = projectGraph(graph, query);
      expect(projection.nodes).toHaveLength(1);
      expect(projection.coverage).toMatchObject({
        state: "partial",
        reason: "missing-local-values",
      });
    }

    const lifecycle = defaultGraphQuery({ kind: "workspace" });
    lifecycle.filters.lifecycle = "including-trashed";
    lifecycle.filters.nodeKinds = ["page"];
    lifecycle.filters.includeIsolated = true;
    expect(projectGraph(graph, lifecycle).nodes.some(({ id }) => id === trashed.id)).toBe(true);

    const media = defaultGraphQuery({ kind: "workspace" });
    media.filters.mediaTypes = ["image/"];
    media.filters.includeIsolated = true;
    expect(projectGraph(graph, media).nodes).toEqual([]);

    const relation = defaultGraphQuery({ kind: "workspace" });
    expect(projectGraph(graph, relation).edges).toHaveLength(2);

    const attachment = defaultGraphQuery({ kind: "workspace" });
    attachment.filters.edgeLayers = ["attachment"];
    expect(projectGraph(graph, attachment).edges).toHaveLength(1);
  });

  it("lays out empty, focused and disconnected components without accepting outside nodes", () => {
    const a = node("A");
    const b = node("B");
    const c = node("C");
    const d = node("D");
    const e = node("E");
    const isolated = node("Isolated");
    const secondIsolated = node("Second isolated");
    const normalized = normalizeGraphSource(
      source(
        [a, b, c, d, e, isolated, secondIsolated],
        [edge(a.id, b.id), edge(a.id, c.id), edge(d.id, e.id)],
      ),
    );
    const query = defaultGraphQuery({ kind: "workspace" });
    query.filters.includeIsolated = true;
    const projection = projectGraph(normalized, query);

    expect(layoutGraph({ ...projection, nodes: [], edges: [] }).positions).toEqual([]);

    const outside = generateUuidV7();
    const firstEdge = projection.edges[0];
    if (firstEdge === undefined) throw new Error("The layout fixture requires one edge.");
    const layout = layoutGraph({
      ...projection,
      focusId: d.id,
      edges: [...projection.edges, { ...firstEdge, key: "outside", targetId: outside }],
    });
    expect(layout.positions).toHaveLength(7);
    expect(layout.positions.find(({ id }) => id === d.id)).toMatchObject({
      depth: 0,
    });
    expect(layout.width).toBeGreaterThanOrEqual(1_280);
  });
});
