import { describe, expect, it } from "vitest";
import {
  databasePageShowsLinkArrow,
  databasePageTitleMode,
  databasePageTrashWarning,
  linkedDatabasePageName,
  MISSING_DATA_SOURCE_MESSAGE,
  viewDeletionOffer,
} from "../../src/databases/source-lifecycle.ts";

describe("source lifecycle", () => {
  it("names a page that only displays an existing source", () => {
    expect(linkedDatabasePageName("  Courses  ")).toBe("Vue de Courses");
    expect(linkedDatabasePageName("   ")).toBe("Vue de source");
  });

  it("uses the source title for one source and the page title when several are shown", () => {
    expect(databasePageTitleMode(0)).toBe("source");
    expect(databasePageTitleMode(1)).toBe("source");
    expect(databasePageTitleMode(2)).toBe("page-and-source");
  });

  it("marks a database page with no owned source", () => {
    expect(databasePageShowsLinkArrow(0)).toBe(true);
    expect(databasePageShowsLinkArrow(1)).toBe(false);
  });

  it("asks to delete the source only for its last view on the origin page", () => {
    expect(
      viewDeletionOffer({
        currentPageId: "origin",
        sourceOriginPageId: "origin",
        activeViewsOfSourceOnCurrentPage: 1,
      }),
    ).toBe("view-or-source");
    expect(
      viewDeletionOffer({
        currentPageId: "origin",
        sourceOriginPageId: "origin",
        activeViewsOfSourceOnCurrentPage: 2,
      }),
    ).toBe("view-only");
    expect(
      viewDeletionOffer({
        currentPageId: "other",
        sourceOriginPageId: "origin",
        activeViewsOfSourceOnCurrentPage: 1,
      }),
    ).toBe("view-only");
  });

  it("states how many owned sources a deleted database page will remove", () => {
    expect(databasePageTrashWarning(0)).toBeNull();
    expect(databasePageTrashWarning(3)).toBe(
      "Cette page contient 3 sources de données. Sa suppression entraînera également la suppression de ces sources et pourra affecter les vues qui les utilisent ailleurs. Voulez-vous continuer ?",
    );
    expect(databasePageTrashWarning(1)).toContain("1 source de données");
    expect(databasePageTrashWarning(1)).toContain("cette source");
  });

  it("keeps the missing-source sentence stable", () => {
    expect(MISSING_DATA_SOURCE_MESSAGE).toBe(
      "Aucun résultat : la source de données demandée n'existe plus.",
    );
  });
});
