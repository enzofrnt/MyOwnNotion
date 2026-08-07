/**
 * Stable sibling-order and reorder property tests (T024, US1, FR-044).
 *
 * Order is always the lexicographic order of explicit position keys;
 * `keyBetween` must always produce a strictly ordered, valid key, and
 * arbitrary reorder sequences must never exhaust the key space.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  initialKeys,
  isValidPositionKey,
  keyBetween,
  sortSiblings,
  generateUuidV7,
  type Placement,
  type Uuid,
} from "@myownnotion/domain";

function placementWith(positionKey: string): Placement {
  return {
    id: generateUuidV7(),
    workspaceId: generateUuidV7(),
    itemId: generateUuidV7(),
    itemKind: "page",
    kind: "hierarchy",
    parentItemId: null,
    positionKey,
    removedAt: null,
  };
}

describe("position keys", () => {
  it("keyBetween(null, null) yields a valid initial key", () => {
    expect(isValidPositionKey(keyBetween(null, null))).toBe(true);
  });

  it("generated key is strictly between its bounds", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 200 }),
        (directions) => {
          // Random walk: repeatedly insert before, after, or between.
          let keys = [keyBetween(null, null)];
          for (const direction of directions) {
            keys = [...keys].sort();
            if (direction === 0) {
              const first = keys[0] as string;
              const key = keyBetween(null, first);
              expect(key < first).toBe(true);
              expect(isValidPositionKey(key)).toBe(true);
              keys.push(key);
            } else if (direction === 1) {
              const last = keys[keys.length - 1] as string;
              const key = keyBetween(last, null);
              expect(key > last).toBe(true);
              expect(isValidPositionKey(key)).toBe(true);
              keys.push(key);
            } else if (keys.length >= 2) {
              const index = directions.length % (keys.length - 1);
              const before = keys[index] as string;
              const after = keys[index + 1] as string;
              if (before < after) {
                const key = keyBetween(before, after);
                expect(key > before && key < after).toBe(true);
                expect(isValidPositionKey(key)).toBe(true);
                keys.push(key);
              }
            }
          }
          // All keys stay unique.
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("initialKeys produces sorted unique keys", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (count) => {
        const keys = initialKeys(count);
        expect(keys.length).toBe(count);
        const sorted = [...keys].sort();
        expect(keys).toEqual(sorted);
        expect(new Set(keys).size).toBe(count);
      }),
      { numRuns: 25 },
    );
  });

  it("rejects invalid bounds", () => {
    expect(() => keyBetween("V", "V")).toThrow();
    expect(() => keyBetween("Z", "A")).toThrow();
    expect(() => keyBetween("é", null)).toThrow();
  });
});

describe("sibling sorting (FR-044)", () => {
  it("sortSiblings orders purely by position key then id", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 50 }),
        (lengths) => {
          let previous: string | null = null;
          const keys: string[] = [];
          for (const _length of lengths) {
            const key: string = keyBetween(previous, null);
            keys.push(key);
            previous = key;
          }
          const placements = [...keys].reverse().map(placementWith);
          const sorted = sortSiblings(placements);
          const sortedKeys = sorted.map((placement) => placement.positionKey);
          expect(sortedKeys).toEqual([...keys]);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("reordering one sibling preserves every identity (FR-044)", () => {
    const keys = initialKeys(10);
    const placements = keys.map(placementWith);
    const ids = new Set(placements.map((placement) => placement.id));
    // Move the last sibling to the front.
    const last = placements[placements.length - 1] as Placement;
    const first = sortSiblings(placements)[0] as Placement;
    const moved: Placement = {
      ...last,
      positionKey: keyBetween(null, first.positionKey),
    };
    const reordered = sortSiblings([
      ...placements.filter((placement) => placement.id !== last.id),
      moved,
    ]);
    expect(reordered[0]?.id).toBe(last.id);
    expect(new Set(reordered.map((placement) => placement.id))).toEqual(ids);
  });
});

describe("uuid v7 identities", () => {
  it("generated ids are valid, unique, and time-ordered per millisecond", () => {
    const ids: Uuid[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      ids.push(generateUuidV7());
    }
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
