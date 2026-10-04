import { describe, expect, it } from "vitest";
import { pageSymbolIcon, SYMBOL_ICON_CHOICES, symbolIconChoice } from "../src/ui/symbol-icons.ts";

describe("shared symbol catalog", () => {
  it("keeps one id list for pages, properties and views", () => {
    expect(SYMBOL_ICON_CHOICES.length).toBeGreaterThanOrEqual(200);
    const ids = SYMBOL_ICON_CHOICES.map((choice) => choice.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const choice of SYMBOL_ICON_CHOICES) {
      expect(choice.id).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(choice.label.trim().length).toBeGreaterThan(0);
      expect(symbolIconChoice(choice.id)?.label).toBe(choice.label);
      expect(symbolIconChoice(pageSymbolIcon(choice.id))?.id).toBe(choice.id);
    }
  });

  it("still resolves icons saved before the catalog grew", () => {
    expect(symbolIconChoice("lightbulb")?.label).toBe("ampoule");
    expect(symbolIconChoice("symbol:star")?.id).toBe("star");
    expect(symbolIconChoice("symbol:")).toBeNull();
    expect(pageSymbolIcon("folder")).toBe("symbol:folder");
  });
});
