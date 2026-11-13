import { describe, expect, it } from "vitest";
import {
  checkFormulaSyntax,
  type DatabaseProperty,
  evaluateFormula,
  evaluateFormulaProperty,
  type FormulaContext,
  type FormulaValue,
  formulaText,
  type NonRelationPropertyValue,
  type Uuid,
} from "../../src/index.ts";

const id = (suffix: string) => `018f4000-0000-7000-8000-0000000000${suffix}` as Uuid;

function property(
  suffix: string,
  type: DatabaseProperty["type"],
  name: string,
  config: unknown = {},
): DatabaseProperty {
  return {
    id: id(suffix),
    name,
    type,
    positionKey: suffix,
    state: "active",
    config,
  } as DatabaseProperty;
}

const title = property("00", "title", "Nom");
const text = property("01", "text", "Texte");
const price = property("02", "number", "Prix");
const done = property("03", "checkbox", "Terminé");
const state = property("04", "select", "État", {
  options: [{ id: id("a1"), label: "En cours", positionKey: "a", tone: "blue", state: "active" }],
});
const tags = property("05", "multi-select", "Étiquettes", {
  options: [
    { id: id("b1"), label: "Finance", positionKey: "a", tone: "blue", state: "active" },
    { id: id("b2"), label: "Achats", positionKey: "b", tone: "red", state: "active" },
  ],
});
const due = property("06", "date", "Échéance", { mode: "date" });
const relation = property("07", "relation", "Tâches", { cardinality: "many" });
const total = property("08", "rollup", "Total", {
  relationPropertyId: relation.id,
  targetPropertyId: id("ff"),
  aggregate: "sum",
});
const double = property("09", "formula", "Double", { expression: 'prop("Total") * 2' });
const loopA = property("10", "formula", "Boucle A", { expression: 'prop("Boucle B") + 1' });
const loopB = property("11", "formula", "Boucle B", { expression: 'prop("Boucle A") + 1' });
const broken = property("12", "formula", "Cassée", { expression: "1 +" });
const usesBroken = property("13", "formula", "Dépend", { expression: 'prop("Cassée") + 1' });
const reference = property("14", "unique-id", "Référence", { prefix: "ACH" });

const values: Record<string, NonRelationPropertyValue> = {
  [text.id]: { kind: "text", value: "Bonjour" },
  [price.id]: { kind: "number", decimal: "10.5" },
  [done.id]: { kind: "checkbox", checked: true },
  [state.id]: { kind: "select", optionId: id("a1") },
  [tags.id]: { kind: "multi-select", optionIds: [id("b1"), id("b2")] },
  [due.id]: { kind: "date", date: "2026-11-06" },
};
const context: FormulaContext = {
  title: "Ligne de test",
  properties: [
    title,
    text,
    price,
    done,
    state,
    tags,
    due,
    relation,
    total,
    double,
    loopA,
    loopB,
    broken,
    usesBroken,
    reference,
  ],
  values,
  relationTargets: { [relation.id]: [id("c1"), id("c2")] },
  rollupValues: { [total.id]: 30 },
  entryNumber: 7,
  now: Date.UTC(2026, 10, 11, 12, 0, 0),
};

function value(expression: string, ctx: FormulaContext = context): FormulaValue {
  const result = evaluateFormula(expression, ctx);
  if (!result.ok) throw new Error(`${expression}: ${result.error}`);
  return result.value;
}

