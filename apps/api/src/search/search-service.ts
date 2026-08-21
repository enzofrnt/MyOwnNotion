import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { SearchRequestDto, SearchResponseDto } from "@myownnotion/contracts";
import type { Database } from "@myownnotion/database";
import {
  activeDescendantIds,
  hydrateSearchPaths,
  listSearchSources,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  readSearchSources,
  SCRUBBED_PLACEHOLDER,
  type SearchSourceRecord,
  type StoredSearchPathSegment,
} from "@myownnotion/database";
import {
  type DatabaseDefinition,
  type EntryValues,
  extractSearchableDocumentText,
  extractSearchablePropertyText,
  prepareSearchQuery,
  readDocumentBody,
  type SearchPathSegment,
  type Uuid,
  WorkspaceSearchIndex,
} from "@myownnotion/domain";
import type { ProtectedContent } from "../security/protected-content.ts";
import { SearchState, type SearchStateName, type SearchStateView } from "./search-state.ts";

const SNIPPET_LIMIT = 320;
const REBUILD_YIELD_INTERVAL = 256;

export interface ResolvedSearchSource extends SearchSourceRecord {
  readonly title: string;
  readonly body: Readonly<Record<string, unknown>> | null;
  readonly structuredValues?: {
    readonly definition: DatabaseDefinition;
    readonly values: EntryValues;
  } | null;
}

export interface SearchServiceDeps {
  readonly loadSources: () => Promise<readonly SearchSourceRecord[]>;
  readonly loadSourcesByIds: (itemIds: readonly Uuid[]) => Promise<readonly SearchSourceRecord[]>;
  readonly resolveSources: (
    sources: readonly SearchSourceRecord[],
  ) => Promise<readonly ResolvedSearchSource[]>;
  readonly activeDescendantIds: (rootItemId: Uuid) => Promise<readonly Uuid[]>;
  readonly hydratePaths: (
    itemIds: readonly Uuid[],
  ) => Promise<ReadonlyMap<Uuid, readonly SearchPathSegment[]>>;
}

export class SearchUnavailableError extends Error {
  readonly code: "search.building" | "search.degraded";

  constructor(
    readonly state: "building" | "degraded",
    readonly indexedCount: number,
    readonly expectedCount: number,
  ) {
    super("Complete workspace search is temporarily unavailable");
    this.name = "SearchUnavailableError";
    this.code = state === "degraded" ? "search.degraded" : "search.building";
  }
}

export class SearchRequestError extends Error {
  constructor(
    readonly code:
      | "search.empty-query"
      | "search.query-too-long"
      | "search.invalid-filter"
      | "search.invalid-cursor"
      | "search.cursor-stale",
    readonly status: 400 | 409 = 400,
  ) {
    super("Search request is invalid");
    this.name = "SearchRequestError";
  }
}

function safeSnippet(bodyText: string, terms: readonly string[]): string | null {
  if (bodyText.length === 0) {
    return null;
  }
  const comparable = bodyText.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
  const firstMatch = terms.reduce((best, term) => {
    const position = comparable.indexOf(term);
    return position < 0 || (best >= 0 && best <= position) ? best : position;
  }, -1);
  const start = Math.max(0, firstMatch < 0 ? 0 : firstMatch - 100);
  const value = bodyText
    .slice(start, start + SNIPPET_LIMIT)
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (value.length === 0) {
    return null;
  }
  return `${start > 0 ? "…" : ""}${value}${start + SNIPPET_LIMIT < bodyText.length ? "…" : ""}`;
}

function unavailableState(state: SearchStateName): "building" | "degraded" {
  return state === "degraded" ? "degraded" : "building";
}

interface SearchCursorPayload {
  readonly version: 1;
  readonly generation: number;
  readonly offset: number;
  readonly queryFingerprint: string;
  readonly signature: string;
}

