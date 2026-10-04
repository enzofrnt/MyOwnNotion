// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeAttachmentDisclosure } from "../src/features/navigation/tree-attachment-disclosure.tsx";

describe("row-local attachment disclosure", () => {
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

  it("inspects another page's files without rerendering the parent or active editor", async () => {
    const parentRender = vi.fn();
    const otherRowRender = vi.fn();
    const editorRender = vi.fn();
    const unmountEditor = vi.fn();
    const { useEffect } = await import("react");
    function Editor() {
      editorRender();
      useEffect(() => unmountEditor, []);
      return <textarea defaultValue="Brouillon conservé" />;
    }
    function Workspace() {
      parentRender();
      return (
        <>
          <TreeAttachmentDisclosure activeViewId="active-page">
            {(open, toggle) => (
              <button type="button" aria-expanded={open} onClick={toggle}>
                Pièces jointes d'une autre page
              </button>
            )}
          </TreeAttachmentDisclosure>
          <TreeAttachmentDisclosure activeViewId="active-page">
            {() => {
              otherRowRender();
              return <span>Autre page</span>;
            }}
          </TreeAttachmentDisclosure>
          <Editor />
        </>
      );
    }
    await act(async () => root.render(<Workspace />));
    const editor = container.querySelector("textarea");
    const trigger = container.querySelector("button");
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(parentRender).toHaveBeenCalledTimes(1);
    expect(otherRowRender).toHaveBeenCalledTimes(1);
    expect(editorRender).toHaveBeenCalledTimes(1);
    expect(unmountEditor).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBe(editor);
    expect(editor?.value).toBe("Brouillon conservé");
  });

  it("closes on leaving the page and stays closed when returning", async () => {
    const render = async (activeViewId: string | null) => {
      await act(async () =>
        root.render(
          <TreeAttachmentDisclosure activeViewId={activeViewId}>
            {(open, toggle) => (
              <button type="button" aria-expanded={open} onClick={toggle}>
                Pièces jointes
              </button>
            )}
          </TreeAttachmentDisclosure>,
        ),
      );
    };
    await render("page-a");
    await act(async () => container.querySelector("button")?.click());
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    await render("page-b");
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    await render("page-a");
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => container.querySelector("button")?.click());
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    await render("graph");
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps two page inspections independent and closes both on navigation", async () => {
    const render = async (activeViewId: string) => {
      await act(async () =>
        root.render(
          ["page-a", "page-b"].map((page) => (
            <TreeAttachmentDisclosure key={page} activeViewId={activeViewId}>
              {(open, toggle) => (
                <button type="button" aria-expanded={open} onClick={toggle}>
                  Pièces jointes de {page}
                </button>
              )}
            </TreeAttachmentDisclosure>
          )),
        ),
      );
    };
    await render("page-c");
    const buttons = container.querySelectorAll("button");
    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(Array.from(buttons, (button) => button.getAttribute("aria-expanded"))).toEqual([
      "true",
      "true",
    ]);
    await act(async () => buttons[0]?.click());
    expect(buttons[1]?.getAttribute("aria-expanded")).toBe("true");
    await render("page-d");
    expect(Array.from(buttons, (button) => button.getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
    ]);
    await render("page-c");
    expect(buttons[1]?.getAttribute("aria-expanded")).toBe("false");
  });
});
