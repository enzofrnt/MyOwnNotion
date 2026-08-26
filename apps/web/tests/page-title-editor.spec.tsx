// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageTitleEditor } from "../src/features/workspace/page-title-editor.tsx";

function typeInto(title: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(title, value);
  title.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("page title editor", () => {
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
    vi.restoreAllMocks();
  });

  it("is the first large editable line and commits an empty draft as Sans titre", async () => {
    const onCommit = vi.fn(async () => undefined);
    await act(async () => {
      root.render(<PageTitleEditor title="Projet Atlas" onCommit={onCommit} />);
    });

    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    expect(title?.getAttribute("aria-label")).toBe("Titre de la page");
    expect(title?.value).toBe("Projet Atlas");

    await act(async () => {
      if (title === null) return;
      title.focus();
      typeInto(title, "");
      title.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledWith("Sans titre");
  });

  it("does not replace the draft or cursor when a remote title arrives during editing", async () => {
    const onCommit = vi.fn(async () => undefined);
    await act(async () => {
      root.render(<PageTitleEditor title="Avant" onCommit={onCommit} />);
    });
    const title = container.querySelector<HTMLTextAreaElement>('[data-testid="active-item-title"]');
    if (title === null) throw new Error("title editor missing");

    await act(async () => {
      title.focus();
      typeInto(title, "Brouillon local");
      title.setSelectionRange(9, 9);
      root.render(<PageTitleEditor title="Titre distant" onCommit={onCommit} />);
    });

    expect(title.value).toBe("Brouillon local");
    expect(title.selectionStart).toBe(9);
  });
});
