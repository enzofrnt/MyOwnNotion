/**
 * Canonical feature-001 identity preservation (T010, feature 002).
 *
 * A security operation may re-encrypt, re-key, or relocate data. It may never
 * change which identities exist. These properties make that checkable in one
 * digest comparison rather than a row-by-row diff:
 *
 *   - the digest ignores row order, so a differently ordered query is not
 *     mistaken for corruption;
 *   - the digest changes for any lost, added, or duplicated identity;
 *   - identities cannot be shuffled between collections without detection;
 *   - a partial manifest can never collide with a complete one.
 */
import {
  assertIdentitiesPreserved,
  buildIdentityManifest,
  type CanonicalIdentitySets,
  diffIdentityManifests,
  IdentityPreservationError,
  partialIdentityDigest,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const uuidArbitrary = fc.uuid({ version: 7 });

const setsArbitrary: fc.Arbitrary<CanonicalIdentitySets> = fc.record({
  workspaces: fc.array(uuidArbitrary, { minLength: 1, maxLength: 1 }),
  items: fc.uniqueArray(uuidArbitrary, { maxLength: 12 }),
  revisions: fc.uniqueArray(uuidArbitrary, { maxLength: 12 }),
  mutations: fc.uniqueArray(uuidArbitrary, { maxLength: 12 }),
  fileContents: fc.uniqueArray(uuidArbitrary, { maxLength: 6 }),
});

const EMPTY_SETS: CanonicalIdentitySets = {
  workspaces: [],
  items: [],
  revisions: [],
  mutations: [],
  fileContents: [],
};

describe("manifest digest", () => {
  it("ignores the order rows came back in", () => {
    fc.assert(
      fc.property(setsArbitrary, (sets) => {
        const reversed: CanonicalIdentitySets = {
          workspaces: [...sets.workspaces].reverse(),
          items: [...sets.items].reverse(),
          revisions: [...sets.revisions].reverse(),
          mutations: [...sets.mutations].reverse(),
          fileContents: [...sets.fileContents].reverse(),
        };
        expect(buildIdentityManifest(reversed).digest).toBe(buildIdentityManifest(sets).digest);
      }),
      { numRuns: 100 },
    );
  });

  it("is stable across repeated builds of the same input", () => {
    fc.assert(
      fc.property(setsArbitrary, (sets) => {
        expect(buildIdentityManifest(sets).digest).toBe(buildIdentityManifest(sets).digest);
      }),
      { numRuns: 50 },
    );
  });

  it("changes when any identity disappears", () => {
    fc.assert(
      fc.property(
        setsArbitrary.filter((sets) => sets.items.length > 0),
        (sets) => {
          const reduced: CanonicalIdentitySets = { ...sets, items: sets.items.slice(1) };
          expect(buildIdentityManifest(reduced).digest).not.toBe(
            buildIdentityManifest(sets).digest,
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it("changes when an identity appears", () => {
    const sets = fc.sample(setsArbitrary, 1)[0] as CanonicalIdentitySets;
    const extended: CanonicalIdentitySets = {
      ...sets,
      items: [...sets.items, "018f2b7c-0000-7000-8000-0000000000ff"],
    };
    expect(buildIdentityManifest(extended).digest).not.toBe(buildIdentityManifest(sets).digest);
  });

  it("changes when an identity is duplicated, rather than absorbing it", () => {
    // A duplicated row is corruption; deduplicating would hide it.
    const id = "018f2b7c-0000-7000-8000-000000000001";
    const single = buildIdentityManifest({ ...EMPTY_SETS, items: [id] });
    const doubled = buildIdentityManifest({ ...EMPTY_SETS, items: [id, id] });
    expect(doubled.digest).not.toBe(single.digest);
    expect(doubled.counts.items).toBe(2);
  });

  it("detects an identity moved between collections", () => {
    const id = "018f2b7c-0000-7000-8000-000000000001";
    const asItem = buildIdentityManifest({ ...EMPTY_SETS, items: [id] });
    const asRevision = buildIdentityManifest({ ...EMPTY_SETS, revisions: [id] });
    expect(asItem.digest).not.toBe(asRevision.digest);
  });

  it("cannot be collided by concatenating IDs across a collection boundary", () => {
    const left = buildIdentityManifest({
      ...EMPTY_SETS,
      items: ["018f2b7c-0000-7000-8000-000000000001"],
      revisions: ["018f2b7c-0000-7000-8000-000000000002"],
    });
    const right = buildIdentityManifest({
      ...EMPTY_SETS,
      items: ["018f2b7c-0000-7000-8000-000000000001", "018f2b7c-0000-7000-8000-000000000002"],
    });
    expect(left.digest).not.toBe(right.digest);
  });

  it("records a count per collection so a diff can say where it changed", () => {
    const manifest = buildIdentityManifest({
      ...EMPTY_SETS,
      workspaces: ["018f2b7c-0000-7000-8000-000000000001"],
      items: ["018f2b7c-0000-7000-8000-000000000002"],
    });
    expect(manifest.counts).toEqual({
      workspaces: 1,
      items: 1,
      revisions: 0,
      mutations: 0,
      fileContents: 0,
    });
  });
});

describe("drift detection", () => {
  it("reports no drift for an unchanged identity set", () => {
    fc.assert(
      fc.property(setsArbitrary, (sets) => {
        expect(
          diffIdentityManifests(buildIdentityManifest(sets), buildIdentityManifest(sets)),
        ).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });

  it("names the collection and direction of every difference", () => {
    const before = buildIdentityManifest({
      ...EMPTY_SETS,
      items: ["018f2b7c-0000-7000-8000-000000000001"],
    });
    const after = buildIdentityManifest({
      ...EMPTY_SETS,
      items: ["018f2b7c-0000-7000-8000-000000000002"],
    });
    expect(diffIdentityManifests(before, after)).toEqual([
      { collection: "items", kind: "missing", id: "018f2b7c-0000-7000-8000-000000000001" },
      { collection: "items", kind: "unexpected", id: "018f2b7c-0000-7000-8000-000000000002" },
    ]);
  });

  it("throws when a security operation changed the identity set", () => {
    const before = buildIdentityManifest({
      ...EMPTY_SETS,
      workspaces: ["018f2b7c-0000-7000-8000-000000000001"],
    });
    // Recovery that mints a new workspace instead of adopting the source one.
    const after = buildIdentityManifest({
      ...EMPTY_SETS,
      workspaces: ["018f2b7c-0000-7000-8000-0000000000ff"],
    });
    expect(() => assertIdentitiesPreserved(before, after)).toThrow(IdentityPreservationError);
  });

  it("passes when only the row order changed", () => {
    const ids = ["018f2b7c-0000-7000-8000-000000000001", "018f2b7c-0000-7000-8000-000000000002"];
    const before = buildIdentityManifest({ ...EMPTY_SETS, items: ids });
    const after = buildIdentityManifest({ ...EMPTY_SETS, items: [...ids].reverse() });
    expect(() => assertIdentitiesPreserved(before, after)).not.toThrow();
  });
});

describe("partial digests", () => {
  it("treats an omitted collection as empty, never as absent", () => {
    expect(partialIdentityDigest({ items: [] })).toBe(buildIdentityManifest(EMPTY_SETS).digest);
  });

  it("never collides with a complete manifest that has more identities", () => {
    const id = "018f2b7c-0000-7000-8000-000000000001";
    expect(partialIdentityDigest({ items: [id] })).not.toBe(
      buildIdentityManifest({ ...EMPTY_SETS, items: [id], revisions: [id] }).digest,
    );
  });
});
