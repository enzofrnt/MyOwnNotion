import { describe, expect, it } from "vitest";
import {
  type DatabaseProperty,
  inverseRelations,
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
    const source = {
      ...definition(),
      properties: [A, relation(IDS.relation, { targetSourceId: IDS.database })],
    };
    expect(inverseRelations(source)).toEqual([
      { propertyId: A.id, partnerPropertyId: B.id, partnerSourceId: IDS.database },
    ]);
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
});
