import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { DatabaseQueryDto, DatabaseQueryPageDto } from "@myownnotion/contracts";
import {
  type Database,
  listDatabaseEntryRecords,
  listDatabaseRecords,
  readDatabaseEntryRecord,
  readDatabaseRecord,
  readItem,
} from "@myownnotion/database";
import {
  type DatabaseDefinition,
  type DatabaseFilterOperand,
  type DatabaseProperty,
  type DatabaseQueryEntry,
  type DatabaseView,
  evaluateDatabaseView,
  type FilterCriterion,
  type NonRelationPropertyValue,
  type SafeErrorCode,
  type Uuid,
} from "@myownnotion/domain";
import {
  resolveDatabaseDefinition,
  resolveDatabaseEntryValues,
  resolveDatabaseRelationTargets,
  resolveProtectedContent,
} from "../security/content-resolution.ts";
import type { ProtectedContent } from "../security/protected-content.ts";

const REBUILD_YIELD_INTERVAL = 128;

export interface StructuredProjectionEntry extends DatabaseQueryEntry {
  readonly revisionId: Uuid;
}

export interface StructuredProjectionSource {
  readonly databaseId: Uuid;
  readonly definitionRevisionId: Uuid;
  readonly definition: DatabaseDefinition;
  readonly entries: readonly StructuredProjectionEntry[];
}

export interface StructuredProjectionChanges {
  readonly sources: readonly StructuredProjectionSource[];
  readonly removedDatabaseIds: readonly Uuid[];
}

export interface DatabaseQueryServiceDeps {
  readonly loadAll: () => Promise<readonly StructuredProjectionSource[]>;
  readonly loadAffected: (changedItemIds: readonly Uuid[]) => Promise<StructuredProjectionChanges>;
}

type ProjectionState = "cold" | "building" | "ready" | "degraded";

export interface DatabaseQueryServiceStatus {
  readonly state: ProjectionState;
  readonly generation: number | null;
  readonly indexedCount: number;
  readonly expectedCount: number;
  readonly presenceIndexCount: number;
  readonly equalityIndexCount: number;
  readonly failureCode: SafeErrorCode | null;
}

interface PropertyIndexes {
  readonly presence: ReadonlyMap<Uuid, ReadonlySet<Uuid>>;
  readonly equality: ReadonlyMap<Uuid, ReadonlyMap<string, ReadonlySet<Uuid>>>;
}

interface StructuredProjectionGeneration {
  readonly generation: number;
  readonly sourceCursor: number;
  readonly sources: ReadonlyMap<Uuid, StructuredProjectionSource>;
  readonly indexes: ReadonlyMap<Uuid, PropertyIndexes>;
  readonly indexedCount: number;
}

interface CursorPayload {
  readonly version: 1;
  readonly databaseId: Uuid;
  readonly viewId: Uuid;
  readonly definitionRevisionId: Uuid;
  readonly generation: number;
  readonly offset: number;
  readonly afterEntryId: Uuid;
  readonly signature: string;
}

export class DatabaseProjectionUnavailableError extends Error {
  readonly code: Extract<
    SafeErrorCode,
    "database.projection-building" | "database.projection-degraded"
  >;

  constructor(
    readonly state: "building" | "degraded",
    readonly indexedCount: number,
    readonly expectedCount: number,
  ) {
    super("Complete database projection is temporarily unavailable");
    this.name = "DatabaseProjectionUnavailableError";
    this.code =
      state === "degraded" ? "database.projection-degraded" : "database.projection-building";
  }
}

export class DatabaseQueryRequestError extends Error {
  constructor(
    readonly code: Extract<
      SafeErrorCode,
      | "database.not-found"
      | "database.invalid-view"
      | "database.invalid-cursor"
      | "database.cursor-stale"
    >,
  ) {
    super("Database query cannot be executed");
    this.name = "DatabaseQueryRequestError";
  }
}

