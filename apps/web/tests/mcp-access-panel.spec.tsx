// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { McpAccessPanel } from "../src/features/security/mcp-access-panel.tsx";
import type { SecurityApi } from "../src/services/security-api.ts";

const success = <T,>(value: T) => ({ ok: true as const, value });
const failure = (code: string) => ({ ok: false as const, problem: { code, status: 428 } });
const connection = {
  id: "c1",
  label: "Assistant",
  scope: { actions: ["read"], allContent: true, branchRootIds: [], files: false },
  createdAt: "2026-09-05T12:00:00Z",
  expiresAt: null,
  lastUsedAt: null,
  status: "pending",
};
let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof mockApi>;
function mockApi() {
  return {
    listMcpConnections: vi.fn().mockResolvedValue(success({ connections: [] })),
    listMcpBranches: vi.fn().mockResolvedValue(success({ items: [] })),
    listMcpAudit: vi.fn().mockResolvedValue(success({ events: [] })),
    grantMcpConnection: vi.fn().mockResolvedValue(
      success({
        connection,
        exchangeCode: "private-one-use-code",
        exchangeExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    ),
    revokeMcpConnection: vi.fn().mockResolvedValue(success(undefined)),
    loginWithPassword: vi.fn().mockResolvedValue(success({})),
    mcpEndpoint: () => "https://notes.example/mcp",
  };
}
async function render(onReauthenticated = vi.fn()) {
  await act(async () =>
    root.render(
      <McpAccessPanel api={api as unknown as SecurityApi} onReauthenticated={onReauthenticated} />,
    ),
  );
}
function button(label: string) {
  const node = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  );
  if (!node) throw new Error(`Missing button ${label}`);
  return node;
}
function field(label: string) {
  const node = [...container.querySelectorAll("label")].find((entry) =>
    entry.textContent?.includes(label),
  );
  if (!node) throw new Error(`Missing field ${label}`);
  const input = node.querySelector("input") ?? document.getElementById(node.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing input");
  return input;
}
async function fill(label: string, value: string) {
  await act(async () => {
    const input = field(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(node: HTMLElement) {
  await act(async () => node.click());
}
async function submit() {
  await act(async () =>
    container
      .querySelector(".mcp-grant")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function prepare() {
  await fill("Nom de la connexion", "Assistant");
  await click(field("Tout l’espace"));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api = mockApi();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("requires explicit scope and unlimited acknowledgement and sends independent permissions", async () => {
  await render();
  await fill("Nom de la connexion", "Assistant");
  await submit();
  expect(api.grantMcpConnection).not.toHaveBeenCalled();
  await click(field("Tout l’espace"));
  await click(field("Sans expiration"));
  await submit();
  expect(api.grantMcpConnection).not.toHaveBeenCalled();
  await click(field("Je comprends"));
  await click(field("Rechercher"));
  await click(field("Modifier et renommer"));
  await click(field("Autoriser les fichiers"));
  await submit();
  expect(api.grantMcpConnection).toHaveBeenCalledWith({
    label: "Assistant",
    scope: { actions: ["read", "edit"], allContent: true, branchRootIds: [], files: true },
    lifetimeDays: null,
    acknowledgeUnlimited: true,
  });
});

it("retains a refused draft and requires an explicit retry after fresh identity", async () => {
  api.grantMcpConnection.mockResolvedValueOnce(failure("recent_authentication_required"));
  const refreshed = vi.fn();
  await render(refreshed);
  await prepare();
  await submit();
  expect(field("Nom de la connexion").value).toBe("Assistant");
  await fill("Mot de passe actuel", "owner password");
  await act(async () =>
    container
      .querySelector(".mcp-reauth form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(api.loginWithPassword).toHaveBeenCalledWith("owner password");
  expect(refreshed).toHaveBeenCalledOnce();
  expect(api.grantMcpConnection).toHaveBeenCalledOnce();
  await submit();
  expect(api.grantMcpConnection).toHaveBeenCalledTimes(2);
  expect(field("Code temporaire").value).toBe("private-one-use-code");
  expect(container.textContent).toContain(
    'https://notes.example/mcp/exchange avec le corps JSON {"code":"CODE_TEMPORAIRE"}',
  );
});

it("reports a failed inventory distinctly and retries without clearing the draft", async () => {
  api.listMcpConnections.mockResolvedValueOnce(failure("service_unavailable"));
  await render();
  await prepare();
  expect(button("Générer le code d’accès").disabled).toBe(true);
  expect(container.textContent).not.toContain("Aucun assistant autorisé.");
  await click(button("Actualiser les accès"));
  expect(button("Générer le code d’accès").disabled).toBe(false);
  expect(field("Nom de la connexion").value).toBe("Assistant");
});

it("clears the one-use code at expiry and ignores a late clipboard completion", async () => {
  vi.useFakeTimers();
  let resolveCopy: (() => void) | undefined;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveCopy = resolve;
          }),
      ),
    },
  });
  await render();
  await prepare();
  await submit();
  await click(button("Copier le code"));
  await act(async () => vi.advanceTimersByTime(600_001));
  expect(container.querySelector('[data-testid="mcp-code"]')).toBeNull();
  await act(async () => resolveCopy?.());
  expect(container.textContent).not.toContain("Code copié.");
  expect(container.textContent).toContain("Le code a expiré");
});

it("keeps a stable code copy control on refusal and allows a retry", async () => {
  const copy = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  await render();
  await prepare();
  await submit();
  const control = button("Copier le code");
  await click(control);
  expect(container.textContent).toContain("La copie a été refusée");
  expect(button("Copier le code")).toBe(control);
  await click(control);
  expect(copy).toHaveBeenLastCalledWith("private-one-use-code");
  expect(container.textContent).toContain("Code copié.");
});

it("keeps selected branches while filtering and renews only after another explicit grant", async () => {
  const scoped = {
    ...connection,
    scope: { actions: ["read"], allContent: false, branchRootIds: ["root"], files: false },
    status: "expired",
  };
  api.listMcpConnections.mockResolvedValue(success({ connections: [scoped] }));
  api.listMcpBranches.mockResolvedValue(
    success({
      items: [
        { id: "root", name: "Notes", lifecycle: "active", placements: [{ parentItemId: null }] },
        {
          id: "child",
          name: "Recherche",
          lifecycle: "active",
          placements: [{ parentItemId: "root" }],
        },
      ],
    }),
  );
  api.grantMcpConnection.mockResolvedValue(
    success({
      connection: { ...connection, id: "c2" },
      exchangeCode: "new-one-use-code",
      exchangeExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    }),
  );
  await render();
  await click(button("Renouveler par un nouvel accès"));
  expect(field("Notes").checked).toBe(true);
  expect(field("Durée en jours").value).toBe("90");
  expect(api.grantMcpConnection).not.toHaveBeenCalled();
  await fill("Filtrer les branches", "Recherche");
  expect(container.textContent).toContain("1 branche(s) sélectionnée(s).");
  await click(container.querySelector(".mcp-branches input") as HTMLInputElement);
  await submit();
  expect(api.grantMcpConnection.mock.calls[0]?.[0].scope.branchRootIds).toEqual(["root", "child"]);
});

it("reports a refused revoke, then revokes and removes the pending code on retry", async () => {
  await render();
  await prepare();
  await submit();
  api.revokeMcpConnection.mockResolvedValueOnce(failure("service_unavailable"));
  await click(button("Révoquer"));
  await click(
    document.querySelector(
      '[data-testid="mcp-revoke-dialog"] button[data-variant="danger"]',
    ) as HTMLElement,
  );
  expect(container.textContent).toContain("Rien n’a été mis en attente");
  expect(container.querySelector('[data-testid="mcp-code"]')).not.toBeNull();
  api.listMcpConnections.mockResolvedValue(
    success({ connections: [{ ...connection, status: "revoked" }] }),
  );
  await click(button("Révoquer"));
  await click(
    document.querySelector(
      '[data-testid="mcp-revoke-dialog"] button[data-variant="danger"]',
    ) as HTMLElement,
  );
  expect(api.revokeMcpConnection).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-testid="mcp-code"]')).toBeNull();
  expect(container.textContent).toContain("a été révoqué");
});

it("deduplicates a pending authorization and discards its result after leaving settings", async () => {
  let resolveGrant: ((value: unknown) => void) | undefined;
  api.grantMcpConnection.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveGrant = resolve;
      }),
  );
  await render();
  await prepare();
  await submit();
  await submit();
  expect(api.grantMcpConnection).toHaveBeenCalledOnce();
  await act(async () => root.render(<p>Autres réglages</p>));
  await act(async () =>
    resolveGrant?.(
      success({
        connection,
        exchangeCode: "late-secret",
        exchangeExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    ),
  );
  expect(container.textContent).toBe("Autres réglages");
});

it("refresh clears consumed codes and labels safe audit outcomes without rendering credentials", async () => {
  await render();
  await prepare();
  await submit();
  api.listMcpConnections.mockResolvedValue(
    success({ connections: [{ ...connection, status: "active" }] }),
  );
  api.listMcpAudit.mockResolvedValue(
    success({
      events: [
        {
          id: "event1",
          connectionId: "c1",
          action: "mcp.exchanged",
          outcome: "success",
          occurredAt: "2026-09-05T12:00:00Z",
        },
        {
          id: "event2",
          connectionId: "missing",
          action: "unknown",
          outcome: "refused",
          occurredAt: "2026-09-05T12:00:00Z",
        },
        {
          id: "event3",
          connectionId: "missing",
          action: "mcp.exchange-failed",
          outcome: "refused",
          occurredAt: "2026-09-05T12:00:00Z",
        },
        {
          id: "event4",
          connectionId: "missing",
          action: "mcp.authentication-failed",
          outcome: "refused",
          occurredAt: "2026-09-05T12:00:00Z",
        },
      ],
    }),
  );
  await click(button("Actualiser les accès"));
  expect(container.querySelector('[data-testid="mcp-code"]')).toBeNull();
  expect(container.textContent).toContain("Code échangé · Autorisé");
  expect(container.textContent).toContain("Code refusé · Refusé");
  expect(container.textContent).toContain("Authentification refusée · Refusé");
  expect(container.textContent).toContain("Connexion retirée · Opération MCP · Refusé");
  expect(container.textContent).not.toContain("private-one-use-code");
});