describe("formula evaluation", () => {
  it("reads typed properties and computes arithmetic", () => {
    expect(value('prop("Prix") * 2 + 1')).toBe(22);
    expect(value("2 ^ 3 ^ 2")).toBe(512);
    expect(value("-2 ^ 2")).toBe(-4);
    expect(value("7 % 4")).toBe(3);
    expect(value("1 / 0")).toBeNull();
  });

  it("resolves labels, booleans, the title and bare property names", () => {
    expect(value('prop("État")')).toBe("En cours");
    expect(value('if(prop("Terminé"), "Oui", "Non")')).toBe("Oui");
    expect(value('prop("Terminé") ? "Oui" : "Non"')).toBe("Oui");
    expect(value('concat(prop("Texte"), " !")')).toBe("Bonjour !");
    expect(value("Prix + 1")).toBe(11.5);
    expect(value('prop("Nom")')).toBe("Ligne de test");
    expect(value('prop("Référence")')).toBe("ACH-7");
  });

  it("matches the documented Notion cases", () => {
    expect(value("empty(0)")).toBe(true);
    expect(value('empty("")')).toBe(true);
    expect(value("empty([])")).toBe(true);
    expect(value("round(1234, -2)")).toBe(1200);
    expect(value("round(3.14159, 2)")).toBe(3.14);
    expect(value('replace("abc", "a.", "X")')).toBe("Xc");
    expect(value("map([1, 2, 3], current + index)")).toEqual([1, 3, 5]);
    expect(value('prop("Tâches").length()')).toBe(2);
    expect(value('prop("Étiquettes").includes("Finance")')).toBe(true);
    expect(value('not prop("Terminé")')).toBe(false);
    expect(value("true and not false")).toBe(true);
  });

  it("gives a rollup its computed result and keeps the relation count readable", () => {
    expect(value('prop("Total") * 12')).toBe(360);
    expect(value('prop("Double")')).toBe(60);
    expect(value('prop("Tâches") * 2')).toBe(4);
    const unavailable = evaluateFormula('prop("Total")', { ...context, rollupValues: {} });
    expect(unavailable).toMatchObject({ ok: false });
    expect(value('prop("Total")', { ...context, rollupValues: { [total.id]: null } })).toBeNull();
  });

  it("reports faults with their position instead of guessing", () => {
    expect(evaluateFormula("1 +", context)).toEqual({
      ok: false,
      error: "Expression attendue.",
      start: 2,
      end: 3,
    });
    expect(evaluateFormula('prop("Inconnu")', context)).toMatchObject({ ok: false });
    expect(evaluateFormula('bogus("Prix")', context)).toMatchObject({
      ok: false,
      start: 0,
      end: 5,
    });
    expect(evaluateFormula("if(true, 1)", context)).toMatchObject({ ok: false });
    expect(evaluateFormula('"abc', context)).toMatchObject({ ok: false });
    expect(checkFormulaSyntax("1 + (2").ok).toBe(false);
    expect(checkFormulaSyntax('prop("Prix") * 2').ok).toBe(true);
  });

  it("detects cycles and propagates a broken dependency", () => {
    expect(evaluateFormulaProperty(loopA as never, context)).toMatchObject({
      ok: false,
      error: expect.stringContaining("circulaire"),
    });
    expect(evaluateFormulaProperty(usesBroken as never, context)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Cassée"),
    });
  });

  it("only evaluates the branch it needs", () => {
    expect(value('if(true, 1, prop("Inconnu"))')).toBe(1);
    expect(value('false and prop("Inconnu")')).toBe(false);
    expect(value("ifs(false, 1, true, 2, 3)")).toBe(2);
    expect(value("ifs(false, 1, 3)")).toBe(3);
    expect(value("let(x, 4, x * x)")).toBe(16);
    expect(value("lets(a, 2, b, a + 1, a * b)")).toBe(6);
  });

  it("supports text and number functions", () => {
    expect(value('contains(prop("Texte"), "jour")')).toBe(true);
    expect(value('replaceAll(prop("Texte"), "o", "0")')).toBe("B0nj0ur");
    expect(value('padStart("7", 3, "0")')).toBe("007");
    expect(value('"a,b".split(",").join("-")')).toBe("a-b");
    expect(value('test("abc", "^a")')).toBe(true);
    expect(value('substring("Bonjour", 0, 3)')).toBe("Bon");
    expect(value("sum(1, 2, 3)")).toBe(6);
    expect(value("sum([1, 2], 3)")).toBe(6);
    expect(value("max(1, 5, 3)")).toBe(5);
    expect(value("mean([2, 4])")).toBe(3);
    expect(value("median(1, 3, 100)")).toBe(3);
    expect(value("sqrt(16) + abs(-1) + sign(-3)")).toBe(4);
    expect(value('toNumber("12") + 1')).toBe(13);
  });

  it("supports list functions", () => {
    expect(value("[3, 1, 2].sort()")).toEqual([1, 2, 3]);
    expect(value("[1, 2, 3, 4].filter(current % 2 == 0)")).toEqual([2, 4]);
    expect(value("[1, 2, 3].some(current > 2)")).toBe(true);
    expect(value("[1, 2, 3].every(current > 2)")).toBe(false);
    expect(value("[1, 2, 3].find(current > 1)")).toBe(2);
    expect(value("[1, 1, 2].unique()")).toEqual([1, 2]);
    expect(value("[[1], [2, 3]].flat().at(-1)")).toBe(3);
    expect(value("[1, 2, 3].reverse().first()")).toBe(3);
    expect(value("[1, 2, 3].slice(1).last()")).toBe(3);
  });

  it("supports date functions", () => {
    expect(formulaText(value('dateAdd(prop("Échéance"), 2, "days")'))).toBe("2026-11-08");
    expect(formulaText(value('dateSubtract(prop("Échéance"), 1, "month")'))).toBe("2026-10-06");
    expect(value('dateBetween(parseDate("2026-11-10"), prop("Échéance"), "days")')).toBe(4);
    expect(value('dateBetween(prop("Échéance"), parseDate("2026-11-10"), "days")')).toBe(-4);
    expect(value('year(prop("Échéance")) * 100 + month(prop("Échéance"))')).toBe(202611);
    expect(value('date(prop("Échéance"))')).toBe(6);
    expect(value('day(prop("Échéance"))')).toBe(5);
    expect(value('formatDate(prop("Échéance"), "DD/MM/YYYY")')).toBe("06/11/2026");
    expect(value('prop("Échéance") < now()')).toBe(true);
    expect(formulaText(value("today()"))).toMatch(/^2026-11-1[12]$/u);
    expect(
      formulaText(value('dateEnd(dateRange(prop("Échéance"), parseDate("2026-11-20")))')),
    ).toBe("2026-11-20");
  });

  it("bounds the cost of an expression", () => {
    expect(evaluateFormula('repeat("ab", 100000)', context)).toMatchObject({ ok: false });
    expect(evaluateFormula('padStart("a", 999999999, "b").length()', context)).toMatchObject({
      ok: true,
    });
    const deep = `${"(".repeat(5000)}1${")".repeat(5000)}`;
    expect(() => evaluateFormula(deep, context)).not.toThrow();
  });
});
