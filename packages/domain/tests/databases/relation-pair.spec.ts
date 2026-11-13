import { describe, expect, it } from "vitest";
import {
  asUuid,
  type DatabaseProperty,
  inverseRelations,
  inverseTargetPropertyPairs,
  reciprocalRelationOf,
  relationPairIssue,
  validateDatabaseDefinition,
} from "../../src/index.ts";
import { definition, IDS } from "./fixtures.ts";

const relation = (
  id: string,
  config: Record<string, unknown>,
  state: "active" | "retired" = "active",
): Extract<DatabaseProperty, { type: "relation" }> =>
  ({
    id,
    name: `Relation ${id.slice(-2)}`,
    type: "relation",
    positionKey: "a",
    state,
    config: { cardinality: "many", ...config },
  }) as Extract<DatabaseProperty, { type: "relation" }>;

const A = relation(IDS.relationA, {
  targetSourceId: IDS.database,
  reciprocalPropertyId: IDS.relationB,
});
const B = relation(IDS.relationB, {
  targetSourceId: IDS.database,
  reciprocalPropertyId: IDS.relationA,
});

describe("two-way relation pair", () => {
  it("accepts a mutual pair and rejects every incoherent shape", () => {
    expect(relationPairIssue(A, B)).toBe("ok");
    expect(
      relationPairIssue(A, { ...B, config: { ...B.config, reciprocalPropertyId: IDS.relation } }),
    ).toBe("not-mutual");
    expect(
      relationPairIssue(A, { ...B, config: { cardinality: "many", targetSourceId: IDS.database } }),
    ).toBe("missing-reciprocal");
    const withoutTarget = relation(B.id, { reciprocalPropertyId: A.id });
    expect(relationPairIssue(A, withoutTarget)).toBe("missing-target");
    expect(relationPairIssue(A, { ...B, config: { ...B.config, cardinality: "one" } })).toBe(
      "cardinality",
    );
    expect(
      relationPairIssue(
        A,
        relation(
          IDS.relationB,
          { targetSourceId: IDS.database, reciprocalPropertyId: IDS.relationA },
          "retired",
        ),
      ),
    ).toBe("inactive");
    expect(
      relationPairIssue(A, {
        id: IDS.text,
        name: "T",
        type: "text",
        positionKey: "b",
        state: "active",
        config: {},
      }),
    ).toBe("not-relation");
  });

  it("resolves the partner property inside the other definition", () => {
    const other = { ...definition(), properties: [B] };
    expect(reciprocalRelationOf(A, other)?.id).toBe(B.id);
    expect(
      reciprocalRelationOf(relation(IDS.relationA, { targetSourceId: IDS.database }), other),
    ).toBeUndefined();
  });

  it("lists only the properties whose values live on the partner side", () => {
    const inverseA = relation(A.id, {
      targetSourceId: IDS.database,
      reciprocalPropertyId: B.id,
      inverseEdges: true,
    });
    const source = {
      ...definition(),
      properties: [inverseA, relation(IDS.relation, { targetSourceId: IDS.database })],
    };
    expect(inverseRelations(source)).toEqual([
      { propertyId: A.id, partnerPropertyId: B.id, partnerSourceId: IDS.database },
    ]);
    // The canonical side keeps its own edges and is not an inverse read.
    expect(inverseRelations({ ...definition(), properties: [A] })).toEqual([]);
  });

  it("keeps the field through a definition round trip and rejects malformed values", () => {
    const input = { ...definition(), properties: [...definition().properties, A, B] };
    expect(validateDatabaseDefinition(JSON.parse(JSON.stringify(input)))).toMatchObject({
      ok: true,
      value: input,
    });
    for (const reciprocalPropertyId of [null, "nope", 42, ""]) {
      const candidate = {
        ...input,
        properties: [
          ...definition().properties,
          relation(A.id, { targetSourceId: IDS.database, reciprocalPropertyId }),
          B,
        ],
      };
      expect(validateDatabaseDefinition(candidate as never).ok).toBe(false);
    }
    // A reciprocal without a known target source cannot be coherent.
    expect(
      validateDatabaseDefinition({
        ...input,
        properties: [...definition().properties, relation(A.id, { reciprocalPropertyId: B.id }), B],
      } as never).ok,
    ).toBe(false);
  });

  it("proves the targets are crossed when the owning sources are known", () => {
    const sourceA = IDS.database;
    const sourceB = asUuid("018f0000-0000-7000-8000-000000000099");
    const crossA = relation(A.id, { targetSourceId: sourceB, reciprocalPropertyId: B.id });
    const crossB = relation(B.id, { targetSourceId: sourceA, reciprocalPropertyId: A.id });
    expect(relationPairIssue(crossA, crossB, { sourceA, sourceB })).toBe("ok");
    expect(
      relationPairIssue(
        { ...crossA, config: { ...crossA.config, targetSourceId: sourceA } },
        crossB,
        { sourceA, sourceB },
      ),
    ).toBe("source-mismatch");
    expect(
      relationPairIssue(
        crossA,
        { ...crossB, config: { ...crossB.config, targetSourceId: sourceB } },
        { sourceA, sourceB },
      ),
    ).toBe("source-mismatch");
    // Without the owning sources only the shape can be judged.
    expect(relationPairIssue(crossA, crossB)).toBe("ok");
    // An auto-relation points both sides at the same source.
    const autoA = relation(A.id, { targetSourceId: sourceA, reciprocalPropertyId: B.id });
    const autoB = relation(B.id, { targetSourceId: sourceA, reciprocalPropertyId: A.id });
    expect(relationPairIssue(autoA, autoB, { sourceA, sourceB: sourceA })).toBe("ok");
  });

  it("reads inverse target pairs only from the definition of the requested source", () => {
    const sourceA = IDS.database;
    const sourceB = asUuid("018f0000-0000-7000-8000-000000000099");
    const paired = relation(A.id, {
      targetSourceId: sourceB,
      reciprocalPropertyId: B.id,
      inverseEdges: true,
    });
    const source = { ...definition(), properties: [paired] };
    expect(inverseTargetPropertyPairs(sourceA, source)).toEqual([
      { propertyId: A.id, partnerPropertyId: B.id, partnerSourceId: sourceB },
    ]);
    // The caller's source identity is not re-derived from the definition.
    expect(inverseTargetPropertyPairs(IDS.relation, source)).toEqual([
      { propertyId: A.id, partnerPropertyId: B.id, partnerSourceId: sourceB },
    ]);
    expect(inverseTargetPropertyPairs(IDS.relation, { ...definition(), properties: [B] })).toEqual(
      [],
    );
  });

  it("keeps historical relations without a reciprocal out of inverse reads", () => {
    const legacy = definition();
    const historical = legacy.properties.find((property) => property.type === "relation");
    expect(historical?.config).not.toHaveProperty("reciprocalPropertyId");
    expect(validateDatabaseDefinition(JSON.parse(JSON.stringify(legacy))).ok).toBe(true);
    expect(inverseRelations(legacy)).toEqual([]);
    expect(inverseTargetPropertyPairs(legacy.databaseId, legacy)).toEqual([]);
  });
});
