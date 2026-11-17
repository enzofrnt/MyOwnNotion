import { setSessionCsrf } from "./session-csrf.ts";
/**
 * Typed security API boundary (T033, feature 002).
 *
 * Three rules this module exists to hold, all of which are easy to lose in a
 * refactor because nothing in the type system enforces them:
 *
 *   - **The capability lives in memory for the life of the page, and nowhere
 *     else.** Not `localStorage`, not `sessionStorage`, not a cookie, not the
 *     URL. Every one of those outlives the attempt: storage survives the tab,
 *     and a URL lands in history and `Referer`. Losing the capability on
 *     reload is the correct trade — the owner starts a new attempt, which
 *     costs seconds; a leaked capability costs the installation.
 *   - **The kit is never held as a string.** It is read as a `Blob` and handed
 *     straight to a download, so the recovery material never becomes a React
 *     state value that a devtools snapshot or an error reporter would capture.
 *   - **Problem documents are returned, never thrown.** The first-run page has
 *     to render a refusal as guidance; an exception would collapse the page
 *     the owner is trying to use.
 */

import {
  type AccountSessionDto,
  type AdminAccountListDto,
  type AdminAccountViewDto,
  type AuthenticatedSessionDto,
  BOOTSTRAP_CAPABILITY_HEADER,
  type BrowserDeviceClaimDto,
  CSRF_TOKEN_HEADER,
  type DeviceDto,
  type FullBackupRehearsal,
  type FullBackupStatus,
  type InstallationStatusDto,
  type InvitationCreatedDto,
  type InvitationListDto,
  type ItemDto,
  type McpConnectionView,
  type McpGrant,
  type McpGrantResult,
  type MeDto,
  type PasskeyViewDto,
  type RegistrationSettingsDto,
  type RotationPolicyViewDto,
  type SecurityProblemDto,
  type SessionViewDto,
} from "@myownnotion/contracts";
import { browserDeviceIdentity } from "../features/auth/browser-device-identity.ts";
import type { ClientRuntimeProfile } from "../runtime/client-runtime.ts";

/**
 * A refusal the page can render.
 *
 * `correlationId` is nullable because some refusals never reached the server:
 * an unreachable host produces no server log line, so there is nothing to
 * correlate with. Synthesising an id here would hand the owner a reference
 * number that appears in no log — worse than admitting there is none.
 */
export type ClientProblem = Omit<SecurityProblemDto, "correlationId"> & {
  readonly correlationId: string | null;
};

/**
 * What `GET /v1/security/rotations` answers.
 *
 * Declared here rather than imported because the route composes it inline
 * from the policy view and the running operations; this is the shape of that
 * composition, and it belongs with the client that consumes it.
 */
export interface RotationStatusView {
  readonly policies: readonly RotationPolicyViewDto[];
  readonly writesAllowed: boolean;
  readonly running: readonly {
    readonly operationId: string;
    readonly kind: "wrapping-key" | "data-key";
    readonly mode: string;
    readonly phase: string;
    readonly fromVersionOrGeneration: number;
    readonly toVersionOrGeneration: number;
    readonly processedCount: number;
    readonly totalCount: number;
  }[];
}

/** What `GET /v1/security/recovery-kits` answers. */
export interface RecoveryStatusView {
  readonly active: {
    readonly kitId: string;
    readonly recoveryEpoch: number;
    readonly confirmedAt: string | null;
  } | null;
  readonly pending: {
    readonly kitId: string;
    readonly deliveryState: string;
    readonly downloadExpiresAt: string | null;
  } | null;
  /** What the owner must also keep. Part of the payload, not documentation. */
  readonly notice: string;
}

export interface PreparedRecoveryKit {
  readonly kitId: string;
  readonly recoveryEpoch: number;
  readonly downloadExpiresAt: string;
  readonly notice: string;
}

export interface ConfirmedRecoveryKit {
  readonly recoveryEpoch: number;
  readonly notice: string;
}

export interface RevokedRecoveryKit {
  readonly revocationCode: string;
}

/** Safe backup facts returned to the authenticated owner. */
export interface BackupStatusView {
  readonly lastVerifiedAt: string | null;
  readonly lastVerifiedBackupId: string | null;
  readonly latestBackupAt: string | null;
  readonly latestBackupId: string | null;
  readonly latestCreationVerification: "passed" | "failed" | null;
  readonly latestTransferVerification: "passed" | "failed" | null;
  readonly lastRehearsalAt: string | null;
  readonly lastRehearsalOutcome: "succeeded" | "failed" | null;
  readonly stale: boolean;
  readonly rehearsalDue: boolean;
}

