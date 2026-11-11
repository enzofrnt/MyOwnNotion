import { describe, expect, it } from "vitest";
import {
  evaluateFormula,
  FORMULA_FUNCTION_NAMES,
  formatFormulaValue,
  formulaTypeLabel,
} from "../src/features/databases/formula.ts";
import { FORMULA_CATALOG } from "../src/features/databases/formula-catalog.ts";

const context = { title: "Ligne", properties: [], values: {}, relationTargets: {}, now: 0 };

describe("formula presentation", () => {
  it("formats values in French", () => {
    expect(formatFormulaValue(22)).toBe("22");
    expect(formatFormulaValue(true)).toBe("Oui");
    expect(formatFormulaValue(null)).toBe("—");
    expect(formatFormulaValue([1, "a", false])).toBe("1, a, Non");
    const date = evaluateFormula('parseDate("2026-11-06")', context);
    expect(date.ok && formatFormulaValue(date.value)).toContain("2026");
    expect(formulaTypeLabel(4)).toBe("numéro");
    expect(formulaTypeLabel([])).toBe("liste");
  });

  it("only documents functions the evaluator supports, with working examples", () => {
    const names = new Set(FORMULA_FUNCTION_NAMES);
    const keys = new Set<string>();
    for (const group of FORMULA_CATALOG) {
      for (const entry of group.entries) {
        expect(keys.has(entry.key), entry.key).toBe(false);
        keys.add(entry.key);
        if (entry.callable) {
          expect(names.has(entry.insert.slice(0, -2).toLowerCase()), entry.name).toBe(true);
        }
        for (const example of entry.examples) {
          expect(evaluateFormula(example, context), example).toMatchObject({ ok: true });
        }
      }
    }
  });
});
