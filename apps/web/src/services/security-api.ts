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
  type AuthenticatedSessionDto,
  BOOTSTRAP_CAPABILITY_HEADER,
  type BootstrapConfirmationResultDto,
  type BootstrapProgressDto,
  type BootstrapStartedDto,
  CSRF_TOKEN_HEADER,
  type DeviceDto,
  type InstallationStatusDto,
  type PasskeyViewDto,
  type RotationPolicyViewDto,
  type SecurityProblemDto,
  type SessionViewDto,
} from "@myownnotion/contracts";

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
 * What `GET /v1/security/rotation` answers.
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

/** What `GET /v1/security/recovery` answers. */
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

export interface BackupRehearsalResult {
  readonly outcome: "succeeded";
  readonly restoredItemCount: number;
  readonly restoredFileCount: number;
}

export type SecurityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ClientProblem };

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

  /**
   * Memory only, and deliberately not React state: a re-render must not be
   * able to drop it, and a state snapshot must not be able to capture it.
   */
  #capability: string | null = null;

  constructor(baseUrl: string = import.meta.env["VITE_API_URL"] ?? "") {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
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

  /** Claims the bootstrap attempt and captures the capability for this page. */
  async start(clientNonce: string): Promise<SecurityResult<BootstrapStartedDto>> {
    // Cleared first: a retry after a refusal must not send the old attempt's
    // capability against a new claim.
    this.#capability = null;
    const result = await this.#json<BootstrapStartedDto>("/v1/bootstrap", {
      method: "POST",
      body: JSON.stringify({ clientNonce }),
    });
    if (result.ok) {
      this.#capability = result.value.capability;
    }
    return result;
  }

  async verifyCredential(
    attemptId: string,
    credential: unknown,
  ): Promise<SecurityResult<BootstrapProgressDto>> {
    return await this.#json<BootstrapProgressDto>(`/v1/bootstrap/${attemptId}/credential`, {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
  }

  /**
   * Consumes the one-time download and returns the artifact as a blob.
   *
   * No request body: the capability is the only thing this client holds. The
   * blob is returned rather than parsed so the recovery material never exists
   * as a string in application state.
   */
  async downloadKit(attemptId: string): Promise<SecurityResult<Blob>> {
    const response = await this.#send(`/v1/bootstrap/${attemptId}/recovery/download`, {
      method: "POST",
    });
    if (response === null) {
      return { ok: false, problem: UNREACHABLE };
    }
    if (!response.ok) {
      return { ok: false, problem: await this.#problem(response) };
    }
    return { ok: true, value: await response.blob() };
  }

  async regenerateKit(attemptId: string): Promise<SecurityResult<BootstrapProgressDto>> {
    return await this.#json<BootstrapProgressDto>(
      `/v1/bootstrap/${attemptId}/recovery/regenerate`,
      {
        method: "POST",
      },
    );
  }

  /** The explicit offline confirmation that authorizes the atomic promotion. */
  async confirmStorage(attemptId: string): Promise<SecurityResult<BootstrapConfirmationResultDto>> {
    const result = await this.#json<BootstrapConfirmationResultDto>(
      `/v1/bootstrap/${attemptId}/recovery/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ storedOffline: true }),
        // The one bootstrap call that accepts a cookie: the server signs the
        // new owner in here, and with `omit` the browser would discard the
        // `Set-Cookie` and send the owner straight to a sign-in screen they
        // have no reason to see.
        acceptsCookie: true,
      },
    );
    if (result.ok) {
      // The attempt is over: the capability authorizes nothing further, so
      // holding it is pure risk.
      this.#capability = null;
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
  async loginWithPassword(password: string): Promise<SecurityResult<AuthenticatedSessionDto>> {
    const result = await this.#authenticatedJson<AuthenticatedSessionDto>(
      "/v1/auth/login/password",
      { method: "POST", body: JSON.stringify({ password }) },
    );
    if (result.ok) {
      this.#csrfToken = result.value.csrfToken;
    }
    return result;
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
      { method: "POST", body: JSON.stringify(credential) },
    );
    if (result.ok) {
      this.#csrfToken = result.value.csrfToken;
    }
    return result;
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
    if (result.ok) {
      this.#csrfToken = result.value.csrfToken;
    }
    return result;
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
    return await this.#authenticatedJson<RotationStatusView>("/v1/security/rotation");
  }

  async recoveryStatus(): Promise<SecurityResult<RecoveryStatusView>> {
    return await this.#authenticatedJson<RecoveryStatusView>("/v1/security/recovery");
  }

  async backupStatus(): Promise<SecurityResult<BackupStatusView>> {
    return await this.#authenticatedJson<BackupStatusView>("/v1/backups/status");
  }

  async runBackupRehearsal(): Promise<SecurityResult<BackupRehearsalResult>> {
    return await this.#authenticatedJson<BackupRehearsalResult>("/v1/backups/rehearsals", {
      method: "POST",
      csrf: true,
    });
  }

  async prepareRecoveryReplacement(): Promise<SecurityResult<{ kitId: string }>> {
    return await this.#authenticatedJson<{ kitId: string }>("/v1/security/recovery", {
      method: "POST",
      csrf: true,
    });
  }

  async removePasskey(credentialId: string): Promise<SecurityResult<void>> {
    return await this.#authenticatedJson<void>(
      `/v1/auth/passkeys/${encodeURIComponent(credentialId)}`,
      { method: "DELETE", csrf: true },
    );
  }
}
