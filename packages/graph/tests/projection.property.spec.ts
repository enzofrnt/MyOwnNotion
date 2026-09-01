import { generateUuidV7 } from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { defaultGraphQuery, normalizeGraphSource, projectGraph } from "../src/index.ts";
import { edge, node, source } from "./fixtures.ts";

function stableUuid(index: number): ReturnType<typeof generateUuidV7> {
  return `00000000-0000-7000-8000-${index.toString(16).padStart(12, "0")}` as ReturnType<
    typeof generateUuidV7
  >;
}

describe("graph convergence properties", () => {
  it("is independent from delivery order and duplicate redelivery", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { minLength: 2, maxLength: 20 }),
        (values) => {
          const nodes = values.map((value) => node(String(value), { id: generateUuidV7() }));
          const edges = nodes.slice(1).flatMap((target, index) => {
            const previous = nodes[index];
            return previous === undefined ? [] : [edge(previous.id, target.id)];
          });
          const first = projectGraph(
            normalizeGraphSource(source(nodes, edges)),
            defaultGraphQuery({ kind: "workspace" }),
          );
          const second = projectGraph(
            normalizeGraphSource(source(nodes.toReversed(), [...edges.toReversed(), ...edges])),
            defaultGraphQuery({ kind: "workspace" }),
          );
          expect(second).toEqual(first);
        },
      ),
    );
  });

  it("converges for 1,000 mixed canonical add, remove, rename, move, convert and restore states", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            present: fc.boolean(),
            renamed: fc.boolean(),
            moved: fc.boolean(),
            converted: fc.boolean(),
            restored: fc.boolean(),
            related: fc.boolean(),
          }),
          { minLength: 2, maxLength: 30 },
        ),
        (operations) => {
          const nodes = operations.flatMap((operation, index) => {
            if (!operation.present) return [];
            const id = stableUuid(index + 1);
            const parentIds = operation.moved && index > 0 ? [stableUuid(1)] : [];
            return [
              node(operation.renamed ? `Renamed ${index}` : `Item ${index}`, {
                id,
                canonicalKind: operation.converted ? "folder" : "page",
                kind: operation.converted ? "folder" : "page",
                lifecycle: operation.restored ? "active" : "trashed",
                parentIds,
              }),
            ];
          });
          const present = new Set(nodes.map(({ id }) => id));
          const edges = operations.flatMap((operation, index) => {
            const sourceId = stableUuid(index + 1);
            const targetId = stableUuid(((index + 1) % operations.length) + 1);
            return operation.related && present.has(sourceId) && present.has(targetId)
              ? [edge(sourceId, targetId, { id: `mixed-${index}` })]
              : [];
          });
          const query = defaultGraphQuery({ kind: "workspace" });
          query.filters.lifecycle = "including-trashed";
          query.filters.includeIsolated = true;
          const first = projectGraph(normalizeGraphSource(source(nodes, edges)), query);
          const second = projectGraph(
            normalizeGraphSource(source(nodes.toReversed(), [...edges.toReversed(), ...edges])),
            query,
          );
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