function hmac(secret: Uint8Array, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function cursorBinding(request: SearchRequestDto, normalisedQuery: string): string {
  return JSON.stringify({
    query: normalisedQuery,
    kinds: [...(request.kinds ?? [])].sort(),
    branchRootItemId: request.branchRootItemId ?? null,
    limit: request.limit ?? 20,
  });
}

function cursorSignatureInput(payload: Omit<SearchCursorPayload, "signature">): string {
  return [payload.version, payload.generation, payload.offset, payload.queryFingerprint].join(".");
}

function sameSecretValue(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export class SearchService {
  readonly #deps: SearchServiceDeps;
  readonly #state = new SearchState();
  #build: Promise<void> | null = null;
  #pendingDuringBuild: Array<{
    readonly itemIds: readonly Uuid[];
    readonly sourceVersion: number;
  }> | null = null;
  #updates: Promise<void> = Promise.resolve();
  readonly #cursorSecret = randomBytes(32);

  constructor(deps: SearchServiceDeps) {
    this.#deps = deps;
  }

  status(): SearchStateView {
    return this.#state.view();
  }

  rebuild(): Promise<void> {
    if (this.#build !== null) {
      return this.#build;
    }
    this.#pendingDuringBuild = [];
    this.#state.beginBuild();
    const build = this.#rebuild();
    this.#build = build;
    const clear = (): void => {
      if (this.#build === build) {
        this.#build = null;
      }
    };
    void build.then(clear, clear);
    return build;
  }

  async #rebuild(): Promise<void> {
    try {
      const stored = await this.#deps.loadSources();
      this.#state.setExpectedCount(stored.length);
      const sources = await this.#deps.resolveSources(stored);
      const next = new WorkspaceSearchIndex();
      let indexed = 0;
      for (const source of sources) {
        next.upsert(this.#searchDocument(source, 0));
        indexed += 1;
        this.#state.recordIndexed(indexed);
        if (indexed < sources.length && indexed % REBUILD_YIELD_INTERVAL === 0) {
          await yieldToEventLoop();
        }
      }

      const pending = this.#pendingDuringBuild;
      if (pending === null) {
        throw new Error("Search rebuild lost its committed-change buffer");
      }
      let nextPending = 0;
      while (nextPending < pending.length) {
        await this.#applyToIndex(next, pending[nextPending] as (typeof pending)[number]);
        nextPending += 1;
      }
      this.#state.publish(next);
      this.#pendingDuringBuild = null;
    } catch (error) {
      this.#pendingDuringBuild = null;
      this.#state.degrade("search.rebuild-failed");
      throw error;
    }
  }

  #searchDocument(source: ResolvedSearchSource, sourceVersion: number) {
    let bodyText = "";
    if (source.kind === "page" && source.body !== null) {
      const read = readDocumentBody(source.body);
      if (read.kind === "blocks") {
        if (!read.result.ok) {
          throw new Error("Canonical page document cannot be indexed safely");
        }
        bodyText = extractSearchableDocumentText(read.result.document);
      }
    }
    return {
      itemId: source.itemId,
      revisionId: source.revisionId,
      sourceVersion,
      kind: source.kind,
      title: source.title,
      bodyText,
      properties:
        source.structuredValues === undefined || source.structuredValues === null
          ? []
          : extractSearchablePropertyText(
              source.structuredValues.definition,
              source.structuredValues.values,
            ),
      conflict: false,
    };
  }

  async #applyToIndex(
    index: WorkspaceSearchIndex,
    change: { readonly itemIds: readonly Uuid[]; readonly sourceVersion: number },
  ): Promise<boolean> {
    const stored = await this.#deps.loadSourcesByIds(change.itemIds);
    const sources = await this.#deps.resolveSources(stored);
    const activeIds = new Set(sources.map(({ itemId }) => itemId));
    let changed = false;
    for (const source of sources) {
      changed =
        index.upsert(this.#searchDocument(source, change.sourceVersion)) !== "ignored" || changed;
    }
    for (const itemId of change.itemIds) {
      if (!activeIds.has(itemId)) {
        changed = index.remove(itemId, change.sourceVersion) !== "ignored" || changed;
      }
    }
    return changed;
  }

  /** Applies canonical changes only after their database transaction committed. */
  async applyCommittedChanges(itemIds: readonly Uuid[], sourceVersion: number): Promise<void> {
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
      throw new TypeError("Committed search source version must be a positive safe integer");
    }
    const uniqueItemIds = [...new Set(itemIds)];
    if (uniqueItemIds.length === 0) {
      return;
    }
    const change = { itemIds: uniqueItemIds, sourceVersion };
    this.#pendingDuringBuild?.push(change);

    if (this.#state.active() === null) {
      // A transient startup failure is not permanent. A later canonical write
      // may be exactly what makes the source readable again (for example after
      // key recovery), so use that commit as a recovery trigger. When a build
      // is already running, the change was buffered above and will be replayed
      // before publication.
      if (this.#build === null) {
        await this.rebuild();
      }
      return;
    }
    const update = this.#updates.then(async () => {
      const active = this.#state.active();
      if (active === null) {
        return;
      }
      try {
        if (await this.#applyToIndex(active.index, change)) {
          this.#state.markActiveUpdated();
        }
      } catch (error) {
        this.#state.degrade("search.incremental-update-failed");
        if (this.#build === null) {
          void this.rebuild().catch(() => undefined);
        }
        throw error;
      }
    });
    this.#updates = update.catch(() => undefined);
    await update;
  }

  #encodeCursor(generation: number, offset: number, binding: string): string {
    const unsigned: Omit<SearchCursorPayload, "signature"> = {
      version: 1,
      generation,
      offset,
      queryFingerprint: hmac(this.#cursorSecret, `query.${binding}`),
    };
    const payload: SearchCursorPayload = {
      ...unsigned,
      signature: hmac(this.#cursorSecret, `cursor.${cursorSignatureInput(unsigned)}`),
    };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  }

  #decodeCursor(cursor: string, generation: number, binding: string): number {
    try {
      if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) {
        throw new Error("non-canonical cursor");
      }
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) {
        throw new Error("non-canonical cursor");
      }
      const value = JSON.parse(bytes.toString("utf8")) as Partial<SearchCursorPayload>;
      if (
        value.version !== 1 ||
        !Number.isSafeInteger(value.generation) ||
        !Number.isSafeInteger(value.offset) ||
        (value.offset ?? -1) < 1 ||
        typeof value.queryFingerprint !== "string" ||
        typeof value.signature !== "string"
      ) {
        throw new Error("invalid cursor payload");
      }
      const unsigned: Omit<SearchCursorPayload, "signature"> = {
        version: 1,
        generation: value.generation as number,
        offset: value.offset as number,
        queryFingerprint: value.queryFingerprint,
      };
      const expectedSignature = hmac(
        this.#cursorSecret,
        `cursor.${cursorSignatureInput(unsigned)}`,
      );
      if (!sameSecretValue(value.signature, expectedSignature)) {
        throw new Error("invalid cursor signature");
      }
      const expectedFingerprint = hmac(this.#cursorSecret, `query.${binding}`);
      if (
        value.generation !== generation ||
        !sameSecretValue(value.queryFingerprint, expectedFingerprint)
      ) {
        throw new SearchRequestError("search.cursor-stale", 409);
      }
      return value.offset as number;
    } catch (error) {
      if (error instanceof SearchRequestError) {
        throw error;
      }
      throw new SearchRequestError("search.invalid-cursor", 400);
    }
  }

  async search(request: SearchRequestDto): Promise<SearchResponseDto> {
    const prepared = prepareSearchQuery(request.query);
    if (!prepared.ok) {
      throw new SearchRequestError(
        prepared.code === "empty-query" ? "search.empty-query" : "search.query-too-long",
      );
    }
    let active = this.#state.active();
    if (active === null) {
      const view = this.#state.view();
      throw new SearchUnavailableError(
        unavailableState(view.state),
        view.indexedCount,
        view.expectedCount,
      );
    }

    const itemIds =
      request.branchRootItemId === undefined || request.branchRootItemId === null
        ? undefined
        : new Set(await this.#deps.activeDescendantIds(request.branchRootItemId as Uuid));
    // Descendant hydration awaits the database. Re-read the generation before
    // using the index so a concurrent committed update cannot issue a cursor
    // for an earlier generation over candidates from a later one.
    active = this.#state.active();
    if (active === null) {
      const view = this.#state.view();
      throw new SearchUnavailableError(
        unavailableState(view.state),
        view.indexedCount,
        view.expectedCount,
      );
    }
    const limit = request.limit ?? 20;
    const binding = cursorBinding(request, prepared.value.normalised);
    const offset =
      request.cursor === undefined
        ? 0
        : this.#decodeCursor(request.cursor, active.generation, binding);
    const kinds = request.kinds === undefined ? undefined : new Set(request.kinds);
    const candidatesWithLookahead = active.index.search(prepared.value, {
      ...(kinds === undefined ? {} : { kinds }),
      ...(itemIds === undefined ? {} : { itemIds }),
      limit: limit + 1,
      offset,
    });
    const hasMore = candidatesWithLookahead.length > limit;
    const candidates = candidatesWithLookahead.slice(0, limit);
    const paths = await this.#deps.hydratePaths(candidates.map(({ itemId }) => itemId));
    return {
      coverage: "complete",
      generation: active.generation,
      results: candidates.map((candidate) => {
        const matchedField =
          candidate.matchedFields[0] ?? (candidate.kind === "file" ? "fileName" : "title");
        return {
          itemId: candidate.itemId,
          revisionId: candidate.revisionId,
          kind: candidate.kind,
          title: candidate.title,
          path: [...(paths.get(candidate.itemId) ?? [])],
          matchedField,
          propertyId: matchedField === "property" ? candidate.matchedPropertyId : null,
          propertyName: matchedField === "property" ? candidate.matchedPropertyName : null,
          snippet:
            matchedField === "body" ? safeSnippet(candidate.bodyText, prepared.value.terms) : null,
          conflict: candidate.conflict,
        };
      }),
      nextCursor: hasMore ? this.#encodeCursor(active.generation, offset + limit, binding) : null,
    };
  }
}

