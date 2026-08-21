/** Same-origin browser transport for protocol-v3 page operations. */

import type { PageSyncTransport, PageSyncTransportResult } from "@myownnotion/client-core";
import {
  type ActivatePageRequestDto,
  CSRF_TOKEN_HEADER,
  type LegacyOfflineBranchSyncRequestDto,
  PAGE_OPERATION_PROTOCOL_VERSION,
  type PageCheckpointResponseDto,
  type PageSyncRequestDto,
  parsePageSyncResponse,
} from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";

export interface PageOperationsApiOptions {
  readonly baseUrl?: string;
  /** Memory-only token owned by the current authenticated browser tab. */
  readonly csrfToken: () => string | null;
  readonly fetch?: typeof fetch;
}

export type PageActivationTransportResult =
  | { readonly ok: true; readonly value: PageCheckpointResponseDto }
  | Exclude<PageSyncTransportResult, { readonly ok: true }>;

const NETWORK_PROBLEM = {
  code: "network.unreachable",
  message: "The server is unreachable; durable local changes are retained.",
} as const;

const CSRF_PROBLEM = {
  code: "csrf_validation_failed",
  message: "The authenticated session must be refreshed before synchronization.",
} as const;

function safeProblem(value: unknown, status: number): { code: string; message: string } {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["code"] === "string") {
      return {
        code: record["code"],
        message:
          typeof record["message"] === "string"
            ? record["message"]
            : typeof record["title"] === "string"
              ? record["title"]
              : "Synchronization was refused.",
      };
    }
  }
  return { code: `http.${status}`, message: "Synchronization was refused." };
}

export class PageOperationsApi implements PageSyncTransport {
  readonly #baseUrl: string;
  readonly #csrfToken: () => string | null;
  readonly #fetch: typeof fetch;

  constructor(options: PageOperationsApiOptions) {
    this.#baseUrl = (options.baseUrl ?? import.meta.env["VITE_API_URL"] ?? "").replace(/\/$/, "");
    this.#csrfToken = options.csrfToken;
    // Bound explicitly: the global fetch is not a static method of window, and
    // storing it unbound makes every call throw `Illegal invocation` — which
    // this transport would then misreport as the server being unreachable.
    this.#fetch = options.fetch ?? fetch.bind(globalThis);
  }

  async #post(path: string, body: unknown): Promise<PageSyncTransportResult> {
    const csrfToken = this.#csrfToken();
    if (csrfToken === null) return { ok: false, offline: false, problem: CSRF_PROBLEM };
    const headers = new Headers({
      "content-type": "application/json",
      "x-myownnotion-client-protocol": String(PAGE_OPERATION_PROTOCOL_VERSION),
      [CSRF_TOKEN_HEADER]: csrfToken,
    });
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, offline: true, problem: NETWORK_PROBLEM };
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      value = null;
    }
    if (!response.ok) {
      return { ok: false, offline: false, problem: safeProblem(value, response.status) };
    }
    try {
      return { ok: true, value: parsePageSyncResponse(value) };
    } catch {
      return {
        ok: false,
        offline: false,
        problem: {
          code: "page-operations.projection-invalid",
          message: "The synchronization response did not match the negotiated protocol.",
        },
      };
    }
  }

  async sync(pageId: Uuid, request: PageSyncRequestDto): Promise<PageSyncTransportResult> {
    return await this.#post(`/v1/page-operations/${pageId}/sync`, request);
  }

  /**
   * Converts one offline semantic branch into shared operational history.
   *
   * The same `/sync` endpoint carries it: the server replays the branch's
   * semantic transactions onto the current head and answers with the active
   * checkpoint, so a page first edited offline joins shared history without
   * ever replacing a whole document.
   */
  async convertLegacyBranch(
    pageId: Uuid,
    request: LegacyOfflineBranchSyncRequestDto,
  ): Promise<PageSyncTransportResult> {
    return await this.#post(`/v1/page-operations/${pageId}/sync`, request);
  }

  async activate(
    pageId: Uuid,
    request: ActivatePageRequestDto,
  ): Promise<PageActivationTransportResult> {
    const result = await this.#post(`/v1/page-operations/${pageId}/activate`, request);
    if (!result.ok) return result;
    if (result.value.mode === "checkpoint") return { ok: true, value: result.value };
    return {
      ok: false,
      offline: false,
      problem: {
        code: "page-operations.projection-invalid",
        message: "Page activation returned an unexpected synchronization mode.",
      },
    };
  }
}
