import { describe, expect, it } from "vitest";
import {
  type DatabaseProperty,
  generateUuidV7,
  isPropertyValueCompatible,
  normalizeEntryValueMap,
} from "../../src/index.ts";
import { baseProperties, IDS } from "./fixtures.ts";

const properties = new Map(baseProperties().map((property) => [property.id, property]));
const date = properties.get(IDS.date);
if (date?.type !== "date") throw new Error("Expected date property");
const instant: DatabaseProperty = { ...date, config: { mode: "instant" } };

describe("structured values restored while the catalogue is loading", () => {
  it.each([
    [date, { kind: "date", date: "2026-10-07" }, true],
    [date, { kind: "instant", instant: "2026-10-07T10:00:00Z" }, false],
    [instant, { kind: "instant", instant: "2026-10-07T10:00:00Z" }, true],
    [instant, { kind: "date", date: "2026-10-07" }, false],
    [baseProperties()[0], { kind: "text", value: "title belongs to the item" }, false],
    [
      baseProperties().find((property) => property.type === "relation"),
      { kind: "text", value: "separate store" },
      false,
    ],
    [
      baseProperties().find((property) => property.type === "text"),
      { kind: "text", value: "retained" },
      true,
    ],
    [
      baseProperties().find((property) => property.type === "text"),
      { kind: "checkbox", checked: false },
      false,
    ],
  ] as const)("checks the saved value against its storage kind %#", (property, value, expected) => {
    if (!property) throw new Error("Expected fixture property");
    expect(isPropertyValueCompatible(property, value)).toBe(expected);
  });

  it.each([
    { [generateUuidV7()]: { kind: "text", value: "unknown property" } },
    { [IDS.title]: { kind: "text", value: "must not become entry values" } },
    { [IDS.relation]: { kind: "text", value: "must not become entry values" } },
    { [IDS.text]: undefined },
    { [IDS.checkbox]: { kind: "checkbox", checked: "false" } },
  ])("refuses unavailable or absent structured values without stripping them %#", (input) => {
    expect(normalizeEntryValueMap(properties, input).ok).toBe(false);
  });

  it("preserves valid empty, zero and false values in one normalized batch", () => {
    expect(
      normalizeEntryValueMap(properties, {
        [IDS.text]: { kind: "text", value: "" },
        [IDS.number]: { kind: "number", decimal: "00.00" },
        [IDS.checkbox]: { kind: "checkbox", checked: false },
      }),
    ).toEqual({
      ok: true,
      value: {
        [IDS.text]: { kind: "text", value: "" },
        [IDS.number]: { kind: "number", decimal: "0" },
        [IDS.checkbox]: { kind: "checkbox", checked: false },
      },
    });
  });
});
