import { describe, expect, it } from "vitest";
import {
  type DatabaseProperty,
  type DomainResult,
  isPropertyValueCompatible,
  normalizeCivilDate,
  normalizeDecimal,
  normalizeEntryValueMap,
  normalizeInstant,
  normalizePropertyValue,
  normalizeRelationTargets,
} from "../../src/index.ts";
import { baseProperties, IDS } from "./fixtures.ts";

function unwrap<T>(result: DomainResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error.code);
  }
  return result.value;
}

const property = (type: ReturnType<typeof baseProperties>[number]["type"]) => {
  const found = baseProperties().find((candidate) => candidate.type === type);
  if (found === undefined) throw new Error(`missing fixture property ${type}`);
  return found;
};

describe("canonical structured values", () => {
  it("refuses malformed typed values instead of coercing or discarding fields", () => {
    const cases: [Parameters<typeof property>[0], unknown][] = [
      ["text", null],
      ["text", []],
      ["text", "raw"],
      ["text", { kind: "text", value: 7 }],
      ["text", { kind: "text", value: "private", extra: "discarded" }],
      ["number", { kind: "number", decimal: 2 }],
      ["date", { kind: "date", date: "2026-13-01" }],
      ["date", { kind: "instant", instant: "2026-09-01T00:00:00Z" }],
      ["date", { kind: "date", date: "2026-09-01", extra: true }],
      ["status", { kind: "select", optionId: IDS.todo }],
      ["select", { kind: "select", optionId: IDS.todo }],
      ["select", { kind: "select", optionId: "invalid" }],
      ["select", { kind: "select", optionId: IDS.high, extra: true }],
      ["multi-select", { kind: "multi-select", optionIds: IDS.todo }],
      ["multi-select", { kind: "multi-select", optionIds: [IDS.todo, null] }],
      ["multi-select", { kind: "multi-select", optionIds: [IDS.high] }],
      ["multi-select", { kind: "multi-select", optionIds: [IDS.todo], extra: true }],
      ["checkbox", { kind: "checkbox", checked: 0 }],
      ["checkbox", { kind: "checkbox", checked: "false" }],
      ["checkbox", { kind: "checkbox", checked: false, extra: true }],
      ["title", { kind: "text", value: "must use title storage" }],
      ["relation", { kind: "relation", targetIds: [IDS.relationA] }],
    ];
    for (const [type, value] of cases) {
      expect(
        normalizePropertyValue(property(type), value),
        `${type}/${JSON.stringify(value)}`,
      ).toMatchObject({
        ok: false,
        error: { code: "validation.invalid-payload" },
      });
    }
    const instant = {
      ...property("date"),
      type: "date" as const,
      config: { mode: "instant" as const },
    };
    for (const value of [
      { kind: "date", date: "2026-09-01" },
      { kind: "instant", instant: "2026-09-01" },
      { kind: "instant", instant: 4 },
    ]) {
      expect(normalizePropertyValue(instant, value).ok).toBe(false);
    }
  });

  it("preserves retired fields and set identities for historical decoding while refusing new writes", () => {
    const retiredText = { ...property("text"), state: "retired" as const };
    const text = { kind: "text", value: "historical" } as const;
    expect(normalizePropertyValue(retiredText, text).ok).toBe(false);
    expect(unwrap(normalizePropertyValue(retiredText, text, { intent: "decode" }))).toEqual(text);
    const multi = property("multi-select");
    if (multi.type !== "multi-select") throw new Error("Invalid fixture");
    const retired = {
      ...multi,
      config: {
        options: multi.config.options.map((option) => ({ ...option, state: "retired" as const })),
      },
    };
    const value = { kind: "multi-select", optionIds: [IDS.doing, IDS.todo, IDS.doing] };
    expect(normalizePropertyValue(retired, value).ok).toBe(false);
    expect(unwrap(normalizePropertyValue(retired, value, { intent: "decode" }))).toEqual({
      kind: "multi-select",
      optionIds: [IDS.todo, IDS.doing],
    });
    const relation = { ...property("relation"), state: "retired" as const };
    expect(normalizeRelationTargets(relation, [IDS.relationB, IDS.relationA]).ok).toBe(false);
    expect(
      unwrap(
        normalizeRelationTargets(relation, [IDS.relationB, IDS.relationA], { intent: "decode" }),
      ),
    ).toEqual([IDS.relationA, IDS.relationB]);
    expect(normalizeRelationTargets(property("text"), []).ok).toBe(false);
    expect(normalizeRelationTargets(property("relation"), { target: IDS.relationA }).ok).toBe(
      false,
    );
  });

  it("rejects calendar and clock overflow rather than rolling it into another date", () => {
    expect(unwrap(normalizeCivilDate("2000-02-29"))).toBe("2000-02-29");
    for (const date of ["1900-02-29", "0000-01-01", "2026-00-01", "2026-01-00", "2026-02-29"])
      expect(normalizeCivilDate(date).ok, date).toBe(false);
    for (const instant of [
      "2026-09-01T24:00:00Z",
      "2026-09-01T00:60:00Z",
      "2026-09-01T00:00:60Z",
      "2026-09-01T00:00:00+24:00",
      "2026-09-01T00:00:00+00:60",
    ])
      expect(normalizeInstant(instant).ok, instant).toBe(false);
  });
  it.each([
    ["00012.3400", "12.34"],
    ["+0.500", "0.5"],
    ["-.50", "-0.5"],
    ["-0", "0"],
    ["42.", "42"],
  ])("normalizes decimal input %s", (input, expected) => {
    expect(unwrap(normalizeDecimal(input))).toBe(expected);
  });

  it.each(["", "1,2", "1 000", "1e3", "NaN", "Infinity", "--1", "0x10"])(
    "rejects ambiguous or non-decimal input %s",
    (input) => expect(normalizeDecimal(input).ok).toBe(false),
  );

  it("validates Gregorian civil dates without crossing Date", () => {
    expect(unwrap(normalizeCivilDate("2024-02-29"))).toBe("2024-02-29");
    expect(normalizeCivilDate("2023-02-29").ok).toBe(false);
    expect(normalizeCivilDate("2024-04-31").ok).toBe(false);
    expect(normalizeCivilDate("2024-2-09").ok).toBe(false);
  });

  it("requires an explicit instant offset and stores UTC", () => {
    expect(unwrap(normalizeInstant("2026-08-20T12:34:56+02:00"))).toBe("2026-08-20T10:34:56.000Z");
    expect(unwrap(normalizeInstant("2026-08-20T10:34:56Z"))).toBe("2026-08-20T10:34:56.000Z");
    expect(normalizeInstant("2026-08-20T10:34:56").ok).toBe(false);
    expect(normalizeInstant("2026-02-30T10:34:56Z").ok).toBe(false);
  });

  it("keeps false, zero and empty text distinct from absence", () => {
    expect(unwrap(normalizePropertyValue(property("text"), { kind: "text", value: "" }))).toEqual({
      kind: "text",
      value: "",
    });
    expect(
      unwrap(normalizePropertyValue(property("number"), { kind: "number", decimal: "0.0" })),
    ).toEqual({ kind: "number", decimal: "0" });
    expect(
      unwrap(normalizePropertyValue(property("checkbox"), { kind: "checkbox", checked: false })),
    ).toEqual({ kind: "checkbox", checked: false });
    expect(unwrap(normalizePropertyValue(property("text"), undefined))).toBeUndefined();
  });

  it("normalizes option sets by identity and refuses inactive options on write", () => {
    expect(
      unwrap(
        normalizePropertyValue(property("multi-select"), {
          kind: "multi-select",
          optionIds: [IDS.doing, IDS.todo, IDS.doing],
        }),
      ),
    ).toEqual({ kind: "multi-select", optionIds: [IDS.todo, IDS.doing] });

    const status = property("status");
    if (status.type !== "status") throw new Error("invalid fixture");
    const retired = {
      ...status,
      config: {
        options: status.config.options.map((option, index) =>
          index === 0 ? { ...option, state: "retired" as const } : option,
        ),
      },
    };
    const stored = { kind: "status" as const, optionId: IDS.todo };
    expect(normalizePropertyValue(retired, stored).ok).toBe(false);
    expect(unwrap(normalizePropertyValue(retired, stored, { intent: "decode" }))).toEqual(stored);
  });

  it("validates relation identity, cardinality and deterministic order", () => {
    expect(
      unwrap(
        normalizeRelationTargets(property("relation"), [
          IDS.relationB,
          IDS.relationA,
          IDS.relationB,
        ]),
      ),
    ).toEqual([IDS.relationA, IDS.relationB]);

    const relation = property("relation");
    if (relation.type !== "relation") throw new Error("invalid fixture");
    const one = { ...relation, config: { cardinality: "one" as const } };
    expect(normalizeRelationTargets(one, [IDS.relationA, IDS.relationB]).ok).toBe(false);
    expect(normalizeRelationTargets(one, ["not-an-id"]).ok).toBe(false);
    expect(unwrap(normalizeRelationTargets(one, undefined))).toBeUndefined();
  });
});

