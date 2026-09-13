import {
  type LocalDatabaseQueryEntry,
  LocalDatabaseQueryError,
  type LocalDatabaseQuerySource,
  queryLocalDatabase,
} from "@myownnotion/client-core";
import type { DatabaseQueryDto, DatabaseQueryPageDto, ProblemDto } from "@myownnotion/contracts";
import { databaseQueryDefinition, type Uuid } from "@myownnotion/domain";
import type { LocalContentService } from "./local-content.ts";

export type DatabaseRowSyncState = "synced" | "pending" | "conflict";

export type DatabaseViewRow = DatabaseQueryPageDto["rows"][number] & {
  readonly syncState: DatabaseRowSyncState;
};

export interface DatabaseViewPage extends Omit<DatabaseQueryPageDto, "rows"> {
  readonly rows: readonly DatabaseViewRow[];
  readonly source: "server" | "local" | "merged";
  readonly staleCursorRecovered: boolean;
}

export type DatabaseViewResult =
  | { readonly ok: true; readonly value: DatabaseViewPage }
  | { readonly ok: false; readonly problem: ProblemDto };

/**
 * Merge the server-selected page with optimistic local state without changing
 * the server's membership, pagination boundary, or ordering. A partial local
 * projection cannot establish where an absent local row belongs globally, so
 * only rows already selected by the server may be overlaid.
 */
export function mergeDatabaseViewRows(
  serverRows: readonly DatabaseQueryPageDto["rows"][number][],
  localRows: readonly DatabaseQueryPageDto["rows"][number][],
  states: ReadonlyMap<Uuid, DatabaseRowSyncState>,
): DatabaseViewRow[] {
  const localById = new Map(localRows.map((row) => [row.entryId as Uuid, row]));
  return serverRows.map((row) => {
    const entryId = row.entryId as Uuid;
    const state = states.get(entryId) ?? "synced";
    const local = localById.get(entryId);
    return { ...(state === "synced" || local === undefined ? row : local), syncState: state };
  });
}

function entryIdFromPayload(payload: Readonly<Record<string, unknown>>): Uuid | null {
  const value = payload["entryId"] ?? payload["id"];
  return typeof value === "string" ? (value as Uuid) : null;
}

function databaseIdFromDefinitionMutation(
  commandType: string,
  payload: Readonly<Record<string, unknown>>,
): Uuid | null {
  if (commandType === "database.create") {
    return typeof payload["id"] === "string" ? (payload["id"] as Uuid) : null;
  }
  if (
    commandType === "database.definition.replace" ||
    commandType === "database.definition.resolve-conflict"
  ) {
    return typeof payload["databaseId"] === "string" ? (payload["databaseId"] as Uuid) : null;
  }
  return null;
}

export class DatabaseViewService {
  readonly #local: LocalContentService;
  #epoch = 1;
  readonly #unsubscribe: () => void;
  readonly #cachedSources = new Map<
    Uuid,
    { readonly epoch: number; readonly source: LocalDatabaseQuerySource }
  >();
  #nextGeneration = 1;
  readonly #sourceGenerations = new Map<
    Uuid,
    { readonly signature: string; readonly generation: number }
  >();

