/** Same-origin browser transport for protocol-v3 page operations. */

import type {
  PageAmbiguityTransportResult,
  PageSyncTransport,
  PageSyncTransportResult,
} from "@myownnotion/client-core";
import {
  type ActivatePageRequestDto,
  CSRF_TOKEN_HEADER,
  type EmptyPageSyncRequestDto,
  type LegacyOfflineBranchSyncRequestDto,
  MAX_PAGE_UPDATE_BATCH_BYTES,
  PAGE_OPERATION_PROTOCOL_VERSION,
  type PageCheckpointResponseDto,
  type PageSyncRequestDto,
  parsePageAmbiguityDetail,
  parsePageSyncResponse,
  parseResolvePageAmbiguityResponse,
  type ResolvePageAmbiguityResponseDto,
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

type PageTransportFailure = Exclude<PageSyncTransportResult, { readonly ok: true }>;

export type PageAmbiguityResolutionTransportResult =
  | { readonly ok: true; readonly value: ResolvePageAmbiguityResponseDto }
  | PageTransportFailure;

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

  async #postJson<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
    invalidMessage: string,
  ): Promise<{ readonly ok: true; readonly value: T } | PageTransportFailure> {
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
      return { ok: true, value: parse(value) };
    } catch {
      return {
        ok: false,
        offline: false,
        problem: {
          code: "page-operations.projection-invalid",
          message: invalidMessage,
        },
      };
    }
  }

  async #post(path: string, body: unknown): Promise<PageSyncTransportResult> {
    return await this.#postJson(
      path,
      body,
      parsePageSyncResponse,
      "The synchronization response did not match the negotiated protocol.",
    );
  }

  async sync(pageId: Uuid, request: PageSyncRequestDto): Promise<PageSyncTransportResult> {
    return await this.#post(`/v1/page-operations/${pageId}/sync`, request);
  }

  /**
   * Reads an already-active page's verified checkpoint without activating a
   * legacy page. A new device must join the existing CRDT history before it
   * edits; deriving a fresh branch from the materialized JSON would lose the
   * causal base that produced that projection.
   */
  async checkpoint(pageId: Uuid, requestId: Uuid): Promise<PageActivationTransportResult> {
    const request: EmptyPageSyncRequestDto = {
      mode: "empty",
      requestId,
      knownServerPageSequence: 0,
      maxRemoteBytes: MAX_PAGE_UPDATE_BATCH_BYTES,
    };
    const result = await this.#post(`/v1/page-operations/${pageId}/sync`, request);
    if (!result.ok) return result;
    if (result.value.mode === "checkpoint") return { ok: true, value: result.value };
    return {
      ok: false,
      offline: false,
      problem: {
        code: "page-operations.projection-invalid",
        message: "Page checkpoint retrieval returned an unexpected synchronization mode.",
      },
    };
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

  async getAmbiguity(ambiguityId: Uuid): Promise<PageAmbiguityTransportResult> {
    const headers = new Headers({
      accept: "application/json",
      "x-myownnotion-client-protocol": String(PAGE_OPERATION_PROTOCOL_VERSION),
    });
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/page-ambiguities/${ambiguityId}`, {
        method: "GET",
        headers,
        credentials: "same-origin",
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
      return { ok: true, value: parsePageAmbiguityDetail(value) };
    } catch {
      return {
        ok: false,
        offline: false,
        problem: {
          code: "page-operations.projection-invalid",
          message: "The ambiguity detail did not match the negotiated protocol.",
        },
      };
    }
  }

  /**
   * Submits the owner's decision for one ambiguity (T152).
   *
   * The resulting operations reach this device through the page's normal
   * catch-up, so the editor adopts them by identity like any other remote
   * merge — resolution is not a second writing path.
   */
  async resolveAmbiguity(
    ambiguityId: Uuid,
    request:
      | { requestId: Uuid; decision: "confirm-delete" }
      | {
          requestId: Uuid;
          decision: "restore-change";
          parentBlockId: Uuid | null;
          beforeBlockId: Uuid | null;
        },
  ): Promise<PageAmbiguityResolutionTransportResult> {
    return await this.#postJson(
      `/v1/page-ambiguities/${ambiguityId}/resolve`,
      request,
      parseResolvePageAmbiguityResponse,
      "The ambiguity resolution response did not match the negotiated protocol.",
    );
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