describe("decimal normalisation edge cases", () => {
  it("rejects empty, oversized and non-numeric input", () => {
    expect(normalizeDecimal("").ok).toBe(false);
    expect(normalizeDecimal("x".repeat(513)).ok).toBe(false);
    expect(normalizeDecimal("abc").ok).toBe(false);
  });

  it("canonicalises leading plus and negative zero", () => {
    const plus = normalizeDecimal("+42.50");
    expect(plus.ok).toBe(true);
    if (plus.ok) expect(plus.value).toBe("42.5");
    const negZero = normalizeDecimal("-0");
    expect(negZero.ok).toBe(true);
    if (negZero.ok) expect(negZero.value).toBe("0");
  });
});

describe("contact property values", () => {
  const contact = (type: "url" | "email" | "phone"): DatabaseProperty => ({
    id: IDS.todo,
    name: type,
    positionKey: "a00000",
    state: "active",
    type,
    config: {},
  });

  it("trims and accepts valid contact values", () => {
    expect(
      unwrap(
        normalizePropertyValue(contact("url"), { kind: "text", value: "  https://exemple.fr/a  " }),
      ),
    ).toEqual({
      kind: "text",
      value: "https://exemple.fr/a",
    });
    expect(
      unwrap(normalizePropertyValue(contact("email"), { kind: "text", value: " nom@exemple.fr " })),
    ).toEqual({
      kind: "text",
      value: "nom@exemple.fr",
    });
    expect(
      unwrap(
        normalizePropertyValue(contact("phone"), { kind: "text", value: "+33 6 12 34 56 78" }),
      ),
    ).toEqual({
      kind: "text",
      value: "+33 6 12 34 56 78",
    });
  });

  it("refuses malformed contact values on write", () => {
    for (const [type, value] of [
      ["url", "exemple.fr"],
      ["url", "ftp://exemple.fr"],
      ["url", "   "],
      ["email", "sans-arobase"],
      ["email", "a@b"],
      ["phone", "abc"],
      ["phone", "+1"],
    ] as const) {
      expect(normalizePropertyValue(contact(type), { kind: "text", value }), value).toMatchObject({
        ok: false,
        error: { code: "validation.invalid-payload" },
      });
    }
    expect(normalizePropertyValue(contact("url"), { kind: "number", decimal: "1" }).ok).toBe(false);
  });

  it("keeps a legacy value readable when it no longer matches the format", () => {
    const legacy = { kind: "text", value: "not a url" } as const;
    expect(unwrap(normalizePropertyValue(contact("url"), legacy, { intent: "decode" }))).toEqual(
      legacy,
    );
  });

  it("treats the three types as text-compatible only", () => {
    expect(isPropertyValueCompatible(contact("url"), { kind: "text", value: "https://a.fr" })).toBe(
      true,
    );
    expect(isPropertyValueCompatible(contact("email"), { kind: "text", value: "a@b.fr" })).toBe(
      true,
    );
    expect(isPropertyValueCompatible(contact("phone"), { kind: "text", value: "+3312" })).toBe(
      true,
    );
    expect(isPropertyValueCompatible(contact("url"), { kind: "number", decimal: "1" })).toBe(false);
  });
});

