// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsShell } from "../src/features/settings/settings-shell.tsx";

describe("workspace content boundary", () => {
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

  it("exposes every operational surface from one destination outside the workspace", () => {
    act(() =>
      root.render(
        <SettingsShell
          activeSection="local-data"
          onBack={() => undefined}
          onSectionChange={() => undefined}
        >
          <section data-testid="local-data-content">État local détaillé</section>
        </SettingsShell>,
      ),
    );

    const shell = container.querySelector<HTMLElement>('[data-testid="settings-shell"]');
    expect(shell).not.toBeNull();
    expect(shell?.querySelector("main")?.id).toBe("settings-main");
    expect(shell?.querySelector('[aria-label="Sections des réglages"]')).not.toBeNull();
    expect(shell?.querySelector('[data-testid="settings-nav-security"]')).not.toBeNull();
    expect(shell?.querySelector('[data-testid="settings-nav-navigation"]')).not.toBeNull();
    expect(shell?.querySelector('[data-testid="settings-nav-backups"]')).not.toBeNull();
    expect(
      shell?.querySelector('[data-testid="settings-nav-local-data"]')?.getAttribute("aria-current"),
    ).toBe("page");
    expect(shell?.querySelector('[data-testid="settings-nav-trash"]')).not.toBeNull();
    expect(shell?.querySelector('[data-testid="settings-nav-page-details"]')).not.toBeNull();
    expect(shell?.querySelector('[data-testid="local-data-content"]')).not.toBeNull();
  });

  it("moves focus into the destination and exposes explicit navigation and return actions", async () => {
    const onBack = vi.fn();
    const onSectionChange = vi.fn();
    await act(async () => {
      root.render(
        <SettingsShell activeSection="security" onBack={onBack} onSectionChange={onSectionChange}>
          <p>Sécurité</p>
        </SettingsShell>,
      );
    });

    expect(container.querySelector('[data-testid="settings-heading"]')).toBe(
      document.activeElement,
    );

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-nav-backups"]')?.click();
      container.querySelector<HTMLButtonElement>('[data-testid="back-to-workspace"]')?.click();
    });

    expect(onSectionChange).toHaveBeenCalledWith("backups");
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
