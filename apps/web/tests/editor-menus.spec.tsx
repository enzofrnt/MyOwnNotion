import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { buildCustomSlashMenuItems } from "../src/features/editor/editor-menus/slash-menu.tsx";
import { FR_COPY } from "../src/ui/copy/fr.ts";

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

    expect(toolbar).toContain('data-testid="open-page-link-picker"');
    expect(toolbar).toContain('data-testid="open-web-bookmark-dialog"');
    expect(pageEditor).toContain("<PageLinkPicker");
    expect(pageEditor).toContain("<WebBookmarkDialog");
    expect(pageEditor).not.toContain("<LinkEditorDialog");
    const onPageLink = vi.fn();
    const onWebBookmark = vi.fn();
    const editor = {
      getTextCursorPosition: () => ({
        block: { id: "link-block", type: "paragraph", content: [] },
      }),
      updateBlock: vi.fn(),
      setTextCursorPosition: vi.fn(),
    };
    const items = buildCustomSlashMenuItems({
      editor,
      onCreatePageLink: onPageLink,
      onCreateWebBookmark: onWebBookmark,
    });
    const pageLink = items.find(({ title }) => title === FR_COPY.editor.slashMenu.pageLink.title);
    const webLink = items.find(({ title }) => title === FR_COPY.editor.slashMenu.webBookmark.title);
    if (pageLink === undefined || webLink === undefined)
      throw new Error("Explicit link actions are missing");
    pageLink.onItemClick();
    expect(onPageLink).toHaveBeenCalledOnce();
    expect(onWebBookmark).not.toHaveBeenCalled();
    webLink.onItemClick();
    expect(onWebBookmark).toHaveBeenCalledWith("link-block");
  });
});