function stableValueKey(value: DatabaseFilterOperand): string {
  switch (value.kind) {
    case "multi-select":
      return JSON.stringify({ ...value, optionIds: [...value.optionIds].sort() });
    case "relation":
      return JSON.stringify({ ...value, targetIds: [...value.targetIds].sort() });
    default:
      return JSON.stringify(value);
  }
}

function entryValue(
  property: DatabaseProperty,
  entry: StructuredProjectionEntry,
): DatabaseFilterOperand | undefined {
  if (property.type === "title") return { kind: "text", value: entry.title };
  if (property.type === "relation") {
    const targetIds = entry.relationTargets[property.id];
    return targetIds === undefined ? undefined : { kind: "relation", targetIds };
  }
  return entry.values[property.id];
}

function mutableSet<K>(map: Map<K, Set<Uuid>>, key: K): Set<Uuid> {
  const current = map.get(key);
  if (current !== undefined) return current;
  const created = new Set<Uuid>();
  map.set(key, created);
  return created;
}

function buildIndexes(source: StructuredProjectionSource): PropertyIndexes {
  const presence = new Map<Uuid, Set<Uuid>>();
  const equality = new Map<Uuid, Map<string, Set<Uuid>>>();
  for (const property of source.definition.properties) {
    if (property.state !== "active") continue;
    const values = new Map<string, Set<Uuid>>();
    equality.set(property.id, values);
    for (const entry of source.entries) {
      const value = entryValue(property, entry);
      if (value === undefined) continue;
      mutableSet(presence, property.id).add(entry.entryId);
      mutableSet(values, stableValueKey(value)).add(entry.entryId);
    }
  }
  return { presence, equality };
}

function countEqualityIndexes(indexes: ReadonlyMap<Uuid, PropertyIndexes>): number {
  let count = 0;
  for (const index of indexes.values()) {
    for (const values of index.equality.values()) count += values.size;
  }
  return count;
}

function countPresenceIndexes(indexes: ReadonlyMap<Uuid, PropertyIndexes>): number {
  let count = 0;
  for (const index of indexes.values()) count += index.presence.size;
  return count;
}

function intersect(left: ReadonlySet<Uuid>, right: ReadonlySet<Uuid>): Set<Uuid> {
  const result = new Set<Uuid>();
  const [smallest, largest] = left.size <= right.size ? [left, right] : [right, left];
  for (const id of smallest) if (largest.has(id)) result.add(id);
  return result;
}

function complement(all: ReadonlySet<Uuid>, excluded: ReadonlySet<Uuid>): Set<Uuid> {
  const result = new Set<Uuid>();
  for (const id of all) if (!excluded.has(id)) result.add(id);
  return result;
}

function indexedCriterion(
  criterion: FilterCriterion,
  indexes: PropertyIndexes,
  all: ReadonlySet<Uuid>,
): ReadonlySet<Uuid> | undefined {
  const presence = indexes.presence.get(criterion.propertyId) ?? new Set<Uuid>();
  if (criterion.operator === "is-not-empty") return presence;
  if (criterion.operator === "is-empty") return complement(all, presence);
  if (criterion.operator === "equals" || criterion.operator === "not-equals") {
    if (criterion.operand === undefined) return undefined;
    const equal =
      indexes.equality.get(criterion.propertyId)?.get(stableValueKey(criterion.operand)) ??
      new Set<Uuid>();
    return criterion.operator === "equals" ? equal : complement(all, equal);
  }
  return undefined;
}

function indexedCandidates(
  view: DatabaseView,
  indexes: PropertyIndexes,
  entries: readonly StructuredProjectionEntry[],
): ReadonlySet<Uuid> | undefined {
  if (view.filter.criteria.length === 0) return undefined;
  const all = new Set(entries.map(({ entryId }) => entryId));
  const candidates = view.filter.criteria.map((criterion) =>
    indexedCriterion(criterion, indexes, all),
  );
  if (view.filter.mode === "any") {
    if (candidates.some((candidate) => candidate === undefined)) return undefined;
    return new Set(candidates.flatMap((candidate) => [...(candidate ?? [])]));
  }
  const usable = candidates.filter(
    (candidate): candidate is ReadonlySet<Uuid> => candidate != null,
  );
  if (usable.length === 0) return undefined;
  return usable.reduce((current, candidate) => intersect(current, candidate), all);
}

