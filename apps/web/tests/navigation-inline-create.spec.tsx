// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationInlineCreate } from "../src/features/navigation/navigation-inline-create.tsx";

describe("inline child creation", () => {
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

  it("groups page, folder and the rotated close command in one ordered surface", async () => {
    await act(async () => {
      root.render(
        <NavigationInlineCreate
          itemName="Projet"
          open
          onOpenChange={() => undefined}
          onCreatePage={() => undefined}
          onCreateFolder={() => undefined}
        />,
      );
    });

    const cluster = container.querySelector('[data-testid="inline-create-Projet"]');
    const surface = cluster?.querySelector(".navigation-inline-create__surface");
    const controls = [...(surface?.querySelectorAll("button") ?? [])];
    expect(cluster?.getAttribute("data-open")).toBe("true");
    expect(cluster?.children).toHaveLength(1);
    expect(controls.map((button) => button.getAttribute("data-testid"))).toEqual([
      "new-page-inline-Projet",
      "new-folder-inline-Projet",
      "toggle-inline-create-Projet",
    ]);
    expect(controls.at(-1)?.getAttribute("aria-label")).toBe("Fermer la création dans Projet");
  });

  it("opens and creates without propagating the row click", async () => {
    const onOpenChange = vi.fn();
    const onCreatePage = vi.fn();
    await act(async () => {
      root.render(
        <NavigationInlineCreate
          itemName="Projet"
          open={false}
          onOpenChange={onOpenChange}
          onCreatePage={onCreatePage}
          onCreateFolder={() => undefined}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="toggle-inline-create-Projet"]')
        ?.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);

    await act(async () => {
      root.render(
        <NavigationInlineCreate
          itemName="Projet"
          open
          onOpenChange={onOpenChange}
          onCreatePage={onCreatePage}
          onCreateFolder={() => undefined}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="new-page-inline-Projet"]')?.click();
    });
    expect(onCreatePage).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("moves keyboard focus into the choices and returns it on Escape", async () => {
    function ControlledCreation() {
      const [open, setOpen] = useState(false);
      return (
        <NavigationInlineCreate
          itemName="Projet"
          open={open}
          onOpenChange={setOpen}
          onCreatePage={() => undefined}
          onCreateFolder={() => undefined}
        />
      );
    }

    await act(async () => root.render(<ControlledCreation />));
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="toggle-inline-create-Projet"]',
    );
    toggle?.focus();
    await act(async () => toggle?.click());

    const firstChoice = container.querySelector<HTMLButtonElement>(
      '[data-testid="new-page-inline-Projet"]',
    );
    expect(firstChoice).toBe(document.activeElement);

    await act(async () => {
      firstChoice?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(toggle).toBe(document.activeElement);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it("reuses the same rotating control for root page and folder creation", async () => {
    await act(async () => {
      root.render(
        <NavigationInlineCreate
          itemName="Notes"
          label="Nouveau"
          variant="root"
          open
          testIds={{
            root: "root-inline-create",
            toggle: "toggle-root-creation",
            page: "new-root-page",
            folder: "new-root-folder",
          }}
          onOpenChange={() => undefined}
          onCreatePage={() => undefined}
          onCreateFolder={() => undefined}
        />,
      );
    });

    const cluster = container.querySelector('[data-testid="root-inline-create"]');
    expect(cluster?.getAttribute("data-variant")).toBe("root");
    expect(cluster?.getAttribute("data-open")).toBe("true");
    expect(cluster?.querySelector(".navigation-inline-create__label")?.textContent).toBe("Nouveau");
    expect(cluster?.querySelector('[data-testid="toggle-root-creation"] .ui-icon')).not.toBeNull();
    expect(cluster?.querySelector('[data-testid="new-root-page"]')).not.toBeNull();
    expect(cluster?.querySelector('[data-testid="new-root-folder"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Nom"]')).toBeNull();
  });
});
