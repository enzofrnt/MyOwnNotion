import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("explicit editor link actions", () => {
  it("exposes separate page and Web actions without mounting the unified dialog", () => {
    const toolbar = readFileSync(
      new URL("../src/features/editor/editor-menus/formatting-toolbar.tsx", import.meta.url),
      "utf8",
    );
    const pageEditor = readFileSync(
      new URL("../src/features/editor/page-editor.tsx", import.meta.url),
      "utf8",
    );
    const slash = readFileSync(
      new URL("../src/features/editor/editor-menus/slash-menu.tsx", import.meta.url),
      "utf8",
    );

    expect(toolbar).toContain('data-testid="open-page-link-picker"');
    expect(toolbar).toContain('data-testid="open-web-bookmark-dialog"');
    expect(pageEditor).toContain("<PageLinkPicker");
    expect(pageEditor).toContain("<WebBookmarkDialog");
    expect(pageEditor).not.toContain("<LinkEditorDialog");
    expect(slash).toContain("slashMenu.pageLink");
    expect(slash).toContain("slashMenu.webBookmark");
  });
});
