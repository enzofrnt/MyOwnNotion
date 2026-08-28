import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("hierarchy item identity geometry", () => {
  it("uses the shared identity slot and never restores a disclosure spacer for leaves", () => {
    const source = readFileSync(
      new URL("../src/features/hierarchy/hierarchy-explorer.tsx", import.meta.url),
      "utf8",
    );
    const css = readFileSync(
      new URL("../src/features/navigation/navigation.css", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<TreeItemIdentitySlot");
    expect(source).not.toContain("tree-twisty--leaf");
    expect(css).toContain(".tree-item-identity-slot");
    expect(css).toMatch(/\.tree-item-identity-slot\s*\{[^}]*position:\s*relative/u);
    expect(css).toMatch(/\.tree-item-identity-slot\s*\{[^}]*width:/u);
    expect(css).toMatch(/\.tree-item-identity-slot \.tree-twisty\s*\{[^}]*position:\s*absolute/u);
  });

  it("uses the row as the drag surface and orders its contextual actions", () => {
    const source = readFileSync(
      new URL("../src/features/hierarchy/hierarchy-explorer.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("TreeDragHandle");
    expect(source).toContain("rowDragListeners");
    expect(source).toContain("data-attachments-open");
    expect(source).toContain("<NavigationInlineCreate");

    const attachments = source.indexOf('className="workspace-page-attachments-trigger"');
    const creation = source.indexOf("<NavigationInlineCreate");
    const menu = source.indexOf("<NavigationItemMenu");
    expect(attachments).toBeGreaterThan(-1);
    expect(creation).toBeGreaterThan(attachments);
    expect(menu).toBeGreaterThan(creation);
  });

  it("keeps attachment and child regions collapsible and renders folder identity in the canvas", () => {
    const source = readFileSync(
      new URL("../src/features/hierarchy/hierarchy-explorer.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<CollapsibleRegion");
    expect(source).toContain("compact");
    expect(source).toContain('selectedItem.kind === "folder"');
    expect(source).toContain('kind="folder"');
  });
});
