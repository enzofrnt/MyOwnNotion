import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ItemIcon, TreeItemIdentitySlot } from "../src/ui/item-icon.tsx";

describe("item identity icon", () => {
  it("renders the canonical emoji instead of the fallback type icon", () => {
    const markup = renderToStaticMarkup(<ItemIcon kind="page" icon="🧠" />);

    expect(markup).toContain("🧠");
    expect(markup).toContain('data-item-emoji="true"');
    expect(markup).not.toContain('data-icon="file-text"');
  });

  it("uses one stable fallback for items without an emoji", () => {
    const page = renderToStaticMarkup(<ItemIcon kind="page" icon={null} />);
    const folder = renderToStaticMarkup(<ItemIcon kind="folder" icon={null} />);
    const file = renderToStaticMarkup(<ItemIcon kind="file" icon={null} />);

    expect(page).toContain('data-icon="fileText"');
    expect(folder).toContain('data-icon="folder"');
    expect(file).toContain('data-icon="file"');
  });

  it("adds the reference badge without changing the item emoji", () => {
    const markup = renderToStaticMarkup(<ItemIcon kind="page" icon="📚" reference />);

    expect(markup).toContain("📚");
    expect(markup).toContain('data-item-reference="true"');
    expect(markup).toContain('data-icon="reference"');
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
});
