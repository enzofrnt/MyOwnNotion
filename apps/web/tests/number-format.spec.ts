import { DEFAULT_NUMBER_CONFIG, numberConfigOf } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  formatDatabaseNumber,
  numberFormatLabel,
} from "../src/features/databases/number-format.ts";

function config(overrides: Partial<typeof DEFAULT_NUMBER_CONFIG> = {}) {
  return { ...DEFAULT_NUMBER_CONFIG, ...overrides };
}

describe("database number display", () => {
  it("formats plain numbers without grouping and keeps the fraction", () => {
    expect(formatDatabaseNumber("1234.5", config())).toBe("1234,5");
    expect(formatDatabaseNumber("-0.25", config())).toBe("-0,25");
  });

  it("formats separators, percentages, currencies and fixed decimals", () => {
    expect(formatDatabaseNumber("1234", config({ format: "number_with_separators" }))).toMatch(
      /^1.?234$/u,
    );
    expect(formatDatabaseNumber("0.125", config({ format: "percent" }))).toContain("%");
    expect(formatDatabaseNumber("1234.5", config({ format: "euro" }))).toContain("€");
    expect(formatDatabaseNumber("1234.5", config({ decimals: 2 }))).toBe("1234,50");
    expect(formatDatabaseNumber("1234.5", config({ format: "yen" }))).toContain("JPY");
  });

  it("labels the Notion formats", () => {
    expect(numberFormatLabel("number")).toBe("Nombre");
    expect(numberFormatLabel("number_with_separators")).toBe("Nombre avec séparateurs");
    expect(numberFormatLabel("percent")).toBe("Pourcentage");
    expect(numberFormatLabel("euro")).toContain("EUR");
  });

  it("falls back to defaults for legacy number properties", () => {
    expect(
      numberConfigOf({
        id: "00000000-0000-7000-8000-000000000000",
        name: "Montant",
        positionKey: "a",
        state: "active",
        type: "number",
        config: {},
      } as never),
    ).toEqual(DEFAULT_NUMBER_CONFIG);
  });
});
