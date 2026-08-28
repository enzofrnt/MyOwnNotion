import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { resolvePageLinkPresentation } from "../src/features/editor/page-link-inline-content.ts";

function item(name: string, parentItemId: string | null, icon: string | null): ProjectedItem {
  return {
    id: generateUuidV7(),
    kind: "page",
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
});
