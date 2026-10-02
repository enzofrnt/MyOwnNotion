import { describe, expect, it } from "vitest";
import {
  duplicateChosenViewName,
  fallbackViewName,
  isAutomaticViewName,
  nextAutomaticViewName,
  repairAutomaticViewNames,
  VIEW_TYPE_ICON,
} from "../src/features/databases/view-tab-names.ts";

describe("database view tab names", () => {
  it("names a new view from its format, without stacking numbers", () => {
    expect(nextAutomaticViewName("board", [])).toBe("Kanban");
    expect(nextAutomaticViewName("table", ["Tableau", "Tableau 2"])).toBe("Tableau 3");
    expect(nextAutomaticViewName("gallery", ["Galerie", "Galerie 3"])).toBe("Galerie 2");
  });

  it("numbers a duplicated chosen name instead of marking it as a copy", () => {
    expect(duplicateChosenViewName("Courses", [])).toBe("Courses (1)");
    expect(duplicateChosenViewName("Courses", ["Courses (1)"])).toBe("Courses (2)");
    expect(duplicateChosenViewName("Courses (1)", ["Courses (1)"])).toBe("Courses (2)");
  });

  it("keeps an automatic name and restores a cleared chosen name to the next free default", () => {
    expect(fallbackViewName("table", "Tableau", ["Tableau 2"])).toBe("Tableau");
    expect(fallbackViewName("table", "Courses", ["Tableau"])).toBe("Tableau 2");
    expect(fallbackViewName("board", "Courses", [])).toBe("Kanban");
  });

  it("treats generated names as automatic and keeps a chosen name", () => {
    expect(isAutomaticViewName("Tableau")).toBe(true);
    expect(isAutomaticViewName("Tableau 2 3 4")).toBe(true);
    expect(isAutomaticViewName("Courses")).toBe(false);
  });

  it("repairs stacked names in tab order and leaves a chosen name", () => {
    const repaired = repairAutomaticViewNames([
      { id: "a", name: "Tableau", type: "table" as const, state: "active", positionKey: "a" },
      { id: "b", name: "Tableau 2", type: "table" as const, state: "active", positionKey: "b" },
      { id: "c", name: "Tableau 2 3", type: "table" as const, state: "active", positionKey: "c" },
      { id: "d", name: "Courses", type: "board" as const, state: "active", positionKey: "d" },
      { id: "e", name: "Tableau 2 3 4", type: "table" as const, state: "active", positionKey: "e" },
    ]);
    expect(repaired?.map((view) => view.name)).toEqual([
      "Tableau",
      "Tableau 2",
      "Tableau 3",
      "Courses",
      "Tableau 4",
    ]);
    expect(VIEW_TYPE_ICON.table).toBe("viewTable");
    expect(VIEW_TYPE_ICON.board).toBe("kanban");
    expect(VIEW_TYPE_ICON.gallery).toBe("gallery");
    expect(VIEW_TYPE_ICON.calendar).toBe("calendar");
  });
});
