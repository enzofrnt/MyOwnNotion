// @vitest-environment jsdom
import { generateUuidV7 } from "@myownnotion/domain";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, type NavigateOptions, useLocation } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapPageProps } from "../src/features/auth/bootstrap-page.tsx";
import type { HierarchyExplorerProps } from "../src/features/hierarchy/hierarchy-explorer.tsx";
import type { SecurityApi } from "../src/services/security-api.ts";

const renderedGraphModes: HierarchyExplorerProps["graphMode"][] = [];

function RoutedHierarchy({
  active,
  selectedItemId,
  graphMode,
  onOpenItem,
  onTrashedItemsChange,
}: HierarchyExplorerProps) {
  renderedGraphModes.push(graphMode);
  return (
    <div
      data-testid="routed-hierarchy"
      data-active={String(active)}
      data-selected-item={selectedItemId ?? ""}
    >
      <button type="button" onClick={() => onOpenItem(generateUuidV7())}>
        Ouvrir une note
      </button>
      <button
        type="button"
        data-testid="rerender-routed-app"
        onClick={() => onTrashedItemsChange([])}
      >
        Actualiser la projection
      </button>
    </div>
  );
}

function RoutedBootstrap({ onReady }: BootstrapPageProps) {
  return (
    <button type="button" data-testid="finish-routed-setup" onClick={onReady}>
      Terminer l’installation
    </button>
  );
}

let App: typeof import("../src/app.tsx")["App"];

beforeAll(async () => {
  ({ App } = await import("../src/app.tsx"));
});

afterAll(() => {
  vi.resetModules();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-location">{`${location.pathname}${location.search}`}</output>;
}

function securityApi(
  session:
    | "authenticated"
    | "refused"
    | "offline"
    | "resume-after-login"
    | "resume-after-setup" = "authenticated",
): SecurityApi {
  const unavailable = {
    type: "https://myownnotion.dev/problems/network",
    title: "Server unreachable",
    status: 503,
    code: "service_unavailable",
    correlationId: null,
  } as const;
  const authenticated = { ok: true, value: { session: { sessionId: "session-1" } } } as const;
  const refused = {
    ok: false,
    problem: { ...unavailable, status: 401, code: "authentication_required" },
  } as const;
  const status = vi.fn().mockResolvedValue({ ok: true, value: { ownerCount: 1 } });
  if (session === "resume-after-setup") {
    status.mockResolvedValueOnce({ ok: true, value: { ownerCount: 0 } });
  }
  const currentSession = vi.fn();
  if (session === "resume-after-login") {
    currentSession.mockResolvedValueOnce(refused).mockResolvedValue(authenticated);
  } else {
    currentSession.mockResolvedValue(
      session === "authenticated" || session === "resume-after-setup"
        ? authenticated
        : session === "offline"
          ? { ok: false, problem: unavailable }
          : refused,
    );
  }
  return {
    status,
    currentSession,
    backupStatus: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        lastVerifiedAt: null,
        lastVerifiedBackupId: null,
        latestBackupAt: null,
        latestBackupId: null,
        latestCreationVerification: null,
        latestTransferVerification: null,
        lastRehearsalAt: null,
        lastRehearsalOutcome: null,
        stale: false,
        rehearsalDue: false,
      },
    }),
    runBackupRehearsal: vi.fn().mockResolvedValue({
      ok: true,
      value: { outcome: "succeeded", restoredItemCount: 0, restoredFileCount: 0 },
    }),
    listSessions: vi.fn().mockResolvedValue({ ok: false, problem: unavailable }),
    listDevices: vi.fn().mockResolvedValue({ ok: false, problem: unavailable }),
    listPasskeys: vi.fn().mockResolvedValue({ ok: false, problem: unavailable }),
    rotationStatus: vi.fn().mockResolvedValue({ ok: false, problem: unavailable }),
    recoveryStatus: vi.fn().mockResolvedValue({ ok: false, problem: unavailable }),
    loginWithPassword: vi.fn().mockResolvedValue({ ok: true, value: authenticated.value }),
    csrfTokenForSameOriginWrite: vi.fn().mockReturnValue(null),
  } as unknown as SecurityApi;
}

