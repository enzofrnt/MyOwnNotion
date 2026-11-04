// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../src/ui/error-boundary.tsx";

function BrokenSurface(): ReactNode {
  throw new Error("rendering failed");
}

describe("root error boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders children when nothing fails", () => {
    act(() =>
      root.render(
        <AppErrorBoundary>
          <p>Contenu du workspace</p>
        </AppErrorBoundary>,
      ),
    );

    expect(container.textContent).toContain("Contenu du workspace");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("replaces a render failure with a readable, reloadable recovery screen", () => {
    act(() =>
      root.render(
        <AppErrorBoundary>
          <BrokenSurface />
        </AppErrorBoundary>,
      ),
    );

    const alert = container.querySelector<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("MyOwnNotion n’a pas pu s’afficher");
    expect(alert?.textContent).toContain("Le contenu déjà enregistré n’est pas supprimé");
    const reload = alert?.querySelector<HTMLButtonElement>("button");
    expect(reload?.textContent).toBe("Recharger la page");
    expect(reload?.type).toBe("button");
  });
});