  constructor(local: LocalContentService) {
    this.#local = local;
    this.#unsubscribe = local.subscribeProjection(() => {
      ++this.#epoch;
    });
  }

  dispose(): void {
    this.#sourceGenerations.clear();
    this.#cachedSources.clear();
    this.#unsubscribe();
  }

  async #localSource(databaseId: Uuid): Promise<LocalDatabaseQuerySource | null> {
    const epoch = this.#epoch;
    const cached = this.#cachedSources.get(databaseId);
    if (cached?.epoch === epoch) return cached.source;
    const [database, entryRows] = await Promise.all([
      this.#local.getDatabase(databaseId),
      this.#local.listDatabaseEntries(databaseId),
    ]);
    const definitionRevisionId =
      database?.definitionRevisionId ?? (await this.#local.getItem(databaseId))?.currentRevisionId;
    if (database === null || definitionRevisionId === undefined) {
      return null;
    }
    const entries: LocalDatabaseQueryEntry[] = [];
    const ids = entryRows.map((row) => row.entryItemId);
    const [items, relations] = await Promise.all([
      this.#local.getItems(ids),
      this.#local.getDatabaseEntryRelations(databaseId, ids),
    ]);
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const row of entryRows) {
      const item = byId.get(row.entryItemId) ?? null;
      if (item === null || item.lifecycle !== "active") continue;
      const relationTargets = relations.get(row.entryItemId) ?? {};
      entries.push({
        entryId: row.entryItemId,
        revisionId: item.currentRevisionId,
        title: item.name,
        availability: row.availability,
        values: row.values.values,
        relationTargets,
      });
    }
    // An unrelated editorial page can emit several projection notifications
    // while this display stays unchanged. Cursor validity follows this source's
    // actual revision/value/coverage snapshot, not the workspace event count.
    const signature = JSON.stringify([definitionRevisionId, entries]);
    const previous = this.#sourceGenerations.get(databaseId);
    const generation =
      previous?.signature === signature ? previous.generation : this.#nextGeneration++;
    this.#sourceGenerations.set(databaseId, { signature, generation });
    const source: LocalDatabaseQuerySource = {
      databaseId,
      definitionRevisionId,
      definition: databaseQueryDefinition(database.definition),
      generation,
      expectedCount: entryRows.length,
      entries,
    };
    this.#cachedSources.set(databaseId, { epoch, source });
    return source;
  }

  async #localQuery(
    databaseId: Uuid,
    request: DatabaseQueryDto,
  ): Promise<DatabaseQueryPageDto | null> {
    const source = await this.#localSource(databaseId);
    if (source === null) return null;
    try {
      return queryLocalDatabase(source, request);
    } catch (error) {
      if (error instanceof LocalDatabaseQueryError) return null;
      throw error;
    }
  }

  async #syncStates(databaseId: Uuid): Promise<{
    readonly rows: ReadonlyMap<Uuid, DatabaseRowSyncState>;
    readonly definitionIsLocal: boolean;
  }> {
    const [queued, conflicts] = await Promise.all([
      this.#local.outbox.all(),
      this.#local.outbox.activeConflicts(),
    ]);
    const states = new Map<Uuid, DatabaseRowSyncState>();
    let definitionIsLocal = false;
    for (const mutation of queued) {
      const entryId = entryIdFromPayload(mutation.payload);
      if (entryId !== null) states.set(entryId, "pending");
      if (databaseIdFromDefinitionMutation(mutation.commandType, mutation.payload) === databaseId) {
        definitionIsLocal = true;
      }
    }
    for (const conflict of conflicts) {
      const entryId = entryIdFromPayload(conflict.payload);
      if (entryId !== null) states.set(entryId, "conflict");
      if (databaseIdFromDefinitionMutation(conflict.commandType, conflict.payload) === databaseId) {
        definitionIsLocal = true;
      }
    }
    return { rows: states, definitionIsLocal };
  }

  async query(databaseId: Uuid, request: DatabaseQueryDto): Promise<DatabaseViewResult> {
    const localRequest =
      request.cursor?.startsWith("local.") === true
        ? request
        : {
            viewId: request.viewId,
            ...(request.limit === undefined ? {} : { limit: request.limit }),
          };
    const [localPage, sync] = await Promise.all([
      this.#localQuery(databaseId, localRequest),
      this.#syncStates(databaseId),
    ]);
    const states = sync.rows;
    const withState = (rows: readonly DatabaseQueryPageDto["rows"][number][]): DatabaseViewRow[] =>
      rows.map((row) => ({ ...row, syncState: states.get(row.entryId as Uuid) ?? "synced" }));

    // Local cursors bind the local generation, not a server generation. Sending
    // one to the server would spuriously reset a valid second page to page one.
    if (request.cursor?.startsWith("local.") === true) {
      if (localPage !== null)
        return {
          ok: true,
          value: {
            ...localPage,
            rows: withState(localPage.rows),
            source: "local",
            staleCursorRecovered: false,
          },
        };
      const refreshed = await this.query(databaseId, {
        viewId: request.viewId,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      return refreshed.ok
        ? { ok: true, value: { ...refreshed.value, staleCursorRecovered: true } }
        : refreshed;
    }

    // A newly created or edited saved view is not queryable on the server yet.
    // Asking anyway produces an expected invalid-view response and, worse,
    // rerenders the active surface during the pointer/keyboard gesture that
    // followed the save. The complete local projection is authoritative for
    // this pending interval and already carries honest row sync states.
    if (sync.definitionIsLocal && localPage !== null) {
      return {
        ok: true,
        value: {
          ...localPage,
          rows: withState(localPage.rows),
          source: "local",
          staleCursorRecovered: false,
        },
      };
    }
    let staleCursorRecovered = false;
    let server = await this.#local.api.queryDatabase(databaseId, request);
    if (
      !server.ok &&
      server.problem.code === "database.cursor-stale" &&
      request.cursor !== undefined
    ) {
      staleCursorRecovered = true;
      server = await this.#local.api.queryDatabase(databaseId, {
        viewId: request.viewId,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
    }

    if (!server.ok) {
      if (localPage === null) return { ok: false, problem: server.problem };
      return {
        ok: true,
        value: {
          ...localPage,
          rows: withState(localPage.rows),
          source: "local",
          staleCursorRecovered,
        },
      };
    }
    if (localPage === null) {
      return {
        ok: true,
        value: {
          ...server.value,
          rows: withState(server.value.rows),
          source: "server",
          staleCursorRecovered,
        },
      };
    }

    if (localPage.coverage === "complete") {
      return {
        ok: true,
        value: {
          ...localPage,
          rows: withState(localPage.rows),
          source: "merged",
          staleCursorRecovered,
        },
      };
    }

    const rows = mergeDatabaseViewRows(server.value.rows, localPage.rows, states);
    return {
      ok: true,
      value: {
        ...server.value,
        rows,
        source: "merged",
        staleCursorRecovered,
      },
    };
  }
}
