/**
 * Typed API boundary (T018).
 *
 * Every call validates identifiers client-side, sends the stable mutation
 * identity in the Idempotency-Key header, and surfaces problem documents as
 * typed results instead of thrown strings.
 */
import type {
  CanonicalSnapshotDto,
  ChangesResponseDto,
  CreateItemDto,
  FileContentMetadataDto,
  ItemDto,
  MutationResultDto,
  ProblemDto,
  QueuedMutationDto,
  QueuedMutationResultDto,
  RelationshipDto,
} from "@myownnotion/contracts";
import { isUuid, MAX_OFFLINE_FILE_BYTE_LENGTH, type Uuid } from "@myownnotion/domain";

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ProblemDto; readonly offline: boolean };

const OFFLINE_PROBLEM: ProblemDto = {
  type: "https://myownnotion.dev/problems/network",
  title: "Server unreachable",
  status: 503,
  code: "network.unreachable",
};

async function problemFromResponse(response: Response): Promise<ProblemDto> {
  try {
    return (await response.json()) as ProblemDto;
  } catch {
    return {
      type: "https://myownnotion.dev/problems/http",
      title: response.statusText,
      status: response.status,
      code: `http.${response.status}`,
    };
  }
}

function fileNameFromDisposition(disposition: string, fallback: string): string {
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (extended !== undefined) {
    try {
      return decodeURIComponent(extended);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function metadataFromFileResponse(
  response: Response,
  itemId: Uuid,
  revisionId: Uuid,
  fallbackName: string,
): FileContentMetadataDto | null {
  const contentId = response.headers.get("x-content-id");
  const sha256 = response.headers.get("x-content-sha256");
  const lengthText = response.headers.get("content-length");
  const dispositionHeader = response.headers.get("content-disposition") ?? "attachment";
  const mediaType = (response.headers.get("content-type") ?? "application/octet-stream")
    .split(";", 1)[0]
    ?.trim();
  const byteLength = lengthText === null ? Number.NaN : Number(lengthText);
  if (
    !isUuid(contentId) ||
    sha256 === null ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    mediaType === undefined ||
    mediaType.length < 3
  ) {
    return null;
  }
  return {
    itemId,
    revisionId,
    contentId,
    name: fileNameFromDisposition(dispositionHeader, fallbackName),
    mediaType,
    byteLength,
    sha256,
    disposition: dispositionHeader.toLowerCase().startsWith("inline;") ? "inline" : "attachment",
    cacheEligibility: byteLength <= MAX_OFFLINE_FILE_BYTE_LENGTH,
  };
}

export class ContentApi {
  readonly #baseUrl: string;

  constructor(baseUrl: string = import.meta.env["VITE_API_URL"] ?? "") {
    // Default: same-origin — the dev/preview server proxies /v1 and /health
    // to the loopback API, so no CORS surface exists.
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async #request<T>(
    path: string,
    init: RequestInit & { mutationId?: Uuid } = {},
  ): Promise<ApiResult<T>> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !(init.body instanceof FormData)) {
      headers.set("content-type", "application/json");
    }
    if (init.mutationId !== undefined) {
      headers.set("idempotency-key", init.mutationId);
    }
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, { ...init, headers });
    } catch {
      return { ok: false, problem: OFFLINE_PROBLEM, offline: true };
    }
    if (!response.ok) {
      const problem = await problemFromResponse(response);
      return { ok: false, problem, offline: false };
    }
    return { ok: true, value: (await response.json()) as T };
  }

  async health(): Promise<ApiResult<{ status: "ready"; schemaVersion: number }>> {
    return this.#request("/health");
  }

  async listItems(filter?: {
    parentItemId?: Uuid | "root";
    lifecycle?: "active" | "trashed";
  }): Promise<ApiResult<{ items: ItemDto[] }>> {
    const params = new URLSearchParams();
    if (filter?.parentItemId !== undefined) {
      params.set("parentItemId", filter.parentItemId);
    }
    if (filter?.lifecycle !== undefined) {
      params.set("lifecycle", filter.lifecycle);
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return this.#request(`/v1/items${query}`);
  }

  async getItem(itemId: Uuid): Promise<ApiResult<ItemDto>> {
    return this.#request(`/v1/items/${itemId}`);
  }

  async createItem(mutationId: Uuid, body: CreateItemDto): Promise<ApiResult<MutationResultDto>> {
    return this.#request("/v1/items", { method: "POST", body: JSON.stringify(body), mutationId });
  }

  async renameItem(
    mutationId: Uuid,
    itemId: Uuid,
    baseRevisionId: Uuid,
    name: string,
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ baseRevisionId, name }),
      mutationId,
    });
  }

  async trashItem(mutationId: Uuid, itemId: Uuid): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/items/${itemId}/trash`, { method: "POST", mutationId });
  }

  async restoreItem(
    mutationId: Uuid,
    itemId: Uuid,
    fallbackParentItemId?: Uuid | null,
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/items/${itemId}/restore`, {
      method: "POST",
      body: JSON.stringify(fallbackParentItemId !== undefined ? { fallbackParentItemId } : {}),
      mutationId,
    });
  }

  async movePlacement(
    mutationId: Uuid,
    placementId: Uuid,
    parentItemId: Uuid | null,
    positionKey: string,
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/placements/${placementId}/move`, {
      method: "POST",
      body: JSON.stringify({ parentItemId, positionKey }),
      mutationId,
    });
  }

  async removePlacement(
    mutationId: Uuid,
    placementId: Uuid,
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/placements/${placementId}`, { method: "DELETE", mutationId });
  }

  async addFilePlacement(
    mutationId: Uuid,
    itemId: Uuid,
    placement: { kind: "hierarchy" | "attachment"; parentItemId: Uuid | null; positionKey: string },
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/items/${itemId}/placements`, {
      method: "POST",
      body: JSON.stringify(placement),
      mutationId,
    });
  }

  async replacePageDocument(
    mutationId: Uuid,
    itemId: Uuid,
    baseRevisionId: Uuid,
    document: { format: "myownnotion.document+json"; formatVersion: number; body: object },
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/pages/${itemId}/document`, {
      method: "PUT",
      body: JSON.stringify({ baseRevisionId, document }),
      mutationId,
    });
  }

  async importFile(
    mutationId: Uuid,
    file: File,
    placement: { kind: "hierarchy" | "attachment"; parentItemId: Uuid | null; positionKey: string },
  ): Promise<ApiResult<MutationResultDto>> {
    const form = new FormData();
    form.set("placement", JSON.stringify(placement));
    form.set("file", file);
    return this.#request("/v1/files", { method: "POST", body: form, mutationId });
  }

  async replaceFileContent(
    mutationId: Uuid,
    itemId: Uuid,
    baseRevisionId: Uuid,
    file: File,
  ): Promise<ApiResult<MutationResultDto>> {
    const form = new FormData();
    form.set("baseRevisionId", baseRevisionId);
    form.set("file", file);
    return this.#request(`/v1/files/${itemId}/content`, {
      method: "PUT",
      body: form,
      mutationId,
    });
  }

  fileContentUrl(itemId: Uuid, revisionId: Uuid): string {
    const query = new URLSearchParams({ revisionId });
    return `${this.#baseUrl}/v1/files/${itemId}/content?${query.toString()}`;
  }

  async inspectFileContent(
    itemId: Uuid,
    revisionId: Uuid,
    fallbackName: string,
  ): Promise<ApiResult<FileContentMetadataDto>> {
    let response: Response;
    try {
      response = await fetch(this.fileContentUrl(itemId, revisionId), { method: "HEAD" });
    } catch {
      return { ok: false, problem: OFFLINE_PROBLEM, offline: true };
    }
    if (!response.ok) {
      return { ok: false, problem: await problemFromResponse(response), offline: false };
    }
    const metadata = metadataFromFileResponse(response, itemId, revisionId, fallbackName);
    if (metadata === null) {
      return {
        ok: false,
        offline: false,
        problem: {
          type: "https://myownnotion.dev/problems/file.integrity-failed",
          title: "File metadata failed integrity verification",
          status: 502,
          code: "file.integrity-failed",
        },
      };
    }
    return { ok: true, value: metadata };
  }

  async fetchFileContent(
    itemId: Uuid,
    revisionId: Uuid,
    fallbackName: string,
  ): Promise<
    ApiResult<{
      metadata: FileContentMetadataDto;
      blob: Blob;
      source: "network" | "offline-cache";
    }>
  > {
    let response: Response;
    try {
      response = await fetch(this.fileContentUrl(itemId, revisionId));
    } catch {
      return { ok: false, problem: OFFLINE_PROBLEM, offline: true };
    }
    if (!response.ok) {
      return { ok: false, problem: await problemFromResponse(response), offline: false };
    }
    const metadata = metadataFromFileResponse(response, itemId, revisionId, fallbackName);
    if (metadata === null) {
      return {
        ok: false,
        offline: false,
        problem: {
          type: "https://myownnotion.dev/problems/file.integrity-failed",
          title: "File metadata failed integrity verification",
          status: 502,
          code: "file.integrity-failed",
        },
      };
    }
    const blob = await response.blob();
    if (blob.size !== metadata.byteLength) {
      return {
        ok: false,
        offline: false,
        problem: {
          type: "https://myownnotion.dev/problems/file.integrity-failed",
          title: "Downloaded file length failed integrity verification",
          status: 502,
          code: "file.integrity-failed",
        },
      };
    }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return {
      ok: true,
      value: { metadata, blob, source: offline ? "offline-cache" : "network" },
    };
  }

  async listRelationships(itemId?: Uuid): Promise<ApiResult<{ relationships: RelationshipDto[] }>> {
    const query = itemId === undefined ? "" : `?itemId=${itemId}`;
    return this.#request(`/v1/relationships${query}`);
  }

  async createRelationship(
    mutationId: Uuid,
    body: {
      id: Uuid;
      sourceItemId: Uuid;
      targetItemId: Uuid;
      relationType: string;
      metadata?: object;
    },
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request("/v1/relationships", {
      method: "POST",
      body: JSON.stringify(body),
      mutationId,
    });
  }

  async removeRelationship(
    mutationId: Uuid,
    relationshipId: Uuid,
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/relationships/${relationshipId}`, { method: "DELETE", mutationId });
  }

  async getRevision(revisionId: Uuid): Promise<ApiResult<Record<string, unknown>>> {
    return this.#request(`/v1/revisions/${revisionId}`);
  }

  async restoreRevision(
    mutationId: Uuid,
    revisionId: Uuid,
    currentRevisionId: Uuid,
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/revisions/${revisionId}/restore`, {
      method: "POST",
      body: JSON.stringify({ currentRevisionId }),
      mutationId,
    });
  }

  async listChanges(after: string, limit = 200): Promise<ApiResult<ChangesResponseDto>> {
    const params = new URLSearchParams({ after, limit: String(limit) });
    return this.#request(`/v1/changes?${params.toString()}`);
  }

  async currentSnapshot(): Promise<ApiResult<CanonicalSnapshotDto>> {
    return this.#request("/v1/snapshots/current");
  }

  async submitMutationBatch(
    mutations: QueuedMutationDto[],
  ): Promise<ApiResult<{ results: QueuedMutationResultDto[] }>> {
    return this.#request("/v1/mutations/batch", {
      method: "POST",
      body: JSON.stringify({ mutations }),
    });
  }
}
