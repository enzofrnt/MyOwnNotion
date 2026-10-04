// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoPropertyName } from "../src/features/databases/property-configuration.tsx";

describe("property name drafts during projection updates", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  const replace = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  };
  const notifyInput = (input: HTMLInputElement) =>
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }),
    );
  const nameInput = (container: HTMLElement) => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Property name"]');
    if (input === null) throw new Error("Missing property name field");
    return input;
  };

  it("retains a native replacement through a concurrent render before its input event", async () => {
    const commit = vi.fn();
    const render = () =>
      root.render(<AutoPropertyName name="Notes" label="Property name" onCommit={commit} />);
    await act(async () => render());
    const input = nameInput(container);
    input.focus();
    replace(input, "Brief");
    // A projection may render between the browser's replacement and its event.
    await act(async () => render());
    expect(input.value).toBe("Brief");
    await act(async () => {
      notifyInput(input);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith("Brief");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("retains a focused draft while another source property changes, then saves on pause", async () => {
    const commit = vi.fn();
    await act(async () =>
      root.render(<AutoPropertyName name="Notes" label="Property name" onCommit={commit} />),
    );
    const input = nameInput(container);
    input.focus();
    await act(async () => {
      replace(input, "Brief");
      notifyInput(input);
    });
    await act(async () =>
      root.render(<AutoPropertyName name="Remote notes" label="Property name" onCommit={commit} />),
    );
    expect(input.value).toBe("Brief");
    await act(async () => vi.advanceTimersByTime(350));
    expect(commit).toHaveBeenCalledExactlyOnceWith("Brief");
  });

  it("adopts an updated source name when no local edit is pending", async () => {
    const commit = vi.fn();
    await act(async () =>
      root.render(<AutoPropertyName name="Notes" label="Property name" onCommit={commit} />),
    );
    const input = nameInput(container);
    await act(async () =>
      root.render(<AutoPropertyName name="Remote notes" label="Property name" onCommit={commit} />),
    );
    expect(input.value).toBe("Remote notes");
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(["", " ", "x".repeat(513)])(
    "keeps an invalid draft visible without saving",
    async (draft) => {
      const commit = vi.fn();
      await act(async () =>
        root.render(<AutoPropertyName name="Notes" label="Property name" onCommit={commit} />),
      );
      const input = nameInput(container);
      await act(async () => {
        input.focus();
        replace(input, draft);
        notifyInput(input);
        input.blur();
        vi.advanceTimersByTime(1_000);
      });
      expect(input.value).toBe(draft);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(commit).not.toHaveBeenCalled();
    },
  );
});
