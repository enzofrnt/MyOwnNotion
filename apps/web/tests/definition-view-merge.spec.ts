import { describe, expect, it } from "vitest";
import { definitionViewsPreservingPresentation } from "../src/features/databases/definition-view-merge.ts";

const sourceId = "source-1";

describe("definition views sent with a property edit", () => {
  it("keeps presentation tabs that the source definition no longer lists", () => {
    const views = definitionViewsPreservingPresentation(
      [{ id: "tableau", name: "Tableau" }],
      [
        { id: "tableau", name: "Tableau", sourceId },
        { id: "tableau-2", name: "Tableau 2", sourceId },
      ],
      "tableau",
      { id: "tableau", name: "Tableau" },
    );
    expect(views.map((view) => view.id)).toEqual(["tableau", "tableau-2"]);
    expect(views.every((view) => !("sourceId" in view))).toBe(true);
  });

  it("replaces only the open view and keeps source-only views", () => {
    const views = definitionViewsPreservingPresentation(
      [
        { id: "tableau", name: "Tableau" },
        { id: "archive", name: "Archive" },
      ],
      [{ id: "tableau", name: "Tableau", sourceId }],
      "tableau",
      { id: "tableau", name: "Tableau renommé" },
    );
    expect(views).toEqual([
      { id: "tableau", name: "Tableau renommé" },
      { id: "archive", name: "Archive" },
    ]);
  });
});