function groupLabel(definition: DatabaseDefinition, propertyId: Uuid, groupId: string): string {
  if (groupId === "missing") return "Sans valeur";
  if (groupId === "checked") return "Coché";
  if (groupId === "unchecked") return "Non coché";
  const property = definition.properties.find(({ id }) => id === propertyId);
  if (property?.type !== "status" && property?.type !== "select") return groupId;
  return property.config.options.find(({ id }) => id === groupId)?.label ?? "Option indisponible";
}

type QueryRowValue = DatabaseQueryPageDto["rows"][number]["values"][string];

function responseValue(value: NonRelationPropertyValue): QueryRowValue {
  if (value.kind === "multi-select") {
    return { kind: "multi-select", optionIds: [...value.optionIds] };
  }
  return { ...value } as QueryRowValue;
}

function unsignedCursor(payload: Omit<CursorPayload, "signature">): string {
  return [
    payload.version,
    payload.databaseId,
    payload.viewId,
    payload.definitionRevisionId,
    payload.generation,
    payload.offset,
    payload.afterEntryId,
  ].join(".");
}

function sameSecretValue(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export class DatabaseQueryService {
  readonly #deps: DatabaseQueryServiceDeps;
  readonly #cursorSecret: Uint8Array;
  #active: StructuredProjectionGeneration | null = null;
  #state: ProjectionState = "cold";
  #failureCode: SafeErrorCode | null = null;
  #expectedCount = 0;
  #indexedDuringBuild = 0;
  #build: Promise<void> | null = null;
  #updates: Promise<void> = Promise.resolve();
  #pendingDuringBuild: Array<{
    readonly itemIds: readonly Uuid[];
    readonly sourceVersion: number;
  }> | null = null;

  constructor(deps: DatabaseQueryServiceDeps, cursorSecret: Uint8Array = randomBytes(32)) {
    this.#deps = deps;
    this.#cursorSecret = cursorSecret;
  }

  status(): DatabaseQueryServiceStatus {
    const indexes = this.#active?.indexes ?? new Map<Uuid, PropertyIndexes>();
    return {
      state: this.#state,
      generation: this.#active?.generation ?? null,
      indexedCount: this.#active?.indexedCount ?? this.#indexedDuringBuild,
      expectedCount: this.#expectedCount,
      presenceIndexCount: countPresenceIndexes(indexes),
      equalityIndexCount: countEqualityIndexes(indexes),
      failureCode: this.#failureCode,
    };
  }

  rebuild(): Promise<void> {
    if (this.#build !== null) return this.#build;
    this.#state = "building";
    this.#failureCode = null;
    this.#indexedDuringBuild = 0;
    this.#pendingDuringBuild = [];
    const build = this.#rebuild();
    this.#build = build;
    const clear = (): void => {
      if (this.#build === build) this.#build = null;
    };
    void build.then(clear, clear);
    return build;
  }

  async #rebuild(): Promise<void> {
    try {
      const loaded = await this.#deps.loadAll();
      this.#expectedCount = loaded.reduce((count, source) => count + source.entries.length, 0);
      const sources = new Map<Uuid, StructuredProjectionSource>();
      const indexes = new Map<Uuid, PropertyIndexes>();
      let indexedCount = 0;
      for (const source of loaded) {
        sources.set(source.databaseId, source);
        indexes.set(source.databaseId, buildIndexes(source));
        indexedCount += source.entries.length;
        this.#indexedDuringBuild = indexedCount;
        if (sources.size % REBUILD_YIELD_INTERVAL === 0) await yieldToEventLoop();
      }

      const pending = this.#pendingDuringBuild;
      if (pending === null) throw new Error("Structured projection lost its commit buffer");
      let sourceCursor = this.#active?.sourceCursor ?? 0;
      for (const change of pending) {
        const affected = await this.#deps.loadAffected(change.itemIds);
        for (const databaseId of affected.removedDatabaseIds) {
          sources.delete(databaseId);
          indexes.delete(databaseId);
        }
        for (const source of affected.sources) {
          sources.set(source.databaseId, source);
          indexes.set(source.databaseId, buildIndexes(source));
        }
        sourceCursor = Math.max(sourceCursor, change.sourceVersion);
      }
      const nextGeneration = (this.#active?.generation ?? 0) + 1;
      this.#active = {
        generation: nextGeneration,
        sourceCursor,
        sources,
        indexes,
        indexedCount: [...sources.values()].reduce(
          (count, source) => count + source.entries.length,
          0,
        ),
      };
      this.#expectedCount = this.#active.indexedCount;
      this.#pendingDuringBuild = null;
      this.#state = "ready";
      this.#failureCode = null;
    } catch (error) {
      this.#pendingDuringBuild = null;
      this.#state = "degraded";
      this.#failureCode = "database.projection-rebuild-failed";
      throw error;
    }
  }

  async applyCommittedChanges(itemIds: readonly Uuid[], sourceVersion: number): Promise<void> {
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
      throw new TypeError("Structured projection source version must be a positive safe integer");
    }
    const uniqueItemIds = [...new Set(itemIds)];
    if (uniqueItemIds.length === 0) return;
    const change = { itemIds: uniqueItemIds, sourceVersion };
    this.#pendingDuringBuild?.push(change);

    if (this.#active === null) {
      if (this.#build === null) await this.rebuild();
      return;
    }
    const update = this.#updates.then(async () => {
      const active = this.#active;
      if (active === null) return;
      try {
        const affected = await this.#deps.loadAffected(uniqueItemIds);
        const sources = new Map(active.sources);
        const indexes = new Map(active.indexes);
        for (const databaseId of affected.removedDatabaseIds) {
          sources.delete(databaseId);
          indexes.delete(databaseId);
        }
        for (const source of affected.sources) {
          sources.set(source.databaseId, source);
          indexes.set(source.databaseId, buildIndexes(source));
        }
        const indexedCount = [...sources.values()].reduce(
          (count, source) => count + source.entries.length,
          0,
        );
        this.#active = {
          generation: active.generation + 1,
          sourceCursor: Math.max(active.sourceCursor, sourceVersion),
          sources,
          indexes,
          indexedCount,
        };
        this.#expectedCount = indexedCount;
        this.#state = "ready";
        this.#failureCode = null;
      } catch (error) {
        this.#state = "degraded";
        this.#failureCode = "database.projection-update-failed";
        if (this.#build === null) void this.rebuild().catch(() => undefined);
        throw error;
      }
    });
    this.#updates = update.catch(() => undefined);
    await update;
  }

  #sign(value: string): string {
    return createHmac("sha256", this.#cursorSecret).update(value).digest("base64url");
  }

  #encodeCursor(payload: Omit<CursorPayload, "version" | "signature">): string {
    const unsigned: Omit<CursorPayload, "signature"> = { version: 1, ...payload };
    const cursor: CursorPayload = {
      ...unsigned,
      signature: this.#sign(unsignedCursor(unsigned)),
    };
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  #decodeCursor(
    cursor: string,
    binding: {
      readonly databaseId: Uuid;
      readonly viewId: Uuid;
      readonly definitionRevisionId: Uuid;
      readonly generation: number;
    },
    rows: readonly StructuredProjectionEntry[],
  ): number {
    try {
      if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error("non-canonical cursor");
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error("non-canonical cursor");
      const value = JSON.parse(bytes.toString("utf8")) as Partial<CursorPayload>;
      if (
        value.version !== 1 ||
        typeof value.databaseId !== "string" ||
        typeof value.viewId !== "string" ||
        typeof value.definitionRevisionId !== "string" ||
        !Number.isSafeInteger(value.generation) ||
        !Number.isSafeInteger(value.offset) ||
        (value.offset ?? 0) < 1 ||
        typeof value.afterEntryId !== "string" ||
        typeof value.signature !== "string"
      ) {
        throw new Error("invalid cursor payload");
      }
      const unsigned: Omit<CursorPayload, "signature"> = {
        version: 1,
        databaseId: value.databaseId as Uuid,
        viewId: value.viewId as Uuid,
        definitionRevisionId: value.definitionRevisionId as Uuid,
        generation: value.generation as number,
        offset: value.offset as number,
        afterEntryId: value.afterEntryId as Uuid,
      };
      if (!sameSecretValue(value.signature, this.#sign(unsignedCursor(unsigned)))) {
        throw new Error("invalid cursor signature");
      }
      if (
        unsigned.databaseId !== binding.databaseId ||
        unsigned.viewId !== binding.viewId ||
        unsigned.definitionRevisionId !== binding.definitionRevisionId ||
        unsigned.generation !== binding.generation ||
        rows[unsigned.offset - 1]?.entryId !== unsigned.afterEntryId
      ) {
        throw new DatabaseQueryRequestError("database.cursor-stale");
      }
      return unsigned.offset;
    } catch (error) {
      if (error instanceof DatabaseQueryRequestError) throw error;
      throw new DatabaseQueryRequestError("database.invalid-cursor");
    }
  }

  query(databaseId: Uuid, request: DatabaseQueryDto): DatabaseQueryPageDto {
    const active = this.#active;
    if (active === null || this.#state === "degraded") {
      throw new DatabaseProjectionUnavailableError(
        this.#state === "degraded" ? "degraded" : "building",
        active?.indexedCount ?? this.#indexedDuringBuild,
        this.#expectedCount,
      );
    }
    const source = active.sources.get(databaseId);
    if (source === undefined) throw new DatabaseQueryRequestError("database.not-found");
    const view = source.definition.views.find(
      (candidate) => candidate.id === request.viewId && candidate.state === "active",
    );
    if (view === undefined) throw new DatabaseQueryRequestError("database.invalid-view");

    const indexes = active.indexes.get(databaseId) ?? { presence: new Map(), equality: new Map() };
    const candidateIds = indexedCandidates(view, indexes, source.entries);
    const entries =
      candidateIds === undefined
        ? source.entries
        : source.entries.filter(({ entryId }) => candidateIds.has(entryId));
    const evaluated = evaluateDatabaseView(source.definition, request.viewId as Uuid, entries);
    if (!evaluated.ok) throw new DatabaseQueryRequestError("database.invalid-view");
    const rows = evaluated.value.rows as readonly StructuredProjectionEntry[];
    const limit = request.limit ?? 100;
    const offset =
      request.cursor === undefined
        ? 0
        : this.#decodeCursor(
            request.cursor,
            {
              databaseId,
              viewId: request.viewId as Uuid,
              definitionRevisionId: source.definitionRevisionId,
              generation: active.generation,
            },
            rows,
          );
    const pageRows = rows.slice(offset, offset + limit);
    const visiblePropertyIds = new Set(
      view.properties.filter(({ visible }) => visible).map(({ propertyId }) => propertyId),
    );
    const entryGroups = new Map<Uuid, string>();
    for (const group of evaluated.value.groups) {
      for (const entryId of group.entryIds) entryGroups.set(entryId, group.id);
    }
    const nextOffset = offset + pageRows.length;
    const last = pageRows.at(-1);
    return {
      databaseId,
      viewId: request.viewId,
      definitionRevisionId: source.definitionRevisionId,
      generation: active.generation,
      coverage: "complete",
      availableCount: source.entries.length,
      expectedCount: source.entries.length,
      rows: pageRows.map((entry) => ({
        entryId: entry.entryId,
        revisionId: entry.revisionId,
        title: entry.title,
        values: Object.fromEntries(
          Object.entries(entry.values)
            .filter(([propertyId]) => visiblePropertyIds.has(propertyId as Uuid))
            .map(([propertyId, value]) => [propertyId, responseValue(value)]),
        ),
        relationTargets: Object.fromEntries(
          Object.entries(entry.relationTargets)
            .filter(([propertyId]) => visiblePropertyIds.has(propertyId as Uuid))
            .map(([propertyId, targetIds]) => [propertyId, [...targetIds]]),
        ),
        groupId: entryGroups.get(entry.entryId) ?? null,
      })),
      groups:
        view.group === null
          ? []
          : evaluated.value.groups.map((group) => ({
              id: group.id,
              label: groupLabel(source.definition, view.group?.propertyId as Uuid, group.id),
              count: group.entryIds.length,
            })),
      nextCursor:
        nextOffset < rows.length && last !== undefined
          ? this.#encodeCursor({
              databaseId,
              viewId: request.viewId as Uuid,
              definitionRevisionId: source.definitionRevisionId,
              generation: active.generation,
              offset: nextOffset,
              afterEntryId: last.entryId,
            })
          : null,
    };
  }
}

