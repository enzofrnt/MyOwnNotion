// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UiLabAuthPreview } from "../src/ui/ui-lab-auth.tsx";

describe("local authentication previews", () => {
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

  it("refuses a preview login locally, clears the password and exposes the real error", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => root.render(<UiLabAuthPreview surface="login" />));
    const alternative = container.querySelector<HTMLButtonElement>(
      '[data-testid="use-password-instead"]',
    );
    if (alternative) await act(async () => alternative.click());
    const input = container.querySelector<HTMLInputElement>('input[type="password"]');
    if (!input) throw new Error("Password preview unavailable");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "a-local-example");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(input.value).toBe("");
    expect(container.querySelector('[data-testid="login-message"]')?.getAttribute("role")).toBe(
      "alert",
    );
    expect(request).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it("shows first-run status without contacting or configuring an installation", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => root.render(<UiLabAuthPreview surface="setup" />));
    expect(container.querySelector('[data-testid="begin-setup"]')).not.toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="begin-setup"]')?.click(),
    );
    expect(container.querySelector('[data-testid="bootstrap-password"]')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
});
