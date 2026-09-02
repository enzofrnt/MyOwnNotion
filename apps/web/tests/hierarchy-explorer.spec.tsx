import { readFileSync } from "node:fs";
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  resolveInitialRoutedItemId,
  resolveRoutedItemState,
} from "../src/features/hierarchy/hierarchy-explorer.tsx";

function routedItem(id: Uuid, lifecycle: ProjectedItem["lifecycle"] = "active"): ProjectedItem {
  return { id, lifecycle } as ProjectedItem;
}

describe("route-controlled hierarchy selection", () => {
  it("keeps an explicit route identity even before local hydration can resolve it", () => {
    const routeItemId = generateUuidV7();
    const previousItemId = generateUuidV7();

    expect(resolveInitialRoutedItemId(routeItemId, previousItemId, [])).toBe(routeItemId);
  });

  it("uses the last active item only for the untargeted /notes destination", () => {
    const activeId = generateUuidV7();
    const missingId = generateUuidV7();
    const items = [routedItem(activeId)];

    expect(resolveInitialRoutedItemId(null, activeId, items)).toBe(activeId);
    expect(resolveInitialRoutedItemId(null, missingId, items)).toBeNull();
  });

  it("distinguishes active, trashed, offline-unavailable and missing route targets", () => {
    const activeId = generateUuidV7();
    const trashedId = generateUuidV7();
    const missingId = generateUuidV7();
    const items = [routedItem(activeId)];
    const trash = [routedItem(trashedId, "trashed")];

    expect(resolveRoutedItemState(items, trash, activeId, true)).toBe("active");
    expect(resolveRoutedItemState(items, trash, trashedId, true)).toBe("trashed");
    expect(resolveRoutedItemState(items, trash, missingId, false)).toBe("unavailable-local");
    expect(resolveRoutedItemState(items, trash, missingId, true)).toBe("not-found");
    expect(resolveRoutedItemState(items, trash, null, true)).toBe("none");
  });
});

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
    expect(source).toContain("kind: node.item.kind");
    expect(source).toContain("icon: node.item.icon");
    expect(source).toContain("resolveTreeRowPointerAction(");
    expect(source).toContain('"click"');
    expect(source).toContain('"dblclick"');
    expect(source).toContain("folderClickScheduler");
    expect(source).toContain("subscribeProjection");
    expect(source).toContain("replaceProjectedItem");
    expect(source).toContain("classifyStructuredItem");
    expect(source).toContain("visibleWarmedPageIds");
    expect(source).toContain("holdsStructuredCanvas");
    expect(source).toContain("workspace-page-session");
    expect(source).toContain("sessionIsActive");
    expect(source).toContain("handleFolderRowPointerClick");
    expect(source).toContain('if (node.item.kind === "folder") return');
    expect(source).toContain("hidden={graphScope !== null}");
    expect(source).toContain("&& !showSelectedEntry");
    expect(source).not.toContain("service.subscribe(() =>");
    expect(source).not.toContain("structuredSelectionItemId.current !== selectedItem.id ||");

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
    expect(css).toMatch(/\.workspace-navigation \.tree-row\s*\{[^}]*cursor:\s*grab/u);
    expect(css).toContain('html[data-tree-grabbing="true"]');
    expect(css).toContain(".tree-drag-phantom");
    expect(css).toMatch(/\.tree-drag-phantom\s*\{[^}]*opacity:\s*0\.8/u);
    expect(prototype).toMatch(/\.mn-v3-row\s*\{[^}]*cursor:\s*grab/u);
    expect(css).toMatch(
      /\.navigation-item-actions\[data-inline-open="true"\][^{]*\.workspace-page-attachments-trigger[^}]*visibility:\s*hidden/u,
    );
    expect(css).toMatch(
      /\.navigation-item-actions\[data-inline-open="true"\][^{]*\.workspace-page-attachments-trigger[^}]*width:\s*0/u,
    );
    expect(prototype).toMatch(/\.mn-v3-create-surface\s*\{[^}]*width:\s*30px/u);
    expect(prototype).toMatch(
      /\.mn-v3-row\.is-create-open\s+\.mn-v3-create-surface\s*\{[^}]*width:\s*88px/u,
    );
    expect(prototype).toMatch(/\.mn-v3-create-surface\s*\{[^}]*box-shadow:\s*none/u);
    expect(prototype).toMatch(
      /\.mn-v3-row\.is-create-open\s+\.mn-v3-create-surface\s*\{[^}]*background:\s*light-dark/u,
    );
    expect(css).toMatch(/\.navigation-inline-create\s*\{[^}]*--inline-create-gutter:\s*2px/u);
    expect(css).toMatch(
      /\.navigation-inline-create\s*\{[^}]*--inline-create-slot:\s*var\(--ui-target-compact\)/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\s*\{[^}]*width:\s*var\(--inline-create-slot\)/u,
    );
    expect(css).toMatch(/\.navigation-item-menu\s*\{[^}]*width:\s*var\(--ui-target-compact\)/u);
    expect(css).toMatch(
      /\.workspace-page-attachments-trigger\[data-size="square"\]\s*\{[^}]*width:\s*var\(--ui-target-compact\)/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create__surface\s*\{[^}]*border-radius:\s*calc\(var\(--inline-create-inner-radius\) \+ var\(--inline-create-gutter\)\)/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\]\s*\{[^}]*width:\s*var\(--inline-create-open-width\)/u,
    );
    expect(css).toMatch(/\.workspace-navigation \.tree\s*\{[^}]*--tree-row-gap:\s*2px/u);
    expect(css).toMatch(
      /\.workspace-navigation \.tree\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    );
    expect(css).toMatch(
      /\.workspace-navigation \.tree ul\s*\{[^}]*margin-left:\s*calc\(var\(--space-1\) \+ 0\.75rem\)/u,
    );
    expect(css).toMatch(/\.workspace-navigation \.tree ul\s*\{[^}]*gap:\s*var\(--tree-row-gap\)/u);
    expect(css).toMatch(
      /\.tree-drop-target:has\(\+ \.workspace-page-attachments\[data-joined\]\)[^{]*\{[^}]*border-bottom-left-radius:\s*0/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.navigation-inline-create__surface\s*\{[^}]*gap:\s*var\(--inline-create-gutter\)/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.ui-button\[data-size="square"\]\s*\{[^}]*border-radius:\s*var\(--inline-create-inner-radius\)/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.navigation-inline-create__surface\s*\{[^}]*box-shadow:\s*none/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.navigation-inline-create__surface\s*\{[^}]*background:\s*var\(--ui-color-surface-hover\)/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\]\[data-closing="true"\]\s*\{[^}]*width:\s*var\(--inline-create-slot\)/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-open="true"\]:not\(\[data-closing="true"\]\)/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create\[data-closing="true"\][^{]*\.navigation-inline-create__choices\s*\{[^}]*opacity:\s*0/u,
    );
    expect(css).toMatch(
      /\.navigation-inline-create__toggle\[aria-expanded="true"\][^{]*\.ui-icon\s*\{[^}]*transform:\s*rotate\(45deg\)/u,
    );
    expect(css).toMatch(
      /\.navigation-item-actions:has\(\.navigation-inline-create\[data-open="true"\]\)[^{]*\.workspace-page-attachments-trigger/u,
    );
    expect(css).not.toMatch(
      /\.navigation-inline-create\[data-open="true"\][^{]*\.navigation-inline-create__surface\s*\{[^}]*border-color:\s*var\(--color-border\)/u,
    );
    expect(css).not.toMatch(
      /\.workspace-navigation \.tree-row\[aria-selected="true"\][^{]*width:\s*calc/u,
    );
    expect(css).toMatch(/\.tree-item-identity-slot \.tree-twisty:hover\s*\{[^}]*background:/u);
    expect(css).not.toMatch(
      /\.tree-item-identity-slot \.tree-twisty\[data-expanded="true"\][^{]*background:/u,
    );
    expect(css).toMatch(/\.collapsible-region\[data-open="true"\]\s*\{[^}]*210ms ease/u);
  });
});
