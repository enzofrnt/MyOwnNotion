// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationInlineRename } from "../src/features/navigation/navigation-inline-rename.tsx";

const NAME = "Nouvelle page";

function setNativeValue(element: HTMLInputElement, value: string): void {
  // React tracks the last rendered value; assigning through the prototype
  // setter is what makes the following `input` event look like typing.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
}

describe("inline tree rename", () => {
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

  const field = (): HTMLInputElement => {
    const element = document.querySelector<HTMLInputElement>(
      `[data-testid="rename-input-${NAME}"]`,
    );
    if (element === null) throw new Error("rename field is not mounted");
    return element;
  };

  async function type(value: string): Promise<void> {
    await act(async () => {
      setNativeValue(field(), value);
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function press(key: string): Promise<void> {
    await act(async () => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function mount(accepted = true) {
    const close = vi.fn();
    const commit = vi.fn(async () => accepted);
    await act(async () => {
      root.render(
        <NavigationInlineRename
          committedName={NAME}
          itemName={NAME}
          onCommit={commit}
          onClose={close}
        />,
      );
    });
    return { close, commit };
  }

  it("starts focused on the current name, selected for replacement", async () => {
    await mount();
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe(NAME);
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(NAME.length);
  });

  it("commits the trimmed draft on Enter and returns focus to the row", async () => {
    const { close, commit } = await mount();
    await type("  Renommée  ");
    await press("Enter");
    expect(commit).toHaveBeenCalledWith("Renommée");
    expect(close).toHaveBeenCalledWith(true);
  });

  it("restores the previous name on Échap without writing", async () => {
    const { close, commit } = await mount();
    await type("Brouillon abandonné");
    await press("Escape");
    expect(commit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(true);
  });

  it("closes without a write when nothing changed or the draft is blank", async () => {
    const { close, commit } = await mount();
    await type(`  ${NAME}  `);
    await press("Enter");
    expect(commit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(true);
  });

  it("does not create a row named with spaces only", async () => {
    const { close, commit } = await mount();
    await type("   ");
    await press("Enter");
    expect(commit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(true);
  });

  it("commits on blur, like Notion, without stealing focus back", async () => {
    const { close, commit } = await mount();
    await type("Depuis le survol");
    await act(async () => {
      // React delegates `onBlur` from the bubbling `focusout` event.
      field().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledWith("Depuis le survol");
    expect(close).toHaveBeenCalledWith(false);
  });

  it("keeps the refused draft open so the owner can retry", async () => {
    const { close, commit } = await mount(false);
    await type("Refusée");
    await press("Enter");
    expect(commit).toHaveBeenCalledWith("Refusée");
    expect(close).not.toHaveBeenCalled();
    expect(field().value).toBe("Refusée");
    expect(field().readOnly).toBe(false);
  });

  it("keeps typing inside the row: pointer events do not reach the tree item", async () => {
    const rowClick = vi.fn();
    const close = vi.fn();
    const commit = vi.fn(async () => true);
    const Row = () => (
      // The row is a listener only: the assertions are about the field not
      // letting its own clicks reach it, so no row keyboard contract is under
      // test here.
      // biome-ignore lint/a11y/useKeyWithClickEvents: listener-only row
      <div role="treeitem" onClick={rowClick} tabIndex={-1}>
        <NavigationInlineRename
          committedName={NAME}
          itemName={NAME}
          onCommit={commit}
          onClose={close}
        />
      </div>
    );
    await act(async () => {
      root.render(<Row />);
    });
    await act(async () => {
      field().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      field().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(rowClick).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
