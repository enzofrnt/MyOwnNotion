// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryReadinessPanel } from "../src/features/security/recovery-readiness-panel.tsx";
import {
  RecoveryReplacementPanel,
  type RecoveryReplacementPanelProps,
} from "../src/features/security/recovery-replacement-panel.tsx";
import { SecuritySettings } from "../src/features/security/security-settings.tsx";
import { SecurityApi } from "../src/services/security-api.ts";

vi.mock("../src/features/security/device-panel.tsx", () => ({
  DevicePanel: () => null,
}));
vi.mock("../src/features/security/key-rotation-panel.tsx", () => ({
  KeyRotationPanel: () => null,
}));
vi.mock("../src/features/security/mcp-access-panel.tsx", () => ({
  McpAccessPanel: () => null,
}));
vi.mock("../src/features/security/session-panel.tsx", () => ({
  SessionPanel: () => null,
}));

const kit = {
  kitId: "kit-replacement",
  recoveryEpoch: 3,
  downloadExpiresAt: "2026-09-13T03:00:00.000Z",
  notice: "Conservez aussi la clé de déploiement.",
};

describe("authenticated recovery-kit replacement API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("downloads the JSON attachment and sends the strict offline confirmation body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "csrf-proof" })))
      .mockResolvedValueOnce(
        new Response('{"format":"myownnotion.recovery+json"}', {
          headers: {
            "content-type": "application/json",
            "content-disposition": 'attachment; filename="myownnotion-recovery.json"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ recoveryEpoch: 3, notice: kit.notice })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revocationCode: "revoked-1" })));
    vi.stubGlobal("fetch", fetchMock);

    const api = new SecurityApi("https://notes.example");
    await api.currentSession();
    const downloaded = await api.downloadRecoveryKit(kit.kitId);
    expect(downloaded.ok).toBe(true);
    if (downloaded.ok) {
      expect(downloaded.value.type).toMatch(/^application\/json(?:;charset=utf-8)?$/u);
    }

    const downloadRequest = fetchMock.mock.calls[1];
    expect(downloadRequest?.[0]).toBe(
      "https://notes.example/v1/security/recovery-kits/kit-replacement/download",
    );
    expect(downloadRequest?.[1]?.credentials).toBe("same-origin");
    expect(new Headers(downloadRequest?.[1]?.headers).get("x-csrf-token")).toBe("csrf-proof");

    await api.confirmRecoveryKit(kit.kitId);
    const confirmRequest = fetchMock.mock.calls[2];
    expect(confirmRequest?.[0]).toBe(
      "https://notes.example/v1/security/recovery-kits/kit-replacement/confirm",
    );
    expect(confirmRequest?.[1]?.body).toBe(JSON.stringify({ storedOffline: true }));

    await api.revokeRecoveryKit();
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://notes.example/v1/security/recovery-kits/revoke",
    );
  });

  it("treats a download conflict as already consumed", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "csrf-proof" })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "https://myownnotion.dev/problems/conflict",
            title: "Conflict",
            status: 409,
            code: "conflict",
            correlationId: "corr-1",
          }),
          { status: 409, headers: { "content-type": "application/problem+json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const api = new SecurityApi("https://notes.example");
    await api.currentSession();
    await expect(api.downloadRecoveryKit(kit.kitId)).resolves.toMatchObject({
      ok: false,
      consumed: true,
    });
  });
});

