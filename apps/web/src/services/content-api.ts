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
  CreateDatabaseRequestDto,
  CreateEntryRequestDto,
  CreateItemDto,
  DatabaseDto,
  DatabaseEntryDto,
  DatabaseMutationResultDto,
  DatabaseQueryDto,
  DatabaseQueryPageDto,
  DefinitionImpactDto,
  EntryMutationResultDto,
  FileUsageDto,
  ItemDto,
  MutationResultDto,
  ProblemDto,
  QueuedMutationDto,
  QueuedMutationResultDto,
  RelationshipDto,
  ReplaceDefinitionRequestDto,
  ReplaceEntryValuesRequestDto,
  SearchRequestDto,
  SearchResponseDto,
  TrashImpactDto,
} from "@myownnotion/contracts";
import { PROTOCOL_VERSION, type Uuid } from "@myownnotion/domain";
import type { ClientRuntimeProfile } from "../runtime/client-runtime.ts";
import { sessionCsrf } from "./session-csrf.ts";

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ProblemDto; readonly offline: boolean };

const OFFLINE_PROBLEM: ProblemDto = {
  type: "https://myownnotion.dev/problems/network",
  title: "Server unreachable",
  status: 503,
  code: "network.unreachable",
};

export class ContentApi {
  readonly #baseUrl: string;

  constructor(baseUrl: string | ClientRuntimeProfile = import.meta.env["VITE_API_URL"] ?? "") {
    // Default: same-origin — the dev/preview server proxies /v1 and /health
    // to the loopback API, so no CORS surface exists. Desktop passes a
    // validated runtime profile when the window is not yet on that origin.
    const resolved = typeof baseUrl === "string" ? baseUrl : baseUrl.apiBaseUrl;
    this.#baseUrl = resolved.replace(/\/$/, "");
  }

  /**
   * Where the live change stream lives (feature 006).
   *
   * A URL rather than a method returning events, because `EventSource` is the
   * thing doing the connecting: it reconnects on its own and resends
   * `Last-Event-ID` without being asked, and wrapping it in a promise-shaped
   * method would mean reimplementing both.
   */
  changeStreamUrl(): string {
    return `${this.#baseUrl}/v1/changes/stream`;
  }

  async #request<T>(
    path: string,
    init: RequestInit & { mutationId?: Uuid } = {},
  ): Promise<ApiResult<T>> {
    const headers = new Headers(init.headers);
    const csrf = sessionCsrf(this.#baseUrl);
    if (csrf !== null && !["GET", "HEAD", "OPTIONS"].includes(init.method ?? "GET"))
      headers.set("x-csrf-token", csrf);
    // Required since protocol 2: a silent client is protocol 1 and therefore
    // read-only. Announce every request so writes cannot be mistaken for legacy
    // traffic after a server upgrade.
    headers.set("x-myownnotion-client-protocol", String(PROTOCOL_VERSION));
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
      let problem: ProblemDto;
      try {
        problem = (await response.json()) as ProblemDto;
      } catch {
        problem = {
          type: "https://myownnotion.dev/problems/http",
          title: response.statusText,
          status: response.status,
          code: `http.${response.status}`,
        };
      }
      return { ok: false, problem, offline: false };
    }
    return { ok: true, value: (await response.json()) as T };
  }

  async health(): Promise<ApiResult<{ status: "ready"; schemaVersion: number }>> {
    return this.#request("/health");
  }

  async search(request: SearchRequestDto): Promise<ApiResult<SearchResponseDto>> {
    return this.#request("/v1/search", {
      method: "POST",
      body: JSON.stringify(request),
    });
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

  /**
   * Where a file is used (feature 005, FR-005).
   *
   * Its own request rather than a field on the item, because it is read at one
   * specific moment — while an owner decides whether to destroy something — and
   * carrying it on every item listing would cost every screen for one screen's
   * benefit.
   */
  async fileUsages(itemId: Uuid): Promise<ApiResult<{ usages: FileUsageDto[] }>> {
    return this.#request(`/v1/files/${itemId}/usages`);
  }

  async createItem(mutationId: Uuid, body: CreateItemDto): Promise<ApiResult<MutationResultDto>> {
    return this.#request("/v1/items", { method: "POST", body: JSON.stringify(body), mutationId });
  }

  async createDatabase(
    mutationId: Uuid,
    body: CreateDatabaseRequestDto,
  ): Promise<ApiResult<DatabaseMutationResultDto>> {
    return this.#request("/v1/databases", {
      method: "POST",
      body: JSON.stringify(body),
      mutationId,
    });
  }

  async getDatabase(databaseId: Uuid): Promise<ApiResult<DatabaseDto>> {
    return this.#request(`/v1/databases/${databaseId}`);
  }

  async queryDatabase(
    databaseId: Uuid,
    request: DatabaseQueryDto,
  ): Promise<ApiResult<DatabaseQueryPageDto>> {
    return this.#request(`/v1/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async previewDatabaseDefinitionImpact(
    databaseId: Uuid,
    body: Pick<ReplaceDefinitionRequestDto, "baseRevisionId" | "definition">,
  ): Promise<ApiResult<DefinitionImpactDto>> {
    return this.#request(`/v1/databases/${databaseId}/definition/impact`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async replaceDatabaseDefinition(
    mutationId: Uuid,
    databaseId: Uuid,
    body: ReplaceDefinitionRequestDto,
  ): Promise<ApiResult<DatabaseMutationResultDto>> {
    return this.#request(`/v1/databases/${databaseId}/definition`, {
      method: "PUT",
      body: JSON.stringify(body),
      mutationId,
    });
  }

  async createDatabaseEntry(
    mutationId: Uuid,
    databaseId: Uuid,
    body: CreateEntryRequestDto,
  ): Promise<ApiResult<EntryMutationResultDto>> {
    return this.#request(`/v1/databases/${databaseId}/entries`, {
      method: "POST",
      body: JSON.stringify(body),
      mutationId,
    });
  }

  async getDatabaseEntry(databaseId: Uuid, entryId: Uuid): Promise<ApiResult<DatabaseEntryDto>> {
    return this.#request(`/v1/databases/${databaseId}/entries/${entryId}`);
  }

  async replaceDatabaseEntryValues(
    mutationId: Uuid,
    databaseId: Uuid,
    entryId: Uuid,
    body: ReplaceEntryValuesRequestDto,
  ): Promise<ApiResult<EntryMutationResultDto>> {
    return this.#request(`/v1/databases/${databaseId}/entries/${entryId}/values`, {
      method: "PUT",
      body: JSON.stringify(body),
      mutationId,
    });
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

  async getTrashImpact(itemId: Uuid): Promise<ApiResult<TrashImpactDto>> {
    return this.#request(`/v1/items/${itemId}/trash-impact`);
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
    pageLinkTargetIds?: readonly Uuid[],
  ): Promise<ApiResult<MutationResultDto>> {
    return this.#request(`/v1/pages/${itemId}/document`, {
      method: "PUT",
      body: JSON.stringify({
        baseRevisionId,
        document,
        ...(pageLinkTargetIds !== undefined ? { pageLinkTargetIds } : {}),
      }),
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