function fallbackOrProtected<T>(
  protectedValues: ReadonlyMap<string, T>,
  entityId: string,
  fallback: T,
): T {
  return protectedValues.get(entityId) ?? fallback;
}

async function resolveStoredPaths(
  db: Database,
  content: ProtectedContent | undefined,
  stored: ReadonlyMap<Uuid, readonly StoredSearchPathSegment[]>,
): Promise<ReadonlyMap<Uuid, readonly SearchPathSegment[]>> {
  const segments = [...stored.values()].flat();
  const names =
    content === undefined
      ? new Map<string, string>()
      : await content.readItemNames(
          db,
          segments.map(({ itemId }) => itemId),
        );
  return new Map(
    [...stored].map(([itemId, path]) => [
      itemId,
      path.map((segment) => {
        const title = fallbackOrProtected(names, segment.itemId, segment.storedName);
        if (title === SCRUBBED_PLACEHOLDER) {
          throw new Error("Protected search path is unavailable");
        }
        return { itemId: segment.itemId, title };
      }),
    ]),
  );
}

export function createDatabaseSearchService(input: {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly protectedContent?: ProtectedContent | undefined;
}): SearchService {
  return new SearchService({
    loadSources: async () => await listSearchSources(input.db, input.workspaceId),
    loadSourcesByIds: async (itemIds) =>
      await readSearchSources(input.db, input.workspaceId, itemIds),
    resolveSources: async (sources) => {
      const names =
        input.protectedContent === undefined
          ? new Map<string, string>()
          : await input.protectedContent.readItemNames(
              input.db,
              sources.map(({ itemId }) => itemId),
            );
      const pageIds = sources.filter(({ kind }) => kind === "page").map(({ itemId }) => itemId);
      const bodies =
        input.protectedContent === undefined
          ? new Map<string, Readonly<Record<string, unknown>>>()
          : await input.protectedContent.readPageBodies<Readonly<Record<string, unknown>>>(
              input.db,
              pageIds,
            );
      const databaseEntries = sources.filter(
        (
          source,
        ): source is SearchSourceRecord & {
          readonly databaseEntry: NonNullable<SearchSourceRecord["databaseEntry"]>;
        } => source.databaseEntry !== undefined && source.databaseEntry !== null,
      );
      const definitionMetadata = new Map(
        databaseEntries.map(({ databaseEntry }) => [databaseEntry.databaseId, databaseEntry]),
      );
      const definitions = new Map<Uuid, DatabaseDefinition>();
      await Promise.all(
        [...definitionMetadata].map(async ([databaseId, metadata]) => {
          const definition =
            (await input.protectedContent?.readDatabaseDefinition(
              input.db,
              databaseId,
              metadata.definitionVersion,
            )) ?? (await readCurrentDatabaseDefinition(input.db, databaseId));
          if (definition === null) throw new Error("Protected database definition is unavailable");
          definitions.set(databaseId, definition);
        }),
      );
      const structuredValues = new Map<Uuid, EntryValues>();
      await Promise.all(
        databaseEntries.map(async ({ itemId, databaseEntry }) => {
          const values =
            (await input.protectedContent?.readDatabaseEntryValues(
              input.db,
              itemId,
              databaseEntry.valueVersion,
            )) ?? (await readCurrentDatabaseEntryValues(input.db, itemId));
          if (values === null) throw new Error("Protected database values are unavailable");
          structuredValues.set(itemId, values);
        }),
      );
      return sources.map((source) => {
        const title = fallbackOrProtected(names, source.itemId, source.storedName);
        if (title === SCRUBBED_PLACEHOLDER) {
          throw new Error("Protected search source is unavailable");
        }
        return {
          ...source,
          title,
          body:
            source.pageDocument === null
              ? null
              : fallbackOrProtected(bodies, source.itemId, source.pageDocument.body),
          structuredValues:
            source.databaseEntry === undefined || source.databaseEntry === null
              ? null
              : {
                  definition: definitions.get(
                    source.databaseEntry.databaseId,
                  ) as DatabaseDefinition,
                  values: structuredValues.get(source.itemId) as EntryValues,
                },
        };
      });
    },
    activeDescendantIds: async (rootItemId) => await activeDescendantIds(input.db, rootItemId),
    hydratePaths: async (itemIds) =>
      await resolveStoredPaths(
        input.db,
        input.protectedContent,
        await hydrateSearchPaths(input.db, itemIds),
      ),
  });
}
