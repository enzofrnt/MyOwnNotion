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
  BOOTSTRAP_CAPABILITY_HEADER,
  type BootstrapConfirmationResultDto,
  type BootstrapProgressDto,
  type BootstrapStartedDto,
  type InstallationStatusDto,
  type SecurityProblemDto,
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

  /** Forgets the capability. Called when an attempt ends, however it ends. */
  forget(): void {
    this.#capability = null;
  }

  async #send(path: string, init: RequestInit = {}): Promise<Response | null> {
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
        // No credentials: bootstrap is session-free by design, and sending
        // cookies here would create a session surface that must not exist yet.
        credentials: "omit",
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

  async #json<T>(path: string, init: RequestInit = {}): Promise<SecurityResult<T>> {
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
      { method: "POST", body: JSON.stringify({ storedOffline: true }) },
    );
    if (result.ok) {
      // The attempt is over: the capability authorizes nothing further, so
      // holding it is pure risk.
      this.#capability = null;
    }
    return result;
  }
}
