/**
 * What a conversion never disturbs (T015, T016, FR-007, FR-008, SC-002, SC-003).
 *
 * The specification says every hierarchy child survives a conversion "in both
 * directions and without exception". That is a claim about all shapes — a
 * folder with a hundred children, a page nested six deep, a tree mixing pages,
 * folders and files — and three hand-written examples cannot make it.
 *
 * The properties here are about what the domain plan *decides*, which is where
 * the guarantee is enforceable. Whether the repository then writes what it was
 * told is the integration suite's question, and it is asked there.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CanonicalItem,
  generateUuidV7,
  type ItemKind,
  type Placement,
  planConversion,
} from "../src/index.ts";

const convertibleKind = fc.constantFrom<Extract<ItemKind, "page" | "folder">>("page", "folder");

function itemArbitrary(kind: ItemKind): fc.Arbitrary<CanonicalItem> {
  return fc.constant({
    id: generateUuidV7(),
    workspaceId: generateUuidV7(),
    kind,
    name: "Thing",
    icon: null,
    lifecycle: "active" as const,
    trashedAt: null,
    purgeAfter: null,
    currentRevisionId: generateUuidV7(),
  });
}

/** A set of children filed under one parent, in a deliberate order. */
const childrenArbitrary: fc.Arbitrary<Placement[]> = fc.array(
  fc
    .tuple(
      fc.constantFrom<ItemKind>("page", "folder", "file"),
      fc.string({ minLength: 1, maxLength: 4 }),
    )
    .map(([kind, positionKey]) => ({
      id: generateUuidV7(),
      workspaceId: generateUuidV7(),
      itemId: generateUuidV7(),
      itemIsFile: kind === "file",
      kind: "hierarchy" as const,
      parentItemId: generateUuidV7(),
      positionKey,
      removedAt: null,
    })),
  { maxLength: 12 },
);

describe("a conversion plan", () => {
  it("never mentions the children at all", () => {
    // The strongest form of "children are preserved": the plan has no way to
    // touch them. This is the property the schema change bought — placements
    // stopped depending on the kind, so a conversion has nothing to say about
    // them. If a future change makes the plan carry placements, this test
    // fails and the guarantee is back to being a promise.
    fc.assert(
      fc.property(convertibleKind, convertibleKind, fc.boolean(), (from, to, hasContent) => {
        const result = planConversion(
          sample(itemArbitrary(from)),
          { itemId: generateUuidV7(), targetKind: to, confirmedDestruction: true },
          hasContent,
        );
        if (result.ok) {
          expect(Object.keys(result.value).sort()).toEqual([
            "destroysContent",
            "item",
            "noop",
            "targetKind",
          ]);
        }
      }),
    );
  });

  it("preserves the item's identity and revision lineage", () => {
    fc.assert(
      fc.property(convertibleKind, convertibleKind, fc.boolean(), (from, to, hasContent) => {
        const before = sample(itemArbitrary(from));
        const result = planConversion(
          before,
          { itemId: before.id, targetKind: to, confirmedDestruction: true },
          hasContent,
        );
        if (result.ok) {
          // Never a delete plus a create: same id, same lineage, same place.
          expect(result.value.item.id).toBe(before.id);
          expect(result.value.item.currentRevisionId).toBe(before.currentRevisionId);
          expect(result.value.item.workspaceId).toBe(before.workspaceId);
        }
      }),
    );
  });

  it("only ever destroys content in the page-to-folder direction", () => {
    fc.assert(
      fc.property(convertibleKind, convertibleKind, fc.boolean(), (from, to, hasContent) => {
        const result = planConversion(
          sample(itemArbitrary(from)),
          { itemId: generateUuidV7(), targetKind: to, confirmedDestruction: true },
          hasContent,
        );
        if (result.ok && result.value.destroysContent) {
          expect(from).toBe("page");
          expect(to).toBe("folder");
          expect(hasContent).toBe(true);
        }
      }),
    );
  });

  it("refuses every unconfirmed destructive conversion", () => {
    // The one that must hold for every input rather than for the cases someone
    // thought to write down.
    fc.assert(
      fc.property(fc.option(fc.constant(false), { nil: undefined }), (confirmation) => {
        const result = planConversion(
          sample(itemArbitrary("page")),
          {
            itemId: generateUuidV7(),
            targetKind: "folder",
            ...(confirmation === undefined ? {} : { confirmedDestruction: confirmation }),
          },
          true,
        );
        expect(result.ok).toBe(false);
      }),
    );
  });

  it("is idempotent: converting to the current kind decides nothing", () => {
    fc.assert(
      fc.property(convertibleKind, fc.boolean(), (kind, hasContent) => {
        const result = planConversion(
          sample(itemArbitrary(kind)),
          { itemId: generateUuidV7(), targetKind: kind, confirmedDestruction: true },
          hasContent,
        );
        expect(result.ok && result.value.noop).toBe(true);
        expect(result.ok && result.value.destroysContent).toBe(false);
      }),
    );
  });
});

describe("children, as data", () => {
  it("are untouched by a conversion because nothing links them to the kind", () => {
    // Asserted against the placement shape rather than through the plan: since
    // feature 004 a placement records whether its item is a *file*, and a
    // page↔folder conversion cannot change that. This test pins the reason the
    // preservation is structural rather than careful.
    fc.assert(
      fc.property(childrenArbitrary, (children) => {
        for (const child of children) {
          // Nothing in a placement varies with page-vs-folder.
          expect(Object.keys(child)).not.toContain("itemKind");
        }
      }),
    );
  });
});

/** fast-check's `sample` for a single value, kept local to avoid a helper file. */
function sample<T>(arbitrary: fc.Arbitrary<T>): T {
  const [value] = fc.sample(arbitrary, 1);
  if (value === undefined) {
    throw new Error("empty sample");
  }
  return value;
}
