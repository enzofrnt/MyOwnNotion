// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCloseTabShortcut, OpenTabsStrip } from "../src/features/workspace/open-tabs-strip.tsx";

const tabs = [
  { id: "a", name: "Projets", kind: "folder" as const, icon: "📁" },
  { id: "b", name: "Feuille de route", kind: "page" as const, icon: null },
  { id: "c", name: "", kind: "page" as const },
];

describe("open tabs strip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders one tab per open item with emoji, full label and a separate close control", async () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <OpenTabsStrip tabs={tabs} activeId="b" onActivate={onActivate} onClose={onClose} />,
      );
    });
    const strip = container.querySelector('[role="tablist"]');
    expect(strip?.getAttribute("aria-label")).toBe("Éléments ouverts");
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "📁Projets",
      "Feuille de route",
      "Sans titre",
    ]);
    expect(buttons[1]?.getAttribute("aria-selected")).toBe("true");
    expect(buttons[0]?.getAttribute("aria-selected")).toBe("false");
    expect(buttons[1]?.title).toBe("Feuille de route");

    await act(async () => {
      buttons[0]?.click();
    });
    expect(onActivate).toHaveBeenCalledWith("a");

    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Fermer l’onglet Feuille de route"]',
    );
    await act(async () => {
      close?.click();
    });
    expect(onClose).toHaveBeenCalledWith("b");
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("moves focus between tabs with the arrow keys and wraps around", async () => {
    await act(async () => {
      root.render(
        <OpenTabsStrip tabs={tabs} activeId="a" onActivate={vi.fn()} onClose={vi.fn()} />,
      );
    });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const strip = container.querySelector<HTMLElement>('[role="tablist"]');
    buttons[0]?.focus();
    await act(async () => {
      strip?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[1]);
    await act(async () => {
      strip?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      strip?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("closes the active tab with ⌘W or Ctrl+W and ignores a bare W", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <OpenTabsStrip tabs={tabs} activeId="b" onActivate={vi.fn()} onClose={onClose} />,
      );
    });
    expect(isCloseTabShortcut({ key: "w", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isCloseTabShortcut({ key: "W", ctrlKey: false, metaKey: true })).toBe(true);
    expect(isCloseTabShortcut({ key: "w", ctrlKey: false, metaKey: false })).toBe(false);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", metaKey: true, bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("b");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders a graph view tab with the graph icon and a fixed label", async () => {
    const onActivate = vi.fn();
    await act(async () => {
      root.render(
        <OpenTabsStrip
          tabs={[
            { id: "graph", name: "Graphe", kind: "graph" },
            { id: "a", name: "Projets", kind: "folder", icon: "📁" },
          ]}
          activeId="graph"
          onActivate={onActivate}
          onClose={vi.fn()}
        />,
      );
    });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(buttons[0]?.textContent).toContain("Graphe");
    expect(buttons[0]?.getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      buttons[0]?.click();
    });
    expect(onActivate).toHaveBeenCalledWith("graph");
  });

  it("renders nothing when no tab is open", async () => {
    await act(async () => {
      root.render(
        <OpenTabsStrip tabs={[]} activeId={null} onActivate={vi.fn()} onClose={vi.fn()} />,
      );
    });
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
