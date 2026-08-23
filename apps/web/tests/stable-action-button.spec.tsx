// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StableActionButton } from "../src/ui/stable-action-button.tsx";

describe("pointer-stable actions", () => {
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

  it("starts on pointerdown and suppresses that gesture's compatibility click", () => {
    const onActivate = vi.fn();
    act(() => root.render(<StableActionButton onActivate={onActivate}>Save</StableActionButton>));
    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    const pointer = new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      isPrimary: true,
    });
    act(() => {
      button?.dispatchEvent(pointer);
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });

    expect(pointer.defaultPrevented).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(button);
  });

  it("keeps semantic keyboard and assistive clicks working", () => {
    const onActivate = vi.fn();
    act(() => root.render(<StableActionButton onActivate={onActivate}>Save</StableActionButton>));

    act(() => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(container.querySelector("button"));
  });

  it("owns submit-button clicks without also invoking the native form submit", () => {
    const onActivate = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    act(() =>
      root.render(
        <form onSubmit={onSubmit}>
          <StableActionButton type="submit" onActivate={onActivate}>
            Save
          </StableActionButton>
        </form>,
      ),
    );

    act(() => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
