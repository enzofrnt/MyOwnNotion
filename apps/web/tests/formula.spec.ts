import type { DatabaseProperty, NonRelationPropertyValue, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { evaluateFormula, formatFormulaValue } from "../src/features/databases/formula.ts";

const id = (suffix: string) => `018f4000-0000-7000-8000-0000000000${suffix}` as Uuid;

function base(type: DatabaseProperty["type"], name: string, config: DatabaseProperty["config"]) {
  return {
    id: id(name.slice(-3).padStart(3, "0")),
    name,
    type,
    positionKey: "a",
    state: "active",
    config,
  } as DatabaseProperty;
}

const text = base("text", "Texte", {});
const number = base("number", "Prix", {});
const checkbox = base("checkbox", "Terminé", {});
const select = base("select", "État", {
  options: [{ id: id("opt"), label: "En cours", positionKey: "a", tone: "blue", state: "active" }],
});

const values: Record<string, NonRelationPropertyValue> = {
  [text.id]: { kind: "text", value: "Bonjour" },
  [number.id]: { kind: "number", decimal: "10.5" },
  [checkbox.id]: { kind: "checkbox", checked: true },
  [select.id]: { kind: "select", optionId: id("opt") },
};
const context = {
  title: "Ligne de test",
  properties: [text, number, checkbox, select],
  values,
  relationTargets: {},
};

describe("formula evaluation", () => {
  it("reads typed properties and computes arithmetic", () => {
    const result = evaluateFormula('prop("Prix") * 2 + 1', context);
    expect(result).toEqual({ ok: true, value: 22 });
    expect(formatFormulaValue(22)).toBe("22");
  });

  it("resolves select labels, booleans and the title", () => {
    expect(evaluateFormula('prop("État")', context)).toEqual({ ok: true, value: "En cours" });
    expect(evaluateFormula('if(prop("Terminé"), "Oui", "Non")', context)).toEqual({
      ok: true,
      value: "Oui",
    });
    expect(evaluateFormula('concat(prop("Texte"), " !")', context)).toEqual({
      ok: true,
      value: "Bonjour !",
    });
    expect(evaluateFormula('prop("Texte")', context)).toEqual({ ok: true, value: "Bonjour" });
  });

  it("refuses unknown properties and malformed expressions without throwing", () => {
    expect(evaluateFormula('prop("Inconnu")', context)).toMatchObject({ ok: false });
    expect(evaluateFormula('prop("Prix") *', context)).toMatchObject({ ok: false });
    expect(evaluateFormula('bogus("Prix")', context)).toMatchObject({ ok: false });
  });

  it("supports the extended text, logic and number functions", () => {
    expect(evaluateFormula('contains(prop("Texte"), "jour")', context)).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluateFormula('replaceAll(prop("Texte"), "o", "0")', context)).toEqual({
      ok: true,
      value: "B0nj0ur",
    });
    expect(evaluateFormula('padStart("7", 3, "0")', context)).toEqual({ ok: true, value: "007" });
    expect(evaluateFormula("and(true, not(false))", context)).toEqual({ ok: true, value: true });
    expect(evaluateFormula("sum(1, 2, 3)", context)).toEqual({ ok: true, value: 6 });
    expect(evaluateFormula("max(1, 5, 3)", context)).toEqual({ ok: true, value: 5 });
  });

  it("supports date functions", () => {
    expect(evaluateFormula('dateAdd("2026-11-06", 2, "days")', context)).toEqual({
      ok: true,
      value: "2026-11-08T00:00:00.000Z",
    });
    expect(evaluateFormula('dateBetween("2026-11-06", "2026-11-08", "days")', context)).toEqual({
      ok: true,
      value: 2,
    });
    const now = evaluateFormula("now()", context);
    expect(now.ok && typeof now.value === "string").toBe(true);
  });

  it("returns null for a division by zero instead of Infinity", () => {
    expect(evaluateFormula("1 / 0", context)).toEqual({ ok: true, value: null });
    expect(formatFormulaValue(null)).toBe("—");
  });
});
