import type { DatabaseProperty, DatabaseView } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  moveViewColumn,
  viewColumns,
  visibleViewColumns,
} from "../src/features/databases/view-columns.ts";

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

describe("reordering view columns", () => {
  it("preserves widths and hidden columns without altering the source or another view", () => {
    const properties = [title, status];
    const presentations: DatabaseView["properties"] = [
      { propertyId: title.id, positionKey: "a", visible: true, width: 260 },
      { propertyId: status.id, positionKey: "b", visible: false, width: 140 },
    ];
    const original = structuredClone(presentations);
    const moved = moveViewColumn(properties, presentations, status.id, -1);
    expect(
      moved?.map(({ propertyId, visible, width }) => ({ propertyId, visible, width })),
    ).toEqual([
      { propertyId: status.id, visible: false, width: 140 },
      { propertyId: title.id, visible: true, width: 260 },
    ]);
    expect(presentations).toEqual(original);
    expect(properties.map(({ positionKey }) => positionKey)).toEqual(["a", "b"]);
    expect(viewColumns(properties, presentations).map(({ property }) => property.id)).toEqual([
      title.id,
      status.id,
    ]);
    expect(viewColumns(properties, moved ?? []).map(({ property }) => property.id)).toEqual([
      status.id,
      title.id,
    ]);
  });
  it("refuses missing columns and movements beyond the first or last position", () => {
    expect(moveViewColumn([title, status], [], "missing", 1)).toBeNull();
    expect(moveViewColumn([title, status], [], title.id, -1)).toBeNull();
    expect(moveViewColumn([title, status], [], status.id, 1)).toBeNull();
  });
  it("includes newly added columns and keeps the title visible", () => {
    const presentations: DatabaseView["properties"] = [
      { propertyId: title.id, positionKey: "a", visible: false },
    ];
    expect(moveViewColumn([title, status], presentations, status.id, -1)).toMatchObject([
      { propertyId: status.id, visible: true },
      { propertyId: title.id, visible: true },
    ]);
  });
});
