/**
 * The ambiguity surface states both intentions and offers exactly the two
 * outcomes (T152, FR-058). Static markup keeps this at the level of what the
 * owner can see and use; interaction wiring is covered by the journeys.
 */

import type { PageAmbiguityRecord } from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PageAmbiguityNotice,
  PageAmbiguityResolution,
} from "../src/features/sync/page-ambiguity-notice.tsx";

const AMBIGUITY_ID = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f22a1" as Uuid;

function record(kind: PageAmbiguityRecord["kind"]): PageAmbiguityRecord {
  return {
    ambiguityId: AMBIGUITY_ID,
    pageId: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f22a2",
    kind,
    status: "open",
    openedAt: "2026-08-22T06:00:00.000Z",
    recordVersion: 1,
    details: {
      logicalKey: `delete-edit:${AMBIGUITY_ID}`,
      kind: "delete-edit",
      status: "open",
      blockIds: ["0193f4a8-7c2d-7b11-8a3e-1c9d4e6f22a3"],
      sourceUpdateIds: [
        "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f22a4",
        "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f22a5",
      ],
      deletedSubtree: {
        type: "paragraph",
        id: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f22a3",
        content: [{ text: "texte supprimé ailleurs" }],
      },
      recoverableSubtree: {
        type: "paragraph",
        id: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f22a3",
        content: [{ text: "texte modifié ailleurs" }],
      },
    },
  };
}

describe("ambiguity notice", () => {
  it("renders nothing while there is nothing to decide", () => {
    const markup = renderToStaticMarkup(createElement(PageAmbiguityNotice, { records: [] }));
    expect(markup).toBe("");
  });

  it("announces a decision requirement without colour alone", () => {
    const markup = renderToStaticMarkup(
      createElement(PageAmbiguityNotice, { records: [record("delete-edit")] }),
    );
    expect(markup).toContain('data-state="attention"');
    expect(markup).toContain("Une décision est nécessaire");
    expect(markup).toContain("Suppression contre modification");
  });

  it("offers exactly the two contract outcomes for a deletion ambiguity", () => {
    const markup = renderToStaticMarkup(
      createElement(PageAmbiguityResolution, { record: record("delete-edit") }),
    );
    expect(markup).toContain("Conserver le contenu modifié");
    expect(markup).toContain("Confirmer la suppression");
    // Both intentions are described from the stored details.
    expect(markup).toContain("texte modifié ailleurs");
  });

  it("disables delete confirmation for kinds without a deletion", () => {
    const markup = renderToStaticMarkup(
      createElement(PageAmbiguityResolution, { record: record("type-transform") }),
    );
    expect(markup).toMatch(/disabled/);
    expect(markup).toContain("ne porte pas de suppression");
  });
});
