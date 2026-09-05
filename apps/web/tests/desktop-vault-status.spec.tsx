// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DesktopDiagnostics } from "../src/features/security/desktop-diagnostics.tsx";
import { DesktopVaultStatus } from "../src/features/security/desktop-vault-status.tsx";
import { FR_COPY } from "../src/ui/copy/fr.ts";

it.each(["browser", "available", "locked", "unavailable", "rejected"] as const)(
  "reports only applicable native key protection: %s",
  async (state) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const getKeyState =
      state === "rejected"
        ? vi.fn().mockRejectedValue(new Error("private native key path"))
        : vi.fn().mockResolvedValue({ state });
    Object.defineProperty(window, "myownnotionDesktop", {
      configurable: true,
      value:
        state === "browser" ? undefined : { getKeyState, platform: "darwin", appVersion: "0.1.0" },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <>
            <DesktopVaultStatus />
            <DesktopDiagnostics />
          </>,
        ),
      );
      if (state === "browser") {
        expect(container.textContent).toBe("");
        expect(getKeyState).not.toHaveBeenCalled();
      } else if (state === "available") {
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.textContent).toContain("available");
      } else {
        const reported = state === "rejected" ? "unavailable" : state;
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(
          FR_COPY.desktop.vault[reported].title,
        );
        expect(container.textContent).not.toContain("private native key path");
        expect(
          container.querySelector('[data-testid="desktop-diagnostics"]')?.textContent,
        ).toContain(reported);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
      Reflect.deleteProperty(window, "myownnotionDesktop");
      vi.unstubAllGlobals();
    }
  },
);
