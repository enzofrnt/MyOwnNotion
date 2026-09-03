import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ItemIcon, TreeItemIdentitySlot } from "../src/ui/item-icon.tsx";

describe("item identity icon", () => {
  it("keeps the type icon as a corner badge over the canonical emoji", () => {
    const page = renderToStaticMarkup(<ItemIcon kind="page" icon="🧠" />);
    const folder = renderToStaticMarkup(<ItemIcon kind="folder" icon="📁" />);

    expect(page).toContain("🧠");
    expect(page).toContain('data-item-emoji="true"');
    expect(page).toContain('data-item-kind-badge="page"');
    expect(page).toContain('data-icon="fileText"');
    expect(folder).toContain('data-item-kind-badge="folder"');
    expect(folder).toContain('data-icon="folder"');
    expect(renderToStaticMarkup(<ItemIcon kind="page" icon="😀" size="page" />)).not.toContain(
      "data-item-kind-badge",
    );
  });

  it("uses one stable fallback for items without an emoji", () => {
    const page = renderToStaticMarkup(<ItemIcon kind="page" icon={null} />);
    const folder = renderToStaticMarkup(<ItemIcon kind="folder" icon={null} />);
    const file = renderToStaticMarkup(<ItemIcon kind="file" icon={null} />);

    expect(page).toContain('data-icon="fileText"');
    expect(page).not.toContain("data-item-kind-badge");
    expect(folder).toContain('data-icon="folder"');
    expect(folder).not.toContain("data-item-kind-badge");
    expect(file).toContain('data-icon="file"');
    expect(file).not.toContain("data-item-kind-badge");
  });

  it("adds the reference badge without changing the item emoji", () => {
    const markup = renderToStaticMarkup(<ItemIcon kind="page" icon="📚" reference />);

    expect(markup).toContain("📚");
    expect(markup).toContain('data-item-reference="true"');
    expect(markup).toContain('data-icon="reference"');
    expect(markup).toContain('data-item-kind-badge="page"');
  });

  it("puts a branch disclosure and its item icon in the same fixed slot", () => {
    const branch = renderToStaticMarkup(
      <TreeItemIdentitySlot
        item={{ kind: "folder", icon: "📁", name: "Projets" }}
        branch
        expanded={false}
        onToggle={() => undefined}
      />,
    );
    const leaf = renderToStaticMarkup(
      <TreeItemIdentitySlot
        item={{ kind: "page", icon: null, name: "Journal" }}
        branch={false}
        expanded={false}
        onToggle={() => undefined}
      />,
    );

    expect(branch).toContain('data-branch="true"');
    expect(branch).toContain('data-testid="toggle-Projets"');
    expect(branch).toContain("📁");
    expect(leaf).not.toContain("tree-twisty");
    expect(leaf).not.toContain("tree-twisty--leaf");
    expect(leaf).toContain('data-icon="fileText"');
  });

  it("rotates one right chevron instead of replacing it with a second icon", () => {
    const closed = renderToStaticMarkup(
      <TreeItemIdentitySlot
        item={{ kind: "folder", icon: "📁", name: "Projets" }}
        branch
        expanded={false}
        onToggle={() => undefined}
      />,
    );
    const open = renderToStaticMarkup(
      <TreeItemIdentitySlot
        item={{ kind: "folder", icon: "📁", name: "Projets" }}
        branch
        expanded
        onToggle={() => undefined}
      />,
    );

    expect(closed).toContain('data-icon="chevronRight"');
    expect(open).toContain('data-icon="chevronRight"');
    expect(open).not.toContain('data-icon="chevronDown"');
    expect(closed).toContain('data-expanded="false"');
    expect(open).toContain('data-expanded="true"');
  });

  it("releases pointer focus so the hover surface cannot stick after a click", () => {
    const source = readFileSync(new URL("../src/ui/item-icon.tsx", import.meta.url), "utf8");
    expect(source).toContain("event.detail > 0");
    expect(source).toContain("event.currentTarget.blur()");
    expect(source).toContain("onDoubleClick={stopDoubleClick}");
  });
});
