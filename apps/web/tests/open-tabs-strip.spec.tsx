// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCloseTabShortcut, OpenTabsStrip } from "../src/features/workspace/open-tabs-strip.tsx";

const tabs = [
  { id: "a", name: "Projets", kind: "folder" as const, icon: "📁" },
  { id: "b", name: "Feuille de route", kind: "page" as const, icon: null },
  { id: "c", name: "", kind: "page" as const },
];
const ignoreEmptyFocus = () => undefined;

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
        <OpenTabsStrip
          tabs={tabs}
          activeId="b"
          onActivate={onActivate}
          onClose={onClose}
          onEmptyFocus={ignoreEmptyFocus}
        />,
      );
    });
    const strip = container.querySelector('[role="toolbar"]');
    expect(strip?.getAttribute("aria-label")).toBe("Éléments ouverts");
    expect(container.querySelector('[role="tab"]')).toBeNull();
    const buttons = [...container.querySelectorAll<HTMLElement>("[data-open-tab-activate]")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "📁Projets",
      "Feuille de route",
      "Sans titre",
    ]);
    expect(buttons[1]?.getAttribute("aria-current")).toBe("page");
    expect(buttons[0]?.hasAttribute("aria-current")).toBe(false);
    expect(buttons[1]?.title).toBe("Feuille de route — glisser pour réordonner");

    await act(async () => {
      buttons[0]?.click();
    });
    expect(onActivate).toHaveBeenCalledWith("a");

    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Fermer l’onglet Feuille de route"]',
    );
    expect(close?.hasAttribute("aria-hidden")).toBe(false);
    expect(close?.tabIndex).toBe(0);
    close?.focus();
    expect(document.activeElement).toBe(close);
    await act(async () => {
      close?.click();
    });
    expect(onClose).toHaveBeenCalledWith("b");
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("moves focus between tabs with the arrow keys and wraps around", async () => {
    await act(async () => {
      root.render(
        <OpenTabsStrip
          tabs={tabs}
          activeId="a"
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onEmptyFocus={ignoreEmptyFocus}
        />,
      );
    });
    const buttons = [...container.querySelectorAll<HTMLElement>("[data-open-tab-activate]")];
    buttons[0]?.focus();
    await act(async () => {
      buttons[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[1]);
    await act(async () => {
      buttons[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      buttons[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[2]);

    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Fermer l’onglet Sans titre"]',
    );
    close?.focus();
    await act(async () => {
      close?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(close);
  });

  it("moves focus to the neighbouring destination after a focused close control disappears", async () => {
    function StatefulStrip() {
      const [openTabs, setOpenTabs] = useState(tabs);
      const [activeId, setActiveId] = useState("b");
      const close = (itemId: string): void => {
        const index = openTabs.findIndex((tab) => tab.id === itemId);
        const neighbour = openTabs[index + 1]?.id ?? openTabs[index - 1]?.id ?? null;
        setOpenTabs((current) => current.filter((tab) => tab.id !== itemId));
        if (activeId === itemId) setActiveId(neighbour);
      };
      return (
        <OpenTabsStrip
          tabs={openTabs}
          activeId={activeId}
          onActivate={setActiveId}
          onClose={close}
          onEmptyFocus={ignoreEmptyFocus}
        />
      );
    }

    await act(async () => root.render(<StatefulStrip />));
    const closeProjects = container.querySelector<HTMLButtonElement>(
      '[aria-label="Fermer l’onglet Projets"]',
    );
    closeProjects?.focus();
    await act(async () => closeProjects?.click());
    const roadmap = container.querySelector<HTMLElement>(
      '[data-open-tab-activate][data-tab-id="b"]',
    );
    expect(document.activeElement).toBe(roadmap);

    const closeRoadmap = container.querySelector<HTMLButtonElement>(
      '[aria-label="Fermer l’onglet Feuille de route"]',
    );
    closeRoadmap?.focus();
    await act(async () => closeRoadmap?.click());
    const untitled = container.querySelector<HTMLElement>(
      '[data-open-tab-activate][data-tab-id="c"]',
    );
    expect(document.activeElement).toBe(untitled);
  });

  it("closes the active tab with ⌘W or Ctrl+W and ignores a bare W", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <OpenTabsStrip
          tabs={tabs}
          activeId="b"
          onActivate={vi.fn()}
          onClose={onClose}
          onEmptyFocus={ignoreEmptyFocus}
        />,
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

  it("moves focus to the neighbouring destination after closing with Ctrl+W", async () => {
    function StatefulStrip() {
      const [openTabs, setOpenTabs] = useState(tabs);
      const [activeId, setActiveId] = useState("b");
      const close = (itemId: string): void => {
        const index = openTabs.findIndex((tab) => tab.id === itemId);
        const neighbour = openTabs[index + 1]?.id ?? openTabs[index - 1]?.id ?? null;
        setOpenTabs((current) => current.filter((tab) => tab.id !== itemId));
        if (activeId === itemId) setActiveId(neighbour);
      };
      return (
        <OpenTabsStrip
          tabs={openTabs}
          activeId={activeId}
          onActivate={setActiveId}
          onClose={close}
          onEmptyFocus={ignoreEmptyFocus}
        />
      );
    }

    await act(async () => root.render(<StatefulStrip />));
    container.querySelector<HTMLElement>('[data-open-tab-activate][data-tab-id="b"]')?.focus();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true }),
      );
    });

    expect(container.querySelector('[data-open-tab-activate][data-tab-id="b"]')).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>('[data-open-tab-activate][data-tab-id="c"]'),
    );
  });

  it("moves focus to the neighbouring destination after closing with the middle button", async () => {
    function StatefulStrip() {
      const [openTabs, setOpenTabs] = useState(tabs);
      const [activeId, setActiveId] = useState("b");
      const close = (itemId: string): void => {
        const index = openTabs.findIndex((tab) => tab.id === itemId);
        const neighbour = openTabs[index + 1]?.id ?? openTabs[index - 1]?.id ?? null;
        setOpenTabs((current) => current.filter((tab) => tab.id !== itemId));
        if (activeId === itemId) setActiveId(neighbour);
      };
      return (
        <OpenTabsStrip
          tabs={openTabs}
          activeId={activeId}
          onActivate={setActiveId}
          onClose={close}
          onEmptyFocus={ignoreEmptyFocus}
        />
      );
    }

    await act(async () => root.render(<StatefulStrip />));
    const roadmap = container.querySelector<HTMLElement>(
      '[data-open-tab-activate][data-tab-id="b"]',
    );
    roadmap?.focus();
    await act(async () => {
      roadmap?.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }));
    });

    expect(container.querySelector('[data-open-tab-activate][data-tab-id="b"]')).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>('[data-open-tab-activate][data-tab-id="c"]'),
    );
  });

  it("falls back to a surviving destination when the expected neighbour is pruned", async () => {
    function ConcurrentStrip() {
      const [openTabs, setOpenTabs] = useState(tabs);
      const [activeId, setActiveId] = useState("b");
      const close = (): void => {
        setOpenTabs((current) => current.filter((tab) => tab.id === "a"));
        setActiveId("a");
      };
      return (
        <OpenTabsStrip
          tabs={openTabs}
          activeId={activeId}
          onActivate={setActiveId}
          onClose={close}
          onEmptyFocus={ignoreEmptyFocus}
        />
      );
    }

    await act(async () => root.render(<ConcurrentStrip />));
    const closeRoadmap = container.querySelector<HTMLButtonElement>(
      '[aria-label="Fermer l’onglet Feuille de route"]',
    );
    closeRoadmap?.focus();
    await act(async () => closeRoadmap?.click());

    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>('[data-open-tab-activate][data-tab-id="a"]'),
    );
  });

  it("keeps a keyboard entry point when the current destination has no tab", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <OpenTabsStrip
          tabs={tabs}
          activeId="selected-file"
          onActivate={vi.fn()}
          onClose={onClose}
          onEmptyFocus={ignoreEmptyFocus}
        />,
      );
    });

    const buttons = [...container.querySelectorAll<HTMLElement>("[data-open-tab-activate]")];
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    expect(buttons.every((button) => !button.hasAttribute("aria-current"))).toBe(true);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the workspace after closing the final tab", async () => {
    function SingleStrip() {
      const [openTabs, setOpenTabs] = useState([tabs[0] as (typeof tabs)[number]]);
      return (
        <>
          <main id="workspace-main" tabIndex={-1} />
          {openTabs.length === 0 ? null : (
            <OpenTabsStrip
              tabs={openTabs}
              activeId="a"
              onActivate={vi.fn()}
              onClose={() => setOpenTabs([])}
              onEmptyFocus={() => document.getElementById("workspace-main")?.focus()}
            />
          )}
        </>
      );
    }

    await act(async () => root.render(<SingleStrip />));
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Fermer l’onglet Projets"]',
    );
    close?.focus();
    await act(async () => close?.click());
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("#workspace-main"));
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
          onEmptyFocus={ignoreEmptyFocus}
        />,
      );
    });
    const buttons = [...container.querySelectorAll<HTMLElement>("[data-open-tab-activate]")];
    expect(buttons[0]?.textContent).toContain("Graphe");
    expect(buttons[0]?.getAttribute("aria-current")).toBe("page");
    await act(async () => {
      buttons[0]?.click();
    });
    expect(onActivate).toHaveBeenCalledWith("graph");
  });

  it("renders nothing when no tab is open", async () => {
    await act(async () => {
      root.render(
        <OpenTabsStrip
          tabs={[]}
          activeId={null}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onEmptyFocus={ignoreEmptyFocus}
        />,
      );
    });
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("exposes sortable activators so the strip can be reordered by drag", async () => {
    const onReorder = vi.fn();
    await act(async () => {
      root.render(
        <OpenTabsStrip
          tabs={tabs}
          activeId="a"
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onEmptyFocus={ignoreEmptyFocus}
          onReorder={onReorder}
        />,
      );
    });
    const activators = [...container.querySelectorAll<HTMLElement>("[data-open-tab-activate]")];
    expect(activators).toHaveLength(3);
    // dnd-kit marks the activator for keyboard and pointer sensors.
    expect(activators.every((button) => button.hasAttribute("aria-roledescription"))).toBe(true);
    expect(container.querySelectorAll('[data-testid="open-tab"]')).toHaveLength(3);
  });
});
