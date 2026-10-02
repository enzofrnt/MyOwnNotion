import type { DatabaseProperty, DatabaseView } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { viewColumns, visibleViewColumns } from "../src/features/databases/view-columns.ts";

const title = {
  id: "01a00000-0000-7000-8000-000000000001",
  name: "Titre",
  type: "title",
  positionKey: "a",
  state: "active",
  config: {},
} as DatabaseProperty;
const status = {
  id: "01a00000-0000-7000-8000-000000000002",
  name: "État",
  type: "status",
  positionKey: "b",
  state: "active",
  config: { options: [] },
} as DatabaseProperty;

describe("view columns", () => {
  it("shows a property the view has not listed yet, and keeps an explicit hide", () => {
    const presentations: DatabaseView["properties"] = [
      { propertyId: title.id, positionKey: "a", visible: true },
      { propertyId: status.id, positionKey: "b", visible: false },
    ];
    const extra = {
      ...status,
      id: "01a00000-0000-7000-8000-000000000003",
      name: "Priorité",
      positionKey: "c",
    } as DatabaseProperty;
    expect(
      visibleViewColumns([title, status, extra], presentations).map((property) => property.name),
    ).toEqual(["Titre", "Priorité"]);
    expect(
      viewColumns([title, status, extra], presentations).map((column) => column.visible),
    ).toEqual([true, false, true]);
  });

  it("keeps the title visible even when the view tries to hide it", () => {
    const presentations: DatabaseView["properties"] = [
      { propertyId: title.id, positionKey: "a", visible: false },
    ];
    expect(visibleViewColumns([title], presentations).map((property) => property.id)).toEqual([
      title.id,
    ]);
  });
});
