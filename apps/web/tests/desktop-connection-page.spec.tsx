// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DesktopConnectionPage } from "../src/features/connection/desktop-connection-page.tsx";
import { FR_COPY } from "../src/ui/copy/fr.ts";

it("recovers from an IPC rejection without losing the address or leaving the form busy", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const setActiveProfile = vi
    .fn()
    .mockRejectedValueOnce(new Error("private native path"))
    .mockResolvedValueOnce({ ok: true });
  Object.defineProperty(window, "myownnotionDesktop", {
    configurable: true,
    value: { setActiveProfile },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onConnected = vi.fn();
  try {
    await act(async () => root.render(<DesktopConnectionPage onConnected={onConnected} />));
    const form = container.querySelector("form");
    const input = container.querySelector("input");
    const button = container.querySelector("button");
    if (!form || !input || !button) throw new Error("Missing connection form");
    const address = input.value;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain(FR_COPY.desktop.connection.failed);
    expect(container.textContent).not.toContain("private native path");
    expect(input.value).toBe(address);
    expect(button.disabled).toBe(false);
    expect(input.disabled).toBe(false);
    expect(onConnected).not.toHaveBeenCalled();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onConnected).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(window, "myownnotionDesktop");
    vi.unstubAllGlobals();
  }
});
