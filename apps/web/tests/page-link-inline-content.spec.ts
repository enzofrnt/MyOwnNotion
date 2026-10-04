// @vitest-environment jsdom
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { blockNoteInlineToCanonical } from "../src/features/editor/blocknote-conversion.ts";
import { pageLinkHrefFor, pageLinkTargetFromHref } from "../src/features/editor/page-link-href.ts";
import {
  pageLinkFallbackLabel,
  pageLinkLabelFromElement,
  resolvePageLinkPresentation,
} from "../src/features/editor/page-link-inline-content.ts";

function item(
  name: string,
  parentItemId: string | null,
  icon: string | null,
  kind: ProjectedItem["kind"] = "page",
): ProjectedItem {
  return {
    id: generateUuidV7(),
    kind,
    name,
    icon,
    lifecycle: "active",
    placements: [{ id: generateUuidV7(), kind: "hierarchy", parentItemId, positionKey: "V" }],
  } as ProjectedItem;
}

describe("dynamic page-link presentation", () => {
  it("resolves current title and emoji without mutating the stored fallback", () => {
    const currentPageId = generateUuidV7();
    const target = item("Titre renommé", null, "🧠");

    expect(
      resolvePageLinkPresentation(target.id, "Ancien titre", currentPageId, [target]),
    ).toMatchObject({ label: "Titre renommé", icon: "🧠", reference: true, state: "active" });
  });

  it("omits the relation badge only for a direct child", () => {
    const currentPageId = generateUuidV7();
    const child = item("Sous-page", currentPageId, null);
    const elsewhere = item("Ailleurs", null, null);

    expect(
      resolvePageLinkPresentation(child.id, "Sous-page", currentPageId, [child]).reference,
    ).toBe(false);
    expect(
      resolvePageLinkPresentation(elsewhere.id, "Ailleurs", currentPageId, [elsewhere]).reference,
    ).toBe(true);
  });

  it("shows a child database with its database identity", () => {
    const currentPageId = generateUuidV7();
    const database = item("Base", currentPageId, null, "database");
    expect(
      resolvePageLinkPresentation(database.id, "Base", currentPageId, [database]),
    ).toMatchObject({
      kind: "database",
      reference: false,
    });
  });
});

describe("page-link clipboard recovery", () => {
  it("keeps the fallback label when the mention has no visible text", () => {
    expect(pageLinkFallbackLabel({ content: [] })).toBe("Sans titre");
    expect(pageLinkFallbackLabel({ content: [{ text: "  " }] })).toBe("Sans titre");
    expect(pageLinkFallbackLabel({ content: [{ text: "Dossier" }] })).toBe("Dossier");
  });

  it("reads the label from a live node-view or an empty clipboard clone", () => {
    const live = document.createElement("a");
    live.innerHTML =
      '<span class="page-link__icon"></span><span class="page-link__label">Sans titre</span>';
    expect(pageLinkLabelFromElement(live)).toBe("Sans titre");

    const empty = document.createElement("a");
    empty.innerHTML = '<span class="page-link__icon"></span><span class="page-link__label"></span>';
    expect(pageLinkLabelFromElement(empty)).toBe("Sans titre");

    const aria = document.createElement("a");
    aria.setAttribute("aria-label", "Notes (cible supprimée)");
    expect(pageLinkLabelFromElement(aria)).toBe("Notes");
  });

  it("reads a page target from an absolute clipboard href", () => {
    const targetItemId = generateUuidV7();
    expect(pageLinkTargetFromHref(pageLinkHrefFor(targetItemId))).toBe(targetItemId);
    expect(
      pageLinkTargetFromHref(`http://localhost:8080/notes/current${pageLinkHrefFor(targetItemId)}`),
    ).toBe(targetItemId);
  });

  it("keeps an empty page-link mention after a drag-shaped conversion", () => {
    const targetItemId = generateUuidV7();
    expect(
      blockNoteInlineToCanonical([{ type: "pageLink", props: { targetItemId }, content: [] }]),
    ).toEqual([{ text: "Sans titre", marks: [{ type: "pageLink", targetItemId }] }]);
  });
});