async function loadProjectionSource(input: {
  readonly db: Database;
  readonly databaseId: Uuid;
  readonly protectedContent?: ProtectedContent | undefined;
}): Promise<StructuredProjectionSource | null> {
  const [record, storedItem] = await Promise.all([
    readDatabaseRecord(input.db, input.databaseId),
    readItem(input.db, input.databaseId),
  ]);
  if (record === null || storedItem === null || storedItem.lifecycle !== "active") return null;
  const [item] = await resolveProtectedContent(input.db, [storedItem], input.protectedContent);
  if (item === undefined) return null;
  const definition = await resolveDatabaseDefinition(input.db, record, input.protectedContent);
  const entryRecords = await listDatabaseEntryRecords(input.db, input.databaseId);
  const entries: StructuredProjectionEntry[] = [];
  for (const entryRecord of entryRecords) {
    const storedEntry = await readItem(input.db, entryRecord.entryId);
    if (storedEntry === null || storedEntry.lifecycle !== "active") continue;
    const [resolvedEntry] = await resolveProtectedContent(
      input.db,
      [storedEntry],
      input.protectedContent,
    );
    if (resolvedEntry === undefined) continue;
    const [values, relationTargets] = await Promise.all([
      resolveDatabaseEntryValues(input.db, entryRecord, input.protectedContent),
      resolveDatabaseRelationTargets(input.db, {
        databaseId: input.databaseId,
        entryId: entryRecord.entryId,
        content: input.protectedContent,
      }),
    ]);
    entries.push({
      entryId: entryRecord.entryId,
      revisionId: resolvedEntry.currentRevisionId,
      title: resolvedEntry.name,
      values: values.values,
      relationTargets,
    });
  }
  return {
    databaseId: input.databaseId,
    definitionRevisionId: item.currentRevisionId,
    definition,
    entries,
  };
}

export function createDatabaseQueryService(input: {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly protectedContent?: ProtectedContent | undefined;
}): DatabaseQueryService {
  return new DatabaseQueryService({
    loadAll: async () => {
      const records = await listDatabaseRecords(input.db, input.workspaceId);
      const sources: StructuredProjectionSource[] = [];
      for (const record of records) {
        const source = await loadProjectionSource({
          db: input.db,
          databaseId: record.databaseId,
          protectedContent: input.protectedContent,
        });
        if (source !== null) sources.push(source);
      }
      return sources;
    },
    loadAffected: async (changedItemIds) => {
      const databaseIds = new Set<Uuid>(changedItemIds);
      for (const itemId of changedItemIds) {
        const entry = await readDatabaseEntryRecord(input.db, itemId);
        if (entry !== null) databaseIds.add(entry.databaseId);
      }
      const sources: StructuredProjectionSource[] = [];
      const removedDatabaseIds: Uuid[] = [];
      for (const databaseId of databaseIds) {
        const source = await loadProjectionSource({
          db: input.db,
          databaseId,
          protectedContent: input.protectedContent,
        });
        if (source === null) removedDatabaseIds.push(databaseId);
        else sources.push(source);
      }
      return { sources, removedDatabaseIds };
    },
  });
}
