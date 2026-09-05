import { describe, expect, it } from "vitest";
import {
  type DomainResult,
  normalizeCivilDate,
  normalizeDecimal,
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
