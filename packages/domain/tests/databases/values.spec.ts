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