export interface McpAuditEvent {
  id: string;
  action: string;
  connectionId: string;
  outcome: string;
  occurredAt: string;
}

export interface BackupRehearsalResult {
  readonly outcome: "succeeded";
  readonly restoredItemCount: number;
  readonly restoredFileCount: number;
}

export type SecurityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ClientProblem };

/**
 * A download refusal also records whether the server has already consumed the
 * one-time response. A consumed response must never be retried by the UI.
 */
export type RecoveryDownloadResult =
  | { readonly ok: true; readonly value: Blob }
  | { readonly ok: false; readonly problem: ClientProblem; readonly consumed: boolean };

const UNREACHABLE: ClientProblem = {
  type: "https://myownnotion.dev/problems/network",
  title: "Server unreachable",
  status: 503,
  code: "service_unavailable",
  correlationId: null,
};

/**
 * Generates the client nonce that ties a claim to this page load.
 *
 * `crypto.getRandomValues` rather than `Math.random`: the nonce is what a
 * concurrent second browser must not be able to guess or collide with.
 */
export function newClientNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class SecurityApi {
  readonly #baseUrl: string;
  readonly #deviceIdentity: () => BrowserDeviceClaimDto;

  /**
   * Memory only, and deliberately not React state: a re-render must not be
   * able to drop it, and a state snapshot must not be able to capture it.
   */
  #capability: string | null = null;

  constructor(
    baseUrl: string | ClientRuntimeProfile = import.meta.env["VITE_API_URL"] ?? "",
    deviceIdentity: () => BrowserDeviceClaimDto = () => browserDeviceIdentity.getOrCreate(),
  ) {
    const resolved = typeof baseUrl === "string" ? baseUrl : baseUrl.apiBaseUrl;
    this.#baseUrl = resolved.replace(/\/$/, "");
    this.#deviceIdentity = deviceIdentity;
  }

  /** True once an attempt is in flight on this page. */
  get hasCapability(): boolean {
    return this.#capability !== null;
  }

  /**
   * The CSRF token for the current session.
   *
   * Memory only, like the capability. It is delivered in a response body and
   * sent back in a header; putting it in storage would outlive the session it
   * protects, and putting it in a URL would put it in history and `Referer`.
   */
  #csrfToken: string | null = null;

  /** Forgets the capability. Called when an attempt ends, however it ends. */
  forget(): void {
    this.#capability = null;
  }

  /** True once this page holds a session's CSRF token. */
  get hasCsrfToken(): boolean {
    return this.#csrfToken !== null;
  }

  /**
   * Supplies the current tab's memory-only token to other same-origin write
   * transports. Callers must use it immediately as a header and never persist
   * or place it in a URL.
   */
  csrfTokenForSameOriginWrite(): string | null {
    return this.#csrfToken;
  }

  async #send(
    path: string,
    init: RequestInit & { acceptsCookie?: boolean } = {},
  ): Promise<Response | null> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (this.#capability !== null) {
      headers.set(BOOTSTRAP_CAPABILITY_HEADER, this.#capability);
    }
    try {
      return await fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers,
        // Bootstrap is session-free by design, so no cookies are sent — and
        // with `omit` the browser also refuses to *store* any the response
        // sets. That matters at exactly one point: the confirmation, which is
        // where the installation stops being session-free and the server signs
        // the new owner in. That call opts in.
        credentials: init.acceptsCookie === true ? "same-origin" : "omit",
      });
    } catch {
      return null;
    }
  }

  async #problem(response: Response): Promise<ClientProblem> {
    try {
      return (await response.json()) as ClientProblem;
    } catch {
      // A refusal with an unreadable body is still a refusal. Inventing a
      // code here would be worse than reporting the status we actually got.
      return {
        type: "https://myownnotion.dev/problems/internal",
        title: "Unexpected server response",
        status: response.status,
        code: "internal_error",
        correlationId: null,
      };
    }
  }

  async #json<T>(
    path: string,
    init: RequestInit & { acceptsCookie?: boolean } = {},
  ): Promise<SecurityResult<T>> {
    const response = await this.#send(path, init);
    if (response === null) {
      return { ok: false, problem: UNREACHABLE };
    }
    if (!response.ok) {
      return { ok: false, problem: await this.#problem(response) };
    }
    return { ok: true, value: (await response.json()) as T };
  }

  /** Reads installation status. Answers at every stage, including uninitialized. */
  async status(): Promise<SecurityResult<InstallationStatusDto>> {
    return await this.#json<InstallationStatusDto>("/v1/installation/status");
  }

  /**
   * First launch: creates the administrator and signs them in (feature 058).
   *
   * Accepts the session cookie the server sets, and adopts the CSRF token the
   * response carries, exactly like a sign-in.
   */
  async bootstrap(input: {
    email: string;
    pseudonym: string;
    password: string;
  }): Promise<SecurityResult<AccountSessionDto>> {
    const result = await this.#json<AccountSessionDto>("/v1/bootstrap", {
      method: "POST",
      body: JSON.stringify({ ...input, device: this.#deviceIdentity() }),
      acceptsCookie: true,
    });
    return this.#adoptAccountSession(result);
  }

  /** Self-service sign-up, open or through an invitation link's secret. */
  async signup(input: {
    email: string;
    pseudonym: string;
    password: string;
    invitation?: string;
  }): Promise<SecurityResult<AccountSessionDto>> {
    const result = await this.#json<AccountSessionDto>("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ ...input, device: this.#deviceIdentity() }),
      acceptsCookie: true,
    });
    return this.#adoptAccountSession(result);
  }

  #adoptAccountSession(
    result: SecurityResult<AccountSessionDto>,
  ): SecurityResult<AccountSessionDto> {
    if (result.ok) {
      this.#csrfToken = result.value.csrfToken;
      this.#accountEmail = result.value.account.email;
      setSessionCsrf(this.#baseUrl, this.#csrfToken);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Authenticated calls
  // -------------------------------------------------------------------------

  /**
   * Sends a request carrying the session cookie and, for writes, the CSRF
   * token.
   *
   * `credentials: "same-origin"` rather than `"include"`: the API is served
   * from this origin, and `include` would attach the cookie to a cross-origin
   * request if the base URL were ever pointed elsewhere.
   */
  async #sendAuthenticated(
    path: string,
    init: RequestInit & { csrf?: boolean } = {},
  ): Promise<Response | null> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (init.csrf === true && this.#csrfToken !== null) {
      headers.set(CSRF_TOKEN_HEADER, this.#csrfToken);
    }
    try {
      return await fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers,
        credentials: "same-origin",
      });
    } catch {
      return null;
    }
  }

  async #authenticatedJson<T>(
    path: string,
    init: RequestInit & { csrf?: boolean } = {},
  ): Promise<SecurityResult<T>> {
    const response = await this.#sendAuthenticated(path, init);
    if (response === null) {
      return { ok: false, problem: UNREACHABLE };
    }
    if (!response.ok) {
      return { ok: false, problem: await this.#problem(response) };
    }
    if (response.status === 204) {
      return { ok: true, value: undefined as T };
    }
    return { ok: true, value: (await response.json()) as T };
  }

  /** Signs in with a password and captures the session's CSRF token. */
  #adoptSession(
    result: SecurityResult<AuthenticatedSessionDto>,
  ): SecurityResult<AuthenticatedSessionDto> {
    if (result.ok) {
      this.#csrfToken = result.value.csrfToken;
      setSessionCsrf(this.#baseUrl, this.#csrfToken);
    }
    return result;
  }

  async loginWithPassword(
    email: string,
    password: string,
  ): Promise<SecurityResult<AuthenticatedSessionDto>> {
    const result = await this.#authenticatedJson<AuthenticatedSessionDto>(
      "/v1/auth/login/password",
      {
        method: "POST",
        body: JSON.stringify({ email, password, device: this.#deviceIdentity() }),
      },
    );
    return this.#adoptSession(result);
  }

  /** Begins a passkey sign-in by asking for a challenge. */
  async passkeyLoginOptions(): Promise<SecurityResult<{ challenge: string }>> {
    return await this.#authenticatedJson<{ challenge: string }>("/v1/auth/login/passkey/options", {
      method: "POST",
    });
  }

  async loginWithPasskey(credential: unknown): Promise<SecurityResult<AuthenticatedSessionDto>> {
    const result = await this.#authenticatedJson<AuthenticatedSessionDto>(
      "/v1/auth/login/passkey",
      {
        method: "POST",
        body: JSON.stringify({ credential, device: this.#deviceIdentity() }),
      },
    );
    return this.#adoptSession(result);
  }

  /**
   * Reads the current session, refreshing the held CSRF token.
   *
   * Called on load so a page reload recovers the token without a new sign-in:
   * the cookie survives the reload, so the session does, and only the token
   * needs fetching again.
   */
  async currentSession(): Promise<SecurityResult<AuthenticatedSessionDto>> {
    const result = await this.#authenticatedJson<AuthenticatedSessionDto>("/v1/auth/session");
    return this.#adoptSession(result);
  }

  async listSessions(): Promise<SecurityResult<{ sessions: SessionViewDto[] }>> {
    return await this.#authenticatedJson<{ sessions: SessionViewDto[] }>("/v1/auth/sessions");
  }

  async listPasskeys(): Promise<SecurityResult<{ passkeys: PasskeyViewDto[] }>> {
    return await this.#authenticatedJson<{ passkeys: PasskeyViewDto[] }>("/v1/auth/passkeys");
  }

  async revokeSession(sessionId: string): Promise<SecurityResult<void>> {
    return await this.#authenticatedJson<void>(`/v1/auth/sessions/${sessionId}`, {
      method: "DELETE",
      csrf: true,
    });
  }

  async revokeOtherSessions(): Promise<SecurityResult<void>> {
    return await this.#authenticatedJson<void>("/v1/auth/sessions/revoke-all", {
      method: "POST",
      csrf: true,
    });
  }

  mcpEndpoint(): string {
    return new URL(`${this.#baseUrl}/mcp`, window.location.href).href;
  }

  async listMcpConnections(): Promise<SecurityResult<{ connections: McpConnectionView[] }>> {
    return this.#authenticatedJson("/v1/mcp/connections");
  }

  async grantMcpConnection(grant: McpGrant): Promise<SecurityResult<McpGrantResult>> {
    return this.#authenticatedJson("/v1/mcp/connections", {
      method: "POST",
      csrf: true,
      body: JSON.stringify(grant),
    });
  }

  async revokeMcpConnection(id: string): Promise<SecurityResult<void>> {
    return this.#authenticatedJson(`/v1/mcp/connections/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      csrf: true,
    });
  }

  async listMcpAudit(): Promise<SecurityResult<{ events: McpAuditEvent[] }>> {
    return this.#authenticatedJson("/v1/mcp/audit");
  }

  async listMcpBranches(): Promise<SecurityResult<{ items: ItemDto[] }>> {
    return this.#authenticatedJson("/v1/items?lifecycle=active");
  }

  async listDevices(): Promise<SecurityResult<{ devices: DeviceDto[] }>> {
    return await this.#authenticatedJson<{ devices: DeviceDto[] }>("/v1/devices");
  }

  async renameDevice(deviceId: string, name: string): Promise<SecurityResult<DeviceDto>> {
    return await this.#authenticatedJson<DeviceDto>(`/v1/devices/${deviceId}`, {
      method: "PATCH",
      csrf: true,
      body: JSON.stringify({ name }),
    });
  }

  async setDeviceStorageLimit(
    deviceId: string,
    localStorageLimitBytes: number,
  ): Promise<SecurityResult<DeviceDto>> {
    return await this.#authenticatedJson<DeviceDto>(`/v1/devices/${deviceId}`, {
      method: "PATCH",
      csrf: true,
      body: JSON.stringify({ localStorageLimitBytes }),
    });
  }

  async revokeDevice(deviceId: string): Promise<SecurityResult<DeviceDto>> {
    return await this.#authenticatedJson<DeviceDto>(`/v1/devices/${deviceId}/revoke`, {
      method: "POST",
      csrf: true,
    });
  }

  async reauthorizeDevice(deviceId: string): Promise<SecurityResult<DeviceDto>> {
    return await this.#authenticatedJson<DeviceDto>(`/v1/devices/${deviceId}/reauthorize`, {
      method: "POST",
      csrf: true,
    });
  }

  /** Signs out of this browser and forgets the token it was holding. */
  async signOut(): Promise<SecurityResult<void>> {
    const result = await this.#authenticatedJson<void>("/v1/auth/session", {
      method: "DELETE",
      csrf: true,
    });
    this.#csrfToken = null;
    setSessionCsrf(this.#baseUrl, null);
    return result;
  }

  async setPassword(newPassword: string): Promise<SecurityResult<{ configured: boolean }>> {
    return await this.#authenticatedJson<{ configured: boolean }>("/v1/auth/password", {
      method: "PUT",
      csrf: true,
      body: JSON.stringify({ newPassword }),
    });
  }

  /**
   * Both rotation policies and whatever is running.
   *
   * A plain read with no recency requirement, matching the route: this is how
   * an owner discovers a rotation is overdue, and a re-authentication prompt
   * in front of it would discourage looking.
   */
  async rotationStatus(): Promise<SecurityResult<RotationStatusView>> {
    return await this.#authenticatedJson<RotationStatusView>("/v1/security/rotations");
  }

  async recoveryStatus(): Promise<SecurityResult<RecoveryStatusView>> {
    return await this.#authenticatedJson<RecoveryStatusView>("/v1/security/recovery-kits");
  }

  async backupStatus(): Promise<SecurityResult<BackupStatusView>> {
    return await this.#authenticatedJson<BackupStatusView>("/v1/backups/status");
  }

  async fullBackupStatus(): Promise<SecurityResult<FullBackupStatus>> {
    return await this.#authenticatedJson<FullBackupStatus>("/v1/backups/full/status");
  }

  async runFullBackupRehearsal(): Promise<SecurityResult<FullBackupRehearsal>> {
    return await this.#authenticatedJson<FullBackupRehearsal>("/v1/backups/full/rehearsals", {
      method: "POST",
      csrf: true,
    });
  }

  async runBackupRehearsal(): Promise<SecurityResult<BackupRehearsalResult>> {
    return await this.#authenticatedJson<BackupRehearsalResult>("/v1/backups/rehearsals", {
      method: "POST",
      csrf: true,
    });
  }

  async prepareRecoveryReplacement(): Promise<SecurityResult<PreparedRecoveryKit>> {
    return await this.#authenticatedJson<PreparedRecoveryKit>("/v1/security/recovery-kits", {
      method: "POST",
      csrf: true,
    });
  }

  /** Downloads a replacement kit as the one-time JSON attachment. */
  async downloadRecoveryKit(kitId: string): Promise<RecoveryDownloadResult> {
    const response = await this.#sendAuthenticated(
      `/v1/security/recovery-kits/${encodeURIComponent(kitId)}/download`,
      { method: "POST", csrf: true, headers: { Accept: "application/json" } },
    );
    if (response === null) {
      return { ok: false, problem: UNREACHABLE, consumed: false };
    }
    if (!response.ok) {
      const problem = await this.#problem(response);
      return {
        ok: false,
        problem,
        consumed: response.status === 409 && problem.code === "conflict",
      };
    }
    try {
      return { ok: true, value: await response.blob() };
    } catch {
      return { ok: false, problem: UNREACHABLE, consumed: true };
    }
  }

  /** Confirms storage after the owner has downloaded the replacement file. */
  async confirmRecoveryKit(kitId: string): Promise<SecurityResult<ConfirmedRecoveryKit>> {
    return await this.#authenticatedJson<ConfirmedRecoveryKit>(
      `/v1/security/recovery-kits/${encodeURIComponent(kitId)}/confirm`,
      {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ storedOffline: true }),
      },
    );
  }

  /** Revokes the currently active recovery kit. */
  async revokeRecoveryKit(): Promise<SecurityResult<RevokedRecoveryKit>> {
    return await this.#authenticatedJson<RevokedRecoveryKit>("/v1/security/recovery-kits/revoke", {
      method: "POST",
      csrf: true,
    });
  }

  // -------------------------------------------------------------------------
  // Accounts (feature 058)
  // -------------------------------------------------------------------------

  /** The signed-in account, remembered for re-authentication prompts. */
  async me(): Promise<SecurityResult<MeDto>> {
    const result = await this.#authenticatedJson<MeDto>("/v1/me");
    if (result.ok) this.#accountEmail = result.value.email;
    return result;
  }

  #accountEmail: string | null = null;

  /**
   * Proves possession again with the signed-in account's password — the
   * recent-authentication step sensitive actions ask for.
   */
  async reauthenticateWithPassword(
    password: string,
  ): Promise<SecurityResult<AuthenticatedSessionDto>> {
    if (this.#accountEmail === null) {
      const current = await this.me();
      if (!current.ok) return current;
    }
    return await this.loginWithPassword(this.#accountEmail ?? "", password);
  }

  async updateMe(changes: { email?: string; pseudonym?: string }): Promise<SecurityResult<MeDto>> {
    return await this.#authenticatedJson<MeDto>("/v1/me", {
      method: "PATCH",
      body: JSON.stringify(changes),
      csrf: true,
    });
  }

  async passkeyEnrollmentOptions(): Promise<SecurityResult<{ challenge: string }>> {
    return await this.#authenticatedJson<{ challenge: string }>(
      "/v1/auth/passkeys/enrollment/options",
      { method: "POST", csrf: true },
    );
  }

  async completePasskeyEnrollment(
    credential: Record<string, unknown>,
    label: string,
  ): Promise<SecurityResult<PasskeyViewDto>> {
    return await this.#authenticatedJson<PasskeyViewDto>("/v1/auth/passkeys/enrollment/complete", {
      method: "POST",
      body: JSON.stringify({ ...credential, label }),
      csrf: true,
    });
  }

  async listAccounts(): Promise<SecurityResult<AdminAccountListDto>> {
    return await this.#authenticatedJson<AdminAccountListDto>("/v1/admin/accounts");
  }

  async createAccount(input: {
    email: string;
    pseudonym: string;
    password: string;
  }): Promise<SecurityResult<AdminAccountViewDto>> {
    return await this.#authenticatedJson<AdminAccountViewDto>("/v1/admin/accounts", {
      method: "POST",
      body: JSON.stringify(input),
      csrf: true,
    });
  }

  async setAccountDisabled(accountId: string, disabled: boolean): Promise<SecurityResult<void>> {
    return await this.#authenticatedJson<void>(
      `/v1/admin/accounts/${encodeURIComponent(accountId)}/${disabled ? "disable" : "enable"}`,
      { method: "POST", csrf: true },
    );
  }

  async resetAccountPassword(accountId: string, password: string): Promise<SecurityResult<void>> {
    return await this.#authenticatedJson<void>(
      `/v1/admin/accounts/${encodeURIComponent(accountId)}/password`,
      { method: "POST", body: JSON.stringify({ password }), csrf: true },
    );
  }

  async deleteAccount(accountId: string, confirmEmail: string): Promise<SecurityResult<void>> {
    return await this.#authenticatedJson<void>(
      `/v1/admin/accounts/${encodeURIComponent(accountId)}`,
      { method: "DELETE", body: JSON.stringify({ confirmEmail }), csrf: true },
    );
  }

  async registrationSettings(): Promise<SecurityResult<RegistrationSettingsDto>> {
    return await this.#authenticatedJson<RegistrationSettingsDto>("/v1/admin/registration");
  }

  async setRegistrationMode(
    mode: RegistrationSettingsDto["mode"],
  ): Promise<SecurityResult<RegistrationSettingsDto>> {
    return await this.#authenticatedJson<RegistrationSettingsDto>("/v1/admin/registration", {
      method: "PUT",
      body: JSON.stringify({ mode }),
      csrf: true,
    });
  }

  async listInvitations(): Promise<SecurityResult<InvitationListDto>> {
    return await this.#authenticatedJson<InvitationListDto>("/v1/admin/invitations");
  }

  async createInvitation(input: {
    label?: string;
    maxUses?: number;
    expiresInDays?: number;
  }): Promise<SecurityResult<InvitationCreatedDto>> {
    return await this.#authenticatedJson<InvitationCreatedDto>("/v1/admin/invitations", {
      method: "POST",
      body: JSON.stringify(input),
      csrf: true,
    });
  }

  async revokeInvitation(invitationId: string): Promise<SecurityResult<void>> {
    return await this.#authenticatedJson<void>(
      `/v1/admin/invitations/${encodeURIComponent(invitationId)}`,
      { method: "DELETE", csrf: true },
    );
  }

  async removePasskey(credentialId: string): Promise<SecurityResult<void>> {
    return await this.#authenticatedJson<void>(
      `/v1/auth/passkeys/${encodeURIComponent(credentialId)}`,
      { method: "DELETE", csrf: true },
    );
  }
}
