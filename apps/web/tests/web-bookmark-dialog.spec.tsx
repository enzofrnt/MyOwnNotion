// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeWebBookmarkUrl,
  WebBookmarkDialog,
  type WebBookmarkEditor,
  type WebBookmarkRequest,
} from "../src/features/editor/editor-menus/web-bookmark-dialog.tsx";

describe("Web bookmark dialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("accepts only HTTP(S) addresses", () => {
    expect(normalizeWebBookmarkUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(normalizeWebBookmarkUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(normalizeWebBookmarkUrl("mailto:test@example.com")).toBeNull();
    expect(normalizeWebBookmarkUrl("javascript:alert(1)")).toBeNull();
  });

  it("submits the visible URL on Enter even after a synchronization rerender", async () => {
    const insertBlocks = vi.fn();
    const removeBlocks = vi.fn();
    const editor: WebBookmarkEditor = {
      getBlock: (id) => ({ id, type: "paragraph", content: [] }),
      updateBlock: vi.fn(),
      insertBlocks,
      removeBlocks,
      focus: vi.fn(),
    };
    const request: WebBookmarkRequest = { mode: "create", anchorBlockId: "block-1" };
    const onClose = vi.fn();
    const dialog = () => <WebBookmarkDialog editor={editor} request={request} onClose={onClose} />;
    await act(async () => root.render(dialog()));
    const input = document.querySelector<HTMLInputElement>('[aria-label="Adresse Web"]');
    if (input === null) throw new Error("URL field missing");

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "example.com/document",
    );
    await act(async () => root.render(dialog()));
    expect(input.value).toBe("example.com/document");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(insertBlocks).toHaveBeenCalledWith(
      [
        {
          type: "embed",
          props: {
            provider: "bookmark",
            sourceUrl: "https://example.com/document",
            caption: "",
          },
        },
      ],
      "block-1",
      "after",
    );
    expect(removeBlocks).toHaveBeenCalledWith(["block-1"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid address without closing", async () => {
    const editor: WebBookmarkEditor = {
      getBlock: (id) => ({ id, type: "paragraph", content: [] }),
      updateBlock: vi.fn(),
      insertBlocks: vi.fn(),
      removeBlocks: vi.fn(),
      focus: vi.fn(),
    };
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <WebBookmarkDialog
          editor={editor}
          request={{ mode: "create", anchorBlockId: "block-1" }}
          onClose={onClose}
        />,
      );
    });
    const input = document.querySelector<HTMLInputElement>('[aria-label="Adresse Web"]');
    if (input === null) throw new Error("URL field missing");
    await act(async () => {
      input.value = "pas un lien";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.body.textContent).toContain("Saisissez un lien Web valide.");
    expect(onClose).not.toHaveBeenCalled();
  });
});
