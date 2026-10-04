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

it("keeps an asynchronous conversion confirmation alive after its menu closes", async () => {
  const { ConvertItemControl } = await import("../src/features/navigation/convert-item.tsx");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let resolveConversion:
    | ((outcome: { ok: boolean; needsConfirmation: boolean }) => void)
    | undefined;
  const convert = vi.fn(
    () =>
      new Promise<{ ok: boolean; needsConfirmation: boolean }>((resolve) => {
        resolveConversion = resolve;
      }),
  );
  const noop = () => {};
  try {
    await act(async () =>
      root.render(
        <NavigationItemMenu
          itemName="Protected page"
          canContainChildren
          canMoveToRoot={false}
          canMoveSelectedInside={false}
          favourite={false}
          keptOffline={false}
          onCreatePage={noop}
          onCreateFolder={noop}
          onRename={noop}
          onMoveUp={noop}
          onMoveDown={noop}
          onMoveToRoot={noop}
          onMoveSelectedInside={noop}
          onToggleFavourite={noop}
          onToggleOffline={noop}
          onRequestTrash={noop}
          conversion={(finalFocus, onActiveChange) => (
            <ConvertItemControl
              itemId="018f2b7c-0000-7000-8000-000000000001"
              itemName="Protected page"
              kind="page"
              convert={convert}
              variant="menu"
              finalFocus={finalFocus}
              onActiveChange={onActiveChange}
            />
          )}
        />,
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Actions pour Protected page"]')
        ?.click(),
    );
    await act(async () =>
      document.querySelector<HTMLElement>('[data-testid="convert-Protected page"]')?.click(),
    );
    expect(convert).toHaveBeenCalledWith("018f2b7c-0000-7000-8000-000000000001", "folder", false);
    await act(async () => {
      resolveConversion?.({ ok: false, needsConfirmation: true });
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="convert-confirmation"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-testid="convert-confirmation"]')?.textContent).toContain(
      "tout le contenu de cette page sera supprimé",
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="cancel-convert"]')?.click(),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="convert-confirmation"]')).toBeNull(),
    );
    expect(convert).toHaveBeenCalledTimes(1);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Actions pour Protected page"]')
        ?.click(),
    );
    expect(document.querySelector('[data-testid="convert-Protected page"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
