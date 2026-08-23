import {
  asUuid,
  prepareSearchQuery,
  type SearchDocument,
  type Uuid,
  WorkspaceSearchIndex,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const ITEM_IDS = Array.from({ length: 8 }, (_, index) =>
  asUuid(`018f0000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`),
);

function revision(itemIndex: number, version: number): Uuid {
  return asUuid(`018f0000-0000-7000-800${itemIndex}-${String(version).padStart(12, "0")}`);
}

function query(raw: string) {
  const prepared = prepareSearchQuery(raw);
  if (!prepared.ok) {
    throw new Error("property generated an invalid search query");
  }
  return prepared.value;
}

const TOKEN_QUERY = query("token");
// This fixed 10,000-operation invariant is CPU-bound and runs under V8
// instrumentation in the aggregate gate. Keep its ceiling independent from
// the generic five-second unit timeout used by ordinary examples.
const SEARCH_PROPERTY_TIMEOUT_MS = 30_000;

describe("WorkspaceSearchIndex properties", () => {
  it(
    "keeps identities unique, rejects stale resurrection and preserves stable order",
    () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              itemIndex: fc.integer({ min: 0, max: ITEM_IDS.length - 1 }),
              remove: fc.boolean(),
              token: fc.integer({ min: 0, max: 12 }),
              replay: fc.boolean(),
            }),
            // 50 runs × 200 lifecycle operations gives the 10,000-operation
            // reference required by SC-005 while retaining randomized sequences.
            { minLength: 200, maxLength: 200 },
          ),
          (operations) => {
            const index = new WorkspaceSearchIndex();
            const expected = new Map<Uuid, SearchDocument>();
            const lastDocument = new Map<Uuid, SearchDocument>();

            operations.forEach((operation, offset) => {
              const itemId = ITEM_IDS[operation.itemIndex] as Uuid;
              const sourceVersion = offset + 1;
              const previous = lastDocument.get(itemId);
              if (operation.remove) {
                index.remove(itemId, sourceVersion);
                expected.delete(itemId);
                if (previous !== undefined) {
                  expect(index.upsert(previous)).toBe("ignored");
                }
              } else {
                const document: SearchDocument = {
                  itemId,
                  revisionId: revision(operation.itemIndex, sourceVersion),
                  sourceVersion,
                  kind: operation.itemIndex % 3 === 0 ? "folder" : "page",
                  title: `Shared token ${operation.token}`,
                  bodyText: `Body token ${operation.token}`,
                  properties: [],
                  conflict: false,
                };
                index.upsert(document);
                expected.set(itemId, document);
                lastDocument.set(itemId, document);
                if (operation.replay) {
                  expect(index.upsert(document)).toBe("ignored");
                }
              }

              const first = index.search(TOKEN_QUERY, { limit: 50 });
              const second = index.search(TOKEN_QUERY, { limit: 50 });
              expect(first.map(({ itemId: id }) => id)).toEqual(second.map(({ itemId: id }) => id));
              expect(new Set(first.map(({ itemId: id }) => id)).size).toBe(first.length);
              expect(new Set(first.map(({ itemId: id }) => id))).toEqual(new Set(expected.keys()));
              expect(index.size).toBe(expected.size);
            });
          },
        ),
        { numRuns: 50 },
      );
    },
    SEARCH_PROPERTY_TIMEOUT_MS,
  );
});