describe("application routing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    renderedGraphModes.length = 0;
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderAt(
    path: string,
    api: SecurityApi = securityApi(),
    options: {
      readonly bootstrap?: ComponentType<BootstrapPageProps>;
      readonly navigate?: (path: string, options?: NavigateOptions) => void | Promise<void>;
    } = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <App
            api={api}
            hierarchy={RoutedHierarchy}
            {...(options.bootstrap === undefined ? {} : { bootstrap: options.bootstrap })}
            {...(options.navigate === undefined ? {} : { navigate: options.navigate })}
          />
          <LocationProbe />
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("authenticates only after the native server profile is resolved", async () => {
    const api = securityApi();
    let releaseProfile!: () => void;
    const pendingProfile = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    const profile = {
      profileId: "native-profile",
      serverUrl: window.location.origin,
      protocolCompatibility: "compatible",
    };
    const previous = Object.getOwnPropertyDescriptor(window, "myownnotionDesktop");
    Object.defineProperty(window, "myownnotionDesktop", {
      configurable: true,
      value: {
        platform: "darwin",
        appVersion: "0.0.0",
        getActiveProfile: async () => {
          await pendingProfile;
          return profile;
        },
      },
    });
    try {
      await renderAt("/notes", api);
      expect(container.querySelector('[data-testid="app-checking"]')).not.toBeNull();
      expect(api.status).not.toHaveBeenCalled();
      expect(api.currentSession).not.toHaveBeenCalled();
      await act(async () => {
        releaseProfile();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(api.currentSession).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="routed-hierarchy"]')).not.toBeNull();
    } finally {
      if (previous === undefined) Reflect.deleteProperty(window, "myownnotionDesktop");
      else Object.defineProperty(window, "myownnotionDesktop", previous);
    }
  });

  it("canonicalizes the root and settings index with replacement navigation", async () => {
    await renderAt("/");
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe("/notes");
    expect(
      container.querySelector('[data-testid="routed-hierarchy"]')?.getAttribute("data-active"),
    ).toBe("true");
  });

  it("canonicalizes the settings index to its default page", async () => {
    await renderAt("/settings");
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe(
      "/settings/security",
    );
    expect(container.querySelector('[data-testid="settings-section-security"]')).not.toBeNull();
  });

  it("derives operational settings from their URL while retaining the hidden workspace", async () => {
    await renderAt("/settings/storage-sync");
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe(
      "/settings/storage-sync",
    );
    expect(container.querySelector('[data-testid="settings-section-local-data"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="workspace-surface"]')?.hasAttribute("hidden"),
    ).toBe(true);
  });

  it("uses the explicit item identity for page details", async () => {
    const itemId = generateUuidV7();
    await renderAt(`/settings/page/${itemId}`);
    expect(
      container
        .querySelector('[data-testid="routed-hierarchy"]')
        ?.getAttribute("data-selected-item"),
    ).toBe(itemId);
    expect(container.querySelector('[data-testid="settings-section-page-details"]')).not.toBeNull();
  });

  it("keeps the global and local graph inside the protected workspace", async () => {
    await renderAt("/graph");
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe("/graph");
    expect(
      container.querySelector('[data-testid="routed-hierarchy"]')?.getAttribute("data-active"),
    ).toBe("true");

    const itemId = generateUuidV7();
    act(() => root.unmount());
    root = createRoot(container);
    await renderAt(`/graph/${itemId}`);
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe(
      `/graph/${itemId}`,
    );
    expect(
      container
        .querySelector('[data-testid="routed-hierarchy"]')
        ?.getAttribute("data-selected-item"),
    ).toBe(itemId);
  });

  it("keeps graph navigation identity stable across parent state updates", async () => {
    const itemId = generateUuidV7();
    await renderAt(`/graph/${itemId}`);
    const initialGraphMode = renderedGraphModes.at(-1);
    expect(initialGraphMode).toEqual({ kind: "local", centerId: itemId });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rerender-routed-app"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renderedGraphModes.at(-1)).toBe(initialGraphMode);
  });

  it("preserves a protected destination through sign-in", async () => {
    const itemId = generateUuidV7();
    await renderAt(`/notes/${itemId}`, securityApi("refused"));
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe(
      `/login?returnTo=%2Fnotes%2F${itemId}`,
    );
    expect(container.querySelector(".login-page")).not.toBeNull();
  });

  it("resumes the protected destination after a successful sign-in", async () => {
    const itemId = generateUuidV7();
    await renderAt(`/notes/${itemId}`, securityApi("resume-after-login"));

    const passwordAlternative = container.querySelector<HTMLButtonElement>(
      '[data-testid="use-password-instead"]',
    );
    if (passwordAlternative !== null) act(() => passwordAlternative.click());
    const password = container.querySelector<HTMLInputElement>('[data-testid="password-input"]');
    expect(password).not.toBeNull();
    await act(async () => {
      if (password === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        password,
        "correct horse battery staple",
      );
      password.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLButtonElement>('[data-testid="sign-in-password"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe(
      `/notes/${itemId}`,
    );
    expect(
      container
        .querySelector('[data-testid="routed-hierarchy"]')
        ?.getAttribute("data-selected-item"),
    ).toBe(itemId);
  });

  it("resumes the protected destination after first-run setup", async () => {
    const itemId = generateUuidV7();
    await renderAt(`/notes/${itemId}`, securityApi("resume-after-setup"), {
      bootstrap: RoutedBootstrap,
    });
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe(
      `/setup?returnTo=%2Fnotes%2F${itemId}`,
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="finish-routed-setup"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe(
      `/notes/${itemId}`,
    );
  });

  it("keeps a direct note available during a server outage", async () => {
    const itemId = generateUuidV7();
    await renderAt(`/notes/${itemId}`, securityApi("offline"));
    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe(
      `/notes/${itemId}`,
    );
    expect(
      container
        .querySelector('[data-testid="routed-hierarchy"]')
        ?.getAttribute("data-selected-item"),
    ).toBe(itemId);
  });

  it.each(["online-event", "server-recovery"])(
    "revalidates a cold offline session before waking writes: %s",
    async (trigger) => {
      const api = securityApi("offline");
      let authorized = false;
      Object.defineProperty(api, "hasCsrfToken", { get: () => authorized });
      const { localContent } = await import("../src/services/local-content.ts");
      const service = localContent();
      const wake = vi.spyOn(service.realtimePageSync, "wake").mockImplementation(() => {});
      const workspaceSync = vi.spyOn(service, "synchronize").mockResolvedValue("idle");
      const pageSync = vi.spyOn(service, "synchronizeOperationalPages").mockResolvedValue(true);
      await renderAt("/notes", api);
      expect(workspaceSync).not.toHaveBeenCalled();
      vi.mocked(api.currentSession).mockImplementation(async () => {
        authorized = true;
        return { ok: true, value: { session: { sessionId: "resumed-session" } } } as Awaited<
          ReturnType<SecurityApi["currentSession"]>
        >;
      });
      await act(async () => {
        if (trigger === "online-event") window.dispatchEvent(new Event("online"));
        await vi.waitFor(() => expect(pageSync).toHaveBeenCalledTimes(1), { timeout: 6500 });
      });
      expect(wake).toHaveBeenCalledTimes(1);
      expect(workspaceSync).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe("/notes");
    },
    10000,
  );

  it("renders an explicit not-found destination instead of a previous note", async () => {
    await renderAt("/somewhere-else");
    expect(container.querySelector('[data-testid="route-not-found"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="routed-hierarchy"]')).toBeNull();
  });

  it("keeps the current content mounted when browser history refuses navigation", async () => {
    const refusedNavigation = vi.fn(() => {
      throw new DOMException("History write refused", "SecurityError");
    });
    await renderAt("/notes", securityApi(), { navigate: refusedNavigation });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="routed-hierarchy"] button')
        ?.click();
    });

    expect(container.querySelector('[data-testid="route-location"]')?.textContent).toBe("/notes");
    expect(container.querySelector('[data-testid="routed-hierarchy"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="route-navigation-error"]')).not.toBeNull();
  });
});
