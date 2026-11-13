import type { DatabaseProperty, PlacePropertyValue, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { displayDatabaseValue } from "../src/features/databases/database-value.ts";
import { validateValueDraft } from "../src/features/databases/value-editor.tsx";

const property: DatabaseProperty = {
  id: "018f5000-0000-7000-8000-000000000201" as Uuid,
  name: "Lieu",
  type: "place",
  positionKey: "z",
  state: "active",
  config: {},
};
const place: PlacePropertyValue = {
  kind: "place",
  placeId: "ChIJIQBpAG2ahYAR_6128GcTUEo",
  name: "Paris",
  address: "Paris, France",
  latitude: 48.8566,
  longitude: 2.3522,
};

describe("place property", () => {
  it("displays the place name", () => {
    const row = {
      entryId: "018f5000-0000-7000-8000-000000000202" as Uuid,
      revisionId: "018f5000-0000-7000-8000-000000000203" as Uuid,
      title: "Voyage",
      values: { [property.id]: place },
      relationTargets: {},
      groupId: null,
    } as never;
    expect(displayDatabaseValue(row, property)).toBe("Paris");
  });

  it("validates the serialized place draft", () => {
    expect(validateValueDraft(property, JSON.stringify(place))).toMatchObject({
      ok: true,
      value: place,
    });
    expect(validateValueDraft(property, "not-json")).toMatchObject({ ok: false });
    expect(validateValueDraft(property, JSON.stringify({ ...place, latitude: 120 }))).toMatchObject(
      { ok: false },
    );
  });
});
