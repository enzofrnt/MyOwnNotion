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
    expect(source).toContain('<AppIcon name="paperclip"');
    expect(source).toContain("data-testid={`children-");
    expect(source).toContain("node.item.name");
  });

  it("traces the navigation implementation back to the versioned approved prototype", () => {
    const tasks = readFileSync(
      new URL("../../../specs/017-v1-notion-like-workspace/tasks.md", import.meta.url),
      "utf8",
    );
    const prototype = readFileSync(
      new URL(
        "../../../specs/017-v1-notion-like-workspace/assets/sidebar-attachments-v3.html",
        import.meta.url,
      ),
      "utf8",
    );
    const css = readFileSync(
      new URL("../src/features/navigation/navigation.css", import.meta.url),
      "utf8",
    );

    expect(tasks).toContain("assets/sidebar-attachments-v3.html");
    expect(prototype).toContain("data-sidebar-close");
    expect(prototype).toContain('data-lucide="paperclip"');
    expect(prototype).toContain("transition: max-height 210ms ease");
    expect(prototype).toContain("transform: rotate(45deg)");
    expect(css).toMatch(
      /\.navigation-item-actions\[data-inline-open="true"\][^{]*\.workspace-page-attachments-trigger[^}]*visibility:\s*hidden/u,
    );
    expect(prototype).toMatch(/\.mn-v3-create-surface\s*\{[^}]*width:\s*30px/u);
    expect(prototype).toMatch(
      /\.mn-v3-row\.is-create-open\s+\.mn-v3-create-surface\s*\{[^}]*width:\s*88px/u,
    );
    expect(prototype).toMatch(/\.mn-v3-create-surface\s*\{[^}]*box-shadow:\s*none/u);
    expect(prototype).toMatch(
      /\.mn-v3-row\.is-create-open\s+\.mn-v3-create-surface\s*\{[^}]*background:\s*light-dark/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.navigation-inline-create__surface\s*\{[^}]*width:\s*5\.5rem/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.navigation-inline-create__surface\s*\{[^}]*box-shadow:\s*none/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.navigation-inline-create__surface\s*\{[^}]*background:\s*var\(--ui-color-surface-hover\)/u,
    );
    expect(css).not.toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.navigation-inline-create__surface\s*\{[^}]*border-color:\s*var\(--color-border\)/u,
    );
  });
});
