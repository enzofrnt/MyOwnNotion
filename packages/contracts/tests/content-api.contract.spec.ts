import { CreateItemSchema, ItemSchema, UpdateItemSchema } from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

FormatRegistry.Set("uuid", (value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value));

const item = {
  id: generateUuidV7(),
  kind: "page",
  name: "Roadmap",
  lifecycle: "active",
  currentRevisionId: generateUuidV7(),
  placements: [],
};

describe("item icon HTTP contract", () => {
  it("accepts the canonical icon and remains compatible with older responses", () => {
    expect(Value.Check(ItemSchema, { ...item, icon: "🗺️" })).toBe(true);
    expect(Value.Check(ItemSchema, { ...item, icon: null })).toBe(true);
    expect(Value.Check(ItemSchema, item)).toBe(true);
  });

  it("accepts an optional icon during page or folder creation", () => {
    expect(
      Value.Check(CreateItemSchema, {
        id: generateUuidV7(),
        kind: "folder",
        name: "Archive",
        icon: "🗄️",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      }),
    ).toBe(true);
  });

  it("distinguishes setting and removing an icon", () => {
    const baseRevisionId = generateUuidV7();
    expect(Value.Check(UpdateItemSchema, { baseRevisionId, icon: "📌" })).toBe(true);
    expect(Value.Check(UpdateItemSchema, { baseRevisionId, icon: null })).toBe(true);
    expect(Value.Check(UpdateItemSchema, { baseRevisionId, icon: 42 })).toBe(false);
    expect(Value.Check(UpdateItemSchema, { baseRevisionId })).toBe(false);
    expect(Value.Check(UpdateItemSchema, { baseRevisionId, name: "Roadmap", icon: "📌" })).toBe(
      false,
    );
  });
});