describe("read-only time properties", () => {
  it("refuses a stored value and stays incompatible with any value", () => {
    const property: DatabaseProperty = {
      id: IDS.todo,
      name: "Dernière modification",
      positionKey: "a00000",
      state: "active",
      type: "last-edited-time",
      config: {},
    };
    expect(normalizePropertyValue(property, { kind: "text", value: "2026-11-04" }).ok).toBe(false);
    expect(isPropertyValueCompatible(property, { kind: "text", value: "2026-11-04" })).toBe(false);
  });

  it("refuses a stored value for the creation time too", () => {
    const property: DatabaseProperty = {
      id: IDS.todo,
      name: "Date de création",
      positionKey: "a00001",
      state: "active",
      type: "created-time",
      config: {},
    };
    expect(normalizePropertyValue(property, { kind: "text", value: "2026-11-04" }).ok).toBe(false);
    expect(isPropertyValueCompatible(property, { kind: "text", value: "2026-11-04" })).toBe(false);
  });
});

describe("files property values", () => {
  const property: DatabaseProperty = {
    id: IDS.todo,
    name: "Pièces jointes",
    positionKey: "a00000",
    state: "active",
    type: "files",
    config: {},
  };

  it("accepts unique canonical file identities", () => {
    expect(
      unwrap(normalizePropertyValue(property, { kind: "files", fileIds: [IDS.high] })),
    ).toEqual({
      kind: "files",
      fileIds: [IDS.high],
    });
  });

  it("refuses malformed, duplicated or oversized file sets", () => {
    expect(normalizePropertyValue(property, { kind: "files", fileIds: ["nope"] }).ok).toBe(false);
    expect(
      normalizePropertyValue(property, { kind: "files", fileIds: [IDS.high, IDS.high] }).ok,
    ).toBe(false);
    expect(normalizePropertyValue(property, { kind: "text", value: "x" }).ok).toBe(false);
  });
});

