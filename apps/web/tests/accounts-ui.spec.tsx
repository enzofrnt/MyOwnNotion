// @vitest-environment jsdom
/**
 * Account surfaces (feature 058): first launch, invitation sign-up and the
 * administration document, driven against a fake client.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootstrapPage } from "../src/features/auth/bootstrap-page.tsx";
import { SignupPage } from "../src/features/auth/signup-page.tsx";
import { AdministrationSettings } from "../src/features/settings/administration-settings.tsx";
import type { SecurityApi } from "../src/services/security-api.ts";

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

function type(container: HTMLElement, testId: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (input === null) throw new Error(`missing ${testId}`);
  setValue?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const session = {
  ok: true,
  value: {
    account: { accountId: "a", email: "a@example.test", pseudonym: "A", role: "administrator" },
    session: { sessionId: "s" },
    csrfToken: "t",
  },
} as const;

describe("account surfaces", () => {
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
    window.history.replaceState(null, "", "/");
  });

  it("creates the administrator from one form and moves on", async () => {
    const api = {
      status: vi.fn().mockResolvedValue({ ok: true, value: { ownerCount: 0 } }),
      bootstrap: vi.fn().mockResolvedValue(session),
    } as unknown as SecurityApi;
    const onReady = vi.fn();
    await act(async () => root.render(<BootstrapPage api={api} onReady={onReady} />));
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="bootstrap-submit"]');
    expect(submit?.disabled).toBe(true);
    await act(async () => {
      type(container, "bootstrap-email", "admin@example.test");
      type(container, "bootstrap-pseudonym", "Admin");
      type(container, "bootstrap-password", "correct horse battery staple");
      type(container, "bootstrap-password-confirm", "correct horse battery staple");
    });
    expect(submit?.disabled).toBe(false);
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(api.bootstrap).toHaveBeenCalledWith({
      email: "admin@example.test",
      pseudonym: "Admin",
      password: "correct horse battery staple",
    });
    // jsdom has no WebAuthn: the passkey offer is skipped and setup finishes.
    expect(onReady).toHaveBeenCalled();
  });

  it("requires the same password twice before creating the administrator", async () => {
    const api = {
      status: vi.fn().mockResolvedValue({ ok: true, value: { ownerCount: 0 } }),
      bootstrap: vi.fn().mockResolvedValue(session),
    } as unknown as SecurityApi;
    await act(async () => root.render(<BootstrapPage api={api} onReady={vi.fn()} />));
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="bootstrap-submit"]');
    await act(async () => {
      type(container, "bootstrap-email", "admin@example.test");
      type(container, "bootstrap-pseudonym", "Admin");
      type(container, "bootstrap-password", "correct horse battery staple");
      type(container, "bootstrap-password-confirm", "correct horse battery stapl");
    });
    expect(container.textContent).toContain("Les mots de passe ne correspondent pas.");
    expect(submit?.disabled).toBe(true);
    await act(async () => {
      type(container, "bootstrap-password-confirm", "correct horse battery staple");
    });
    expect(container.textContent).not.toContain("Les mots de passe ne correspondent pas.");
    expect(submit?.disabled).toBe(false);
  });

  it("explains an installation that already has an administrator", async () => {
    const api = {
      status: vi.fn().mockResolvedValue({ ok: true, value: { ownerCount: 0 } }),
      bootstrap: vi.fn().mockResolvedValue({
        ok: false,
        problem: {
          status: 409,
          code: "already_initialized",
          title: "x",
          type: "x",
          correlationId: null,
        },
      }),
    } as unknown as SecurityApi;
    await act(async () => root.render(<BootstrapPage api={api} />));
    await act(async () => {
      type(container, "bootstrap-email", "late@example.test");
      type(container, "bootstrap-pseudonym", "Late");
      type(container, "bootstrap-password", "correct horse battery staple");
      type(container, "bootstrap-password-confirm", "correct horse battery staple");
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="bootstrap-message"]')?.textContent).toContain(
      "déjà un administrateur",
    );
  });

  it("takes an invitation secret out of the address bar and posts it in the body", async () => {
    const secret = "A".repeat(43);
    window.history.replaceState(null, "", `/join#${secret}`);
    const api = { signup: vi.fn().mockResolvedValue(session) } as unknown as SecurityApi;
    const onSignedIn = vi.fn();
    await act(async () =>
      root.render(
        <SignupPage api={api} mode="invitation" onSignedIn={onSignedIn} onBackToLogin={vi.fn()} />,
      ),
    );
    expect(window.location.hash).toBe("");
    await act(async () => {
      type(container, "signup-email", "invited@example.test");
      type(container, "signup-pseudonym", "Invitée");
      type(container, "signup-password", "correct horse battery staple");
      type(container, "signup-password-confirm", "correct horse battery staple");
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(api.signup).toHaveBeenCalledWith(expect.objectContaining({ invitation: secret }));
    expect(onSignedIn).toHaveBeenCalled();
  });

  it("says plainly when an invitation link can no longer be used", async () => {
    window.history.replaceState(null, "", `/join#${"B".repeat(43)}`);
    const api = {
      signup: vi.fn().mockResolvedValue({
        ok: false,
        problem: {
          status: 410,
          code: "invitation_unavailable",
          title: "x",
          type: "x",
          correlationId: null,
        },
      }),
    } as unknown as SecurityApi;
    await act(async () =>
      root.render(
        <SignupPage api={api} mode="invitation" onSignedIn={vi.fn()} onBackToLogin={vi.fn()} />,
      ),
    );
    await act(async () => {
      type(container, "signup-email", "late@example.test");
      type(container, "signup-pseudonym", "Late");
      type(container, "signup-password", "correct horse battery staple");
      type(container, "signup-password-confirm", "correct horse battery staple");
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="signup-message"]')?.textContent).toContain(
      "n’est plus utilisable",
    );
  });

  it("lists accounts, protects the administrator row and shows link usage", async () => {
    const api = {
      listAccounts: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          accounts: [
            {
              accountId: "admin",
              email: "admin@example.test",
              pseudonym: "Admin",
              role: "administrator",
              origin: "bootstrap",
              state: "active",
              invitationId: null,
              createdAt: "2026-11-16T00:00:00.000Z",
            },
            {
              accountId: "bea",
              email: "bea@example.test",
              pseudonym: "Bea",
              role: "member",
              origin: "invitation",
              state: "active",
              invitationId: "link",
              createdAt: "2026-11-16T00:00:00.000Z",
            },
          ],
        },
      }),
      registrationSettings: vi.fn().mockResolvedValue({ ok: true, value: { mode: "invitation" } }),
      listInvitations: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          invitations: [
            {
              invitationId: "link",
              label: "Famille",
              maxUses: 2,
              useCount: 1,
              expiresAt: null,
              state: "active",
              createdAt: "2026-11-16T00:00:00.000Z",
              accounts: [
                {
                  accountId: "bea",
                  email: "bea@example.test",
                  pseudonym: "Bea",
                  createdAt: "2026-11-16T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      }),
      setRegistrationMode: vi.fn().mockResolvedValue({ ok: true, value: { mode: "open" } }),
    } as unknown as SecurityApi;
    await act(async () =>
      root.render(<AdministrationSettings api={api} currentAccountId="admin" />),
    );
    const rows = container.querySelectorAll('[data-testid="account-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('[data-testid="delete-account"]')).toBeNull();
    expect(rows[1]?.querySelector('[data-testid="delete-account"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="invitation-uses"]')?.textContent).toContain(
      "1 / 2",
    );
    expect(container.querySelector('[data-testid="invitation-accounts"]')?.textContent).toContain(
      "Bea",
    );
    expect(container.querySelector('[data-testid="invitations-inactive"]')).toBeNull();
    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-testid="registration-mode-open"]')?.click();
    });
    expect(api.setRegistrationMode).toHaveBeenCalledWith("open");
  });
});
