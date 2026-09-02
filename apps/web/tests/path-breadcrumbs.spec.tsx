// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathBreadcrumbs } from "../src/features/workspace/path-breadcrumbs.tsx";

const path = [
  { id: "root", name: "Projets", kind: "folder" as const, icon: "📁" },
  { id: "mid", name: "2026", kind: "folder" as const, icon: null },
  { id: "leaf", name: "Feuille de route", kind: "page" as const, icon: "🗺️" },
];

describe("page path breadcrumbs", () => {
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

  it("names every ancestor as a link, the current item as text, and no product name", async () => {
    const onOpen = vi.fn();
    await act(async () => {
      root.render(<PathBreadcrumbs path={path} onOpen={onOpen} />);
    });
    const nav = container.querySelector('nav[aria-label="Fil d’Ariane"]');
    expect(nav).not.toBeNull();
    expect(nav?.textContent).not.toContain("MyOwnNotion");
    const visible = container.querySelector(".workspace-path__list");
    const links = [
      ...(visible?.querySelectorAll<HTMLButtonElement>(".workspace-path__link") ?? []),
    ];
    expect(links.map((link) => link.textContent)).toEqual(["📁Projets", "2026"]);
    expect(visible?.querySelector('[aria-current="page"]')?.textContent).toBe("Feuille de route");
    // Without layout (jsdom) nothing is folded.
    expect(container.querySelector('[data-testid="page-path-ellipsis"]')).toBeNull();
    await act(async () => {
      links[1]?.click();
    });
    expect(onOpen).toHaveBeenCalledWith("mid");
  });

  it("folds intermediate ancestors into a single menu when the row is too narrow", async () => {
    // jsdom has no layout: simulate widths through getBoundingClientRect.
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const rect = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        height: 20,
        toJSON: () => ({}),
      };
      if (this.matches("nav")) return { ...rect, width: 200 };
      if (this.matches("[data-measure='crumb']")) return { ...rect, width: 90 };
      if (this.matches("[data-measure='separator']")) return { ...rect, width: 10 };
      if (this.matches("[data-measure='ellipsis']")) return { ...rect, width: 20 };
      return { ...rect, width: 0 };
    } as typeof Element.prototype.getBoundingClientRect;
    try {
      const longPath = [
        ...path.slice(0, 2),
        { id: "deep", name: "Trimestre 3", kind: "folder" as const, icon: null },
        path[2] as (typeof path)[number],
      ];
      await act(async () => {
        root.render(<PathBreadcrumbs path={longPath} onOpen={vi.fn()} />);
      });
      // 4 × 90 + 3 × 10 = 390 > 200 → current(90) + … (20) + separator = 120 fits,
      // parent would need 220 → folded.
      const nav = container.querySelector("nav");
      expect(nav?.getAttribute("data-truncated")).toBe("true");
      const ellipsis = container.querySelector('[data-testid="page-path-ellipsis"]');
      expect(ellipsis).not.toBeNull();
      const visible = container.querySelector(".workspace-path__list");
      expect(visible?.querySelector('[aria-current="page"]')?.textContent).toBe("Feuille de route");
      expect(visible?.querySelectorAll(".workspace-path__link")).toHaveLength(0);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});
