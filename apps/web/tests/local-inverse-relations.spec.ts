import type { DatabaseDefinition, Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { withInverseRelationTargets } from "../src/features/databases/local-inverse-relations.ts";
import type { LocalContentService } from "../src/services/local-content.ts";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}` as Uuid;
const owner = id(1);
const sourceA = id(2);
const sourceB = id(3);
const partnerProperty = id(10);
const inverseProperty = id(11);

const definition = {
  databaseId: sourceB,
  properties: [
    {
      id: inverseProperty,
      name: "Inverse",
      type: "relation",
      positionKey: "a",
      state: "active",
      config: {
        cardinality: "many",
        targetSourceId: sourceA,
        reciprocalPropertyId: partnerProperty,
      },
    },
  ],
} as unknown as DatabaseDefinition;

describe("inverse relation read", () => {
  it("reads the partner's edges by target and keeps the outgoing ones", async () => {
    const target = id(20);
    const getIncomingDatabaseRelationTargets = vi.fn(
      async () => new Map([[target, [id(30), id(31)]]]),
    );
    const service = { getIncomingDatabaseRelationTargets } as unknown as LocalContentService;
    const outgoing = new Map([[target, { [id(40)]: [id(41)] }]]);
    const merged = await withInverseRelationTargets({
      service,
      source: { itemId: owner, sourceId: sourceB, definition },
      entryIds: [target],
      relations: outgoing,
    });
    expect(getIncomingDatabaseRelationTargets).toHaveBeenCalledWith(sourceA, partnerProperty, [
      target,
    ]);
    expect(merged.get(target)).toEqual({ [id(40)]: [id(41)], [inverseProperty]: [id(30), id(31)] });
    // The caller's own map is not mutated.
    expect(outgoing.get(target)).toEqual({ [id(40)]: [id(41)] });
  });

  it("does nothing when the source has no two-way relation", async () => {
    const getIncomingDatabaseRelationTargets = vi.fn();
    const service = { getIncomingDatabaseRelationTargets } as unknown as LocalContentService;
    const relations = new Map();
    const merged = await withInverseRelationTargets({
      service,
      source: {
        itemId: owner,
        sourceId: sourceB,
        definition: { ...definition, properties: [] } as unknown as DatabaseDefinition,
      },
      entryIds: [id(20)],
      relations,
    });
    expect(merged).toBe(relations);
    expect(getIncomingDatabaseRelationTargets).not.toHaveBeenCalled();
  });
});
