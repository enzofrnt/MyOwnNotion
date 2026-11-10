import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { viewColumns } from "../src/features/databases/view-columns.ts";
import {
  moveVisibilityProperty,
  previewVisibilityGroups,
  resolveVisibilityDropTarget,
  sameVisibilityTarget,
} from "../src/features/databases/visibility-drag.ts";

const ids = {
  title: generateUuidV7(),
  status: generateUuidV7(),
  date: generateUuidV7(),
  text: generateUuidV7(),
};

const properties: readonly DatabaseProperty[] = [
  { id: ids.title, name: "Titre", type: "title", positionKey: "a", state: "active", config: {} },
  {
    id: ids.status,
    name: "Statut",
    type: "status",
    positionKey: "b",
    state: "active",
    config: { options: [] },
  },
  {
    id: ids.date,
    name: "Date",
    type: "date",
    positionKey: "c",
    state: "active",
    config: { mode: "date" },
  },
  { id: ids.text, name: "Texte", type: "text", positionKey: "d", state: "active", config: {} },
] as readonly DatabaseProperty[];

/** Visible: Titre, Statut, Texte. Hidden: Date. */
const presentations: DatabaseView["properties"] = [
  { propertyId: ids.title, visible: true, positionKey: "a" },
  { propertyId: ids.status, visible: true, positionKey: "b" },
  { propertyId: ids.date, visible: false, positionKey: "c" },
  { propertyId: ids.text, visible: true, positionKey: "d" },
];

function names(columns: readonly { property: DatabaseProperty }[]): string[] {
  return columns.map((column) => column.property.name);
}

describe("visibility drag preview", () => {
  it("previews a same-group reorder at the hovered neighbour", () => {
    const columns = viewColumns(properties, presentations);
    const groups = previewVisibilityGroups(columns, {
      id: ids.status,
      target: { group: "visible", neighbourId: ids.text, side: "after" },
    });
    expect(names(groups.visible)).toEqual(["Titre", "Texte", "Statut"]);
    expect(names(groups.hidden)).toEqual(["Date"]);
  });

  it("previews a cross-group move with the destination visibility", () => {
    const columns = viewColumns(properties, presentations);
    const groups = previewVisibilityGroups(columns, {
      id: ids.date,
      target: { group: "visible", neighbourId: ids.title, side: "before" },
    });
    expect(names(groups.visible)).toEqual(["Date", "Titre", "Statut", "Texte"]);
    expect(groups.visible[0]?.visible).toBe(true);
    expect(names(groups.hidden)).toEqual([]);
  });

  it("keeps the current order when no drop target is known", () => {
    const groups = previewVisibilityGroups(viewColumns(properties, presentations), null);
    expect(names(groups.visible)).toEqual(["Titre", "Statut", "Texte"]);
    expect(names(groups.hidden)).toEqual(["Date"]);
  });
});

describe("visibility drop target", () => {
  // The dragged row is excluded, exactly like the rendered list excludes it.
  const boxes = [
    { id: ids.title, group: "visible" as const, top: 0, height: 30 },
    { id: ids.status, group: "visible" as const, top: 30, height: 30 },
    { id: ids.date, group: "hidden" as const, top: 120, height: 30 },
  ];

  it("inserts before the first row above the pointer", () => {
    expect(resolveVisibilityDropTarget(boxes, 10, ids.text)).toEqual({
      group: "visible",
      neighbourId: ids.title,
      side: "before",
    });
  });

  it("inserts after every row whose midpoint the pointer crossed", () => {
    expect(resolveVisibilityDropTarget(boxes, 50, ids.text)).toEqual({
      group: "visible",
      neighbourId: ids.status,
      side: "after",
    });
  });

  it("targets the hidden group when the pointer is over its rows", () => {
    expect(resolveVisibilityDropTarget(boxes, 130, ids.text)).toEqual({
      group: "hidden",
      neighbourId: ids.date,
      side: "before",
    });
    expect(resolveVisibilityDropTarget(boxes, 140, ids.text)).toEqual({
      group: "hidden",
      neighbourId: ids.date,
      side: "after",
    });
  });

  it("falls back to the nearest group inside the gap between sections", () => {
    expect(resolveVisibilityDropTarget(boxes, 80, ids.text)).toEqual({
      group: "visible",
      neighbourId: ids.status,
      side: "after",
    });
    expect(resolveVisibilityDropTarget(boxes, 110, ids.text)).toEqual({
      group: "hidden",
      neighbourId: ids.date,
      side: "before",
    });
  });

  it("compares targets by anchor rather than object identity", () => {
    const target = { group: "visible" as const, neighbourId: ids.title, side: "before" as const };
    expect(sameVisibilityTarget(target, { ...target })).toBe(true);
    expect(sameVisibilityTarget(target, { ...target, side: "after" })).toBe(false);
    expect(sameVisibilityTarget(target, null)).toBe(false);
  });
});

describe("visibility drop persistence", () => {
  it("reorders within the visible group", () => {
    const next = moveVisibilityProperty(properties, presentations, ids.status, {
      group: "visible",
      neighbourId: ids.text,
      side: "after",
    });
    expect(next?.map((presentation) => presentation.propertyId)).toEqual([
      ids.title,
      ids.date,
      ids.text,
      ids.status,
    ]);
    expect(next?.find((presentation) => presentation.propertyId === ids.status)?.visible).toBe(
      true,
    );
  });

  it("moves a hidden property into the visible group", () => {
    const next = moveVisibilityProperty(properties, presentations, ids.date, {
      group: "visible",
      neighbourId: ids.text,
      side: "after",
    });
    expect(next?.map((presentation) => presentation.propertyId)).toEqual([
      ids.title,
      ids.status,
      ids.text,
      ids.date,
    ]);
    expect(next?.find((presentation) => presentation.propertyId === ids.date)?.visible).toBe(true);
  });

  it("hides a property dropped into the hidden group", () => {
    const next = moveVisibilityProperty(properties, presentations, ids.text, {
      group: "hidden",
      neighbourId: ids.date,
      side: "after",
    });
    expect(next?.map((presentation) => presentation.propertyId)).toEqual([
      ids.title,
      ids.status,
      ids.date,
      ids.text,
    ]);
    expect(next?.find((presentation) => presentation.propertyId === ids.text)?.visible).toBe(false);
  });

  it("normalizes position keys in the persisted order", () => {
    const next = moveVisibilityProperty(properties, presentations, ids.status, {
      group: "visible",
      neighbourId: ids.text,
      side: "after",
    });
    expect(next?.map((presentation) => presentation.positionKey)).toEqual([
      "col-000001",
      "col-000002",
      "col-000003",
      "col-000004",
    ]);
  });

  it("returns null when the drop leaves the order unchanged", () => {
    const next = moveVisibilityProperty(properties, presentations, ids.text, {
      group: "visible",
      neighbourId: ids.date,
      side: "after",
    });
    expect(next).toBeNull();
  });
});
