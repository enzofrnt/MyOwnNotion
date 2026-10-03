// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NavigationItemMenu } from "../src/features/navigation/navigation-item-menu.tsx";

it("mounts contextual controls only on demand and uses current callbacks when reopened", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const firstRename = vi.fn();
  const latestRename = vi.fn();
  const conversionRender = vi.fn();
  function Conversion() {
    conversionRender();
    return <span>Conversion</span>;
  }
  const conversion = () => <Conversion />;
  const noop = () => {};
  const props = {
    itemName: "Page",
    canContainChildren: true,
    canMoveToRoot: false,
    canMoveSelectedInside: false,
    favourite: false,
    keptOffline: false,
    conversion,
    onCreatePage: noop,
    onCreateFolder: noop,
    onMoveUp: noop,
    onMoveDown: noop,
    onMoveToRoot: noop,
    onMoveSelectedInside: noop,
    onToggleFavourite: noop,
    onToggleOffline: noop,
    onRequestTrash: noop,
  };
  try {
    await act(async () => root.render(<NavigationItemMenu {...props} onRename={firstRename} />));
    expect(conversionRender).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Actions pour Page"]');
    await act(async () => trigger?.click());
    expect(conversionRender).toHaveBeenCalled();
    await act(async () =>
      document.querySelector<HTMLElement>('[data-testid="rename-Page"]')?.click(),
    );
    expect(firstRename).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => root.render(<NavigationItemMenu {...props} onRename={latestRename} />));
    await act(async () => trigger?.click());
    await act(async () =>
      document.querySelector<HTMLElement>('[data-testid="rename-Page"]')?.click(),
    );
    expect(firstRename).toHaveBeenCalledTimes(1);
    expect(latestRename).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="Actions pour Page"]')).toBe(trigger);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