describe("recovery replacement ceremony", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderPanel(
    overrides: Partial<RecoveryReplacementPanelProps> = {},
  ): Promise<void> {
    const props: RecoveryReplacementPanelProps = {
      kit,
      delivery: "downloadable",
      downloadSaved: false,
      busy: false,
      onDownload: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
    await act(async () => root.render(<RecoveryReplacementPanel {...props} />));
  }

  type PendingRecovery = {
    kitId: string;
    deliveryState: string;
    downloadExpiresAt: string | null;
  };

  const networkProblem = {
    type: "https://myownnotion.dev/problems/network",
    title: "Server unreachable",
    status: 503,
    code: "service_unavailable",
    correlationId: null,
  } as const;

  function makeSecuritySettingsApi(
    options: {
      initialPending?: PendingRecovery | null;
      downloadResult?:
        | { readonly ok: true; readonly value: Blob }
        | {
            readonly ok: false;
            readonly problem: typeof networkProblem;
            readonly consumed: boolean;
          };
    } = {},
  ) {
    let pending = options.initialPending ?? null;
    const active = { kitId: "active-kit", recoveryEpoch: 2, confirmedAt: "2026-09-12T12:00:00Z" };
    const recoveryStatus = vi.fn(async () => ({
      ok: true as const,
      value: { active, pending, notice: kit.notice },
    }));
    const api = {
      listPasskeys: vi.fn(async () => ({ ok: true as const, value: { passkeys: [] } })),
      listSessions: vi.fn(async () => ({ ok: true as const, value: { sessions: [] } })),
      listDevices: vi.fn(async () => ({ ok: true as const, value: { devices: [] } })),
      listMcpConnections: vi.fn(async () => ({ ok: true as const, value: { connections: [] } })),
      listMcpBranches: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
      listMcpAudit: vi.fn(async () => ({ ok: true as const, value: { events: [] } })),
      rotationStatus: vi.fn(async () => ({
        ok: true as const,
        value: { policies: [], writesAllowed: true, running: [] },
      })),
      recoveryStatus,
      prepareRecoveryReplacement: vi.fn(async () => {
        pending = {
          kitId: kit.kitId,
          deliveryState: "prepared",
          downloadExpiresAt: kit.downloadExpiresAt,
        };
        return { ok: true as const, value: kit };
      }),
      downloadRecoveryKit: vi.fn(async () => {
        if (pending !== null) pending = { ...pending, deliveryState: "download-consumed" };
        const value = new Blob(["recovery"], { type: "application/json" });
        Object.defineProperty(value, "arrayBuffer", {
          configurable: true,
          value: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        });
        return options.downloadResult ?? ({ ok: true, value } as const);
      }),
      confirmRecoveryKit: vi.fn(async () => {
        pending = null;
        return { ok: true as const, value: { recoveryEpoch: 3, notice: kit.notice } };
      }),
      revokeRecoveryKit: vi.fn(async () => {
        pending = null;
        return { ok: true as const, value: { revocationCode: "revoked-1" } };
      }),
    } as unknown as SecurityApi;
    return { api, recoveryStatus };
  }

  async function renderSettings(api: SecurityApi): Promise<void> {
    await act(async () => {
      root.render(<SecuritySettings api={api} currentSessionId={null} onSignedOut={vi.fn()} />);
      for (let index = 0; index < 4; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  }

  async function clickSettings(testId: string): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
      for (let index = 0; index < 4; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  }

  function stubDesktopSave(
    result: { ok: true; canceled: boolean } | { ok: false; message: string },
  ) {
    Object.defineProperty(window, "myownnotionDesktop", {
      configurable: true,
      value: { saveFile: vi.fn().mockResolvedValue(result) },
    });
  }

  it("requires a completed download and explicit offline acknowledgement", async () => {
    const onDownload = vi.fn().mockResolvedValue(undefined);
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    await renderPanel({ onDownload, onConfirm });

    const download = container.querySelector<HTMLButtonElement>(
      '[data-testid="download-recovery-replacement"]',
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-recovery-replacement"]',
    );
    const acknowledgement = container.querySelector<HTMLInputElement>(
      '[data-testid="acknowledge-recovery-replacement"]',
    );
    expect(download?.disabled).toBe(false);
    expect(confirm?.disabled).toBe(true);
    expect(acknowledgement?.disabled).toBe(true);

    await act(async () => download?.click());
    expect(onDownload).toHaveBeenCalledOnce();

    await renderPanel({ delivery: "download-consumed", onDownload, onConfirm });
    const consumedConfirm = container.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-recovery-replacement"]',
    );
    const consumedAcknowledgement = container.querySelector<HTMLInputElement>(
      '[data-testid="acknowledge-recovery-replacement"]',
    );
    expect(consumedAcknowledgement?.disabled).toBe(true);
    expect(consumedConfirm?.disabled).toBe(true);

    await renderPanel({
      delivery: "download-consumed",
      downloadSaved: true,
      onDownload,
      onConfirm,
    });
    const savedAcknowledgement = container.querySelector<HTMLInputElement>(
      '[data-testid="acknowledge-recovery-replacement"]',
    );
    const savedConfirm = container.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-recovery-replacement"]',
    );
    expect(savedAcknowledgement?.disabled).toBe(false);
    expect(savedConfirm?.disabled).toBe(true);

    await act(async () => savedAcknowledgement?.click());
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="confirm-recovery-replacement"]')
        ?.disabled,
    ).toBe(false);
    await act(async () => savedConfirm?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("returns an internal problem when the consumed attachment cannot be read", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const unreadable = new Response(null, { status: 200 });
    vi.spyOn(unreadable, "blob").mockRejectedValue(new Error("body cancelled"));
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "csrf-proof" })))
      .mockResolvedValueOnce(unreadable);
    vi.stubGlobal("fetch", fetchMock);

    const api = new SecurityApi("https://notes.example");
    await api.currentSession();
    const result = await api.downloadRecoveryKit(kit.kitId);

    expect(result).toEqual({
      ok: false,
      problem: {
        type: "https://myownnotion.dev/problems/network",
        title: "Server unreachable",
        status: 503,
        code: "service_unavailable",
        correlationId: null,
      },
      consumed: true,
    });
  });

  it("runs the full replacement handler through download, acknowledgement, and confirmation", async () => {
    const { api } = makeSecuritySettingsApi();
    stubDesktopSave({ ok: true, canceled: false });
    await renderSettings(api);

    await clickSettings("prepare-recovery-replacement");
    await clickSettings("download-recovery-replacement");
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid=download-recovery-replacement]")
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>("[data-testid=acknowledge-recovery-replacement]")
        ?.disabled,
    ).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLInputElement>("[data-testid=acknowledge-recovery-replacement]")
        ?.click();
    });
    await clickSettings("confirm-recovery-replacement");
    expect(api.confirmRecoveryKit).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-testid=recovery-replacement-panel]")).toBeNull();
  });

  it.each([
    ["cancellation", { ok: true, canceled: true } as const],
    ["save failure", { ok: false, message: "dialog failed" } as const],
  ])("keeps a desktop %s consumed kit blocked from confirmation", async (_label, saveResult) => {
    const { api } = makeSecuritySettingsApi();
    stubDesktopSave(saveResult);
    await renderSettings(api);

    await clickSettings("prepare-recovery-replacement");
    await clickSettings("download-recovery-replacement");
    expect(
      container.querySelector("[data-testid=recovery-replacement-message]")?.textContent,
    ).toContain("Préparez un nouveau kit");
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid=download-recovery-replacement]")
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>("[data-testid=acknowledge-recovery-replacement]")
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid=confirm-recovery-replacement]")
        ?.disabled,
    ).toBe(true);
    expect(api.downloadRecoveryKit).toHaveBeenCalledOnce();
  });

  it("marks a body-read failure as consumed and prevents a second download", async () => {
    const { api } = makeSecuritySettingsApi({
      downloadResult: { ok: false, problem: networkProblem, consumed: true },
    });
    await renderSettings(api);

    await clickSettings("prepare-recovery-replacement");
    await clickSettings("download-recovery-replacement");
    expect(
      container.querySelector("[data-testid=recovery-replacement-message]")?.textContent,
    ).toContain("téléchargement a été consommé");
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid=download-recovery-replacement]")
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>("[data-testid=acknowledge-recovery-replacement]")
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid=confirm-recovery-replacement]")
        ?.disabled,
    ).toBe(true);

    await clickSettings("download-recovery-replacement");
    expect(api.downloadRecoveryKit).toHaveBeenCalledOnce();
  });

  it("resumes a consumed pending kit after reload without enabling another download", async () => {
    const { api } = makeSecuritySettingsApi({
      initialPending: {
        kitId: kit.kitId,
        deliveryState: "download-consumed",
        downloadExpiresAt: kit.downloadExpiresAt,
      },
    });
    await renderSettings(api);

    expect(
      container.querySelector("[data-testid=recovery-replacement-message]")?.textContent,
    ).toContain("déjà été téléchargé");
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid=download-recovery-replacement]")
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>("[data-testid=acknowledge-recovery-replacement]")
        ?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>("[data-testid=confirm-recovery-replacement]")
        ?.disabled,
    ).toBe(true);
    expect(api.downloadRecoveryKit).not.toHaveBeenCalled();
  });

  it("shows only the returned revocation code after revocation", async () => {
    const { api } = makeSecuritySettingsApi();
    await renderSettings(api);

    await clickSettings("revoke-recovery-kit");
    await clickSettings("confirm-revoke-recovery-kit");
    expect(container.querySelector("[data-testid=security-message]")?.textContent).toContain(
      "Code de révocation : revoked-1.",
    );
  });

  it("uses a second explicit step before revoking the active kit", async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        <RecoveryReadinessPanel
          status={{
            active: { kitId: "active-kit", recoveryEpoch: 2, confirmedAt: "2026-09-12T12:00:00Z" },
            pending: null,
            notice: kit.notice,
          }}
          busy={false}
          onPrepareReplacement={vi.fn()}
          onRevoke={onRevoke}
        />,
      ),
    );

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="revoke-recovery-kit"]')?.click(),
    );
    expect(onRevoke).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="confirm-revoke-recovery-kit"]')).not.toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="confirm-revoke-recovery-kit"]')
        ?.click(),
    );
    expect(onRevoke).toHaveBeenCalledOnce();
  });
});