describe("rollup property values", () => {
  it("refuses a stored value on an aggregate property", () => {
    const property: DatabaseProperty = {
      id: IDS.todo,
      name: "Entrées liées",
      positionKey: "a00000",
      state: "active",
      type: "rollup",
      config: { relationPropertyId: IDS.relationA, aggregate: "count" },
    };
    expect(normalizePropertyValue(property, { kind: "number", decimal: "1" }).ok).toBe(false);
  });
});

describe("unique id property values", () => {
  it("refuses a stored value on an auto-numbered property", () => {
    const property: DatabaseProperty = {
      id: IDS.todo,
      name: "Identifiant",
      positionKey: "a00000",
      state: "active",
      type: "unique-id",
      config: {},
    };
    expect(normalizePropertyValue(property, { kind: "number", decimal: "1" }).ok).toBe(false);
  });
});

describe("entry value maps", () => {
  it("preserves values of retired properties during a replace", () => {
    const retired = { ...property("text"), state: "retired" as const };
    const properties = new Map([[retired.id, retired]]);
    const result = normalizeEntryValueMap(properties, {
      [retired.id]: { kind: "text", value: "historical" },
    });
    expect(unwrap(result)).toEqual({
      [retired.id]: { kind: "text", value: "historical" },
    });
  });

  it("normalizes a place value", () => {
    const place = {
      id: "018f0000-0000-7000-8000-000000000099" as never,
      name: "Lieu",
      type: "place" as const,
      positionKey: "z-place",
      state: "active" as const,
      config: {},
    };
    const properties = new Map([[place.id, place]]);
    const value = {
      kind: "place" as const,
      placeId: "ChIJIQBpAG2ahYAR_6128GcTUEo",
      name: "Paris",
      address: "Paris, France",
      latitude: 48.8566,
      longitude: 2.3522,
    };
    expect(unwrap(normalizeEntryValueMap(properties, { [place.id]: value }))).toEqual({
      [place.id]: value,
    });
  });
});

describe("files external links", () => {
  it("normalizes links and rejects non-http URLs", () => {
    const files: DatabaseProperty = {
      id: "018f0000-0000-7000-8000-0000000000f1" as never,
      name: "Fichiers",
      type: "files",
      positionKey: "z-files",
      state: "active",
      config: {},
    };
    expect(
      normalizePropertyValue(files, {
        kind: "files",
        fileIds: [],
        externalUrls: ["https://exemple.fr/a", "http://exemple.fr/b"],
      }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "files",
        fileIds: [],
        externalUrls: ["https://exemple.fr/a", "http://exemple.fr/b"],
      },
    });
    expect(
      normalizePropertyValue(files, {
        kind: "files",
        fileIds: [],
        externalUrls: ["javascript:alert(1)"],
      }).ok,
    ).toBe(false);
  });
});
