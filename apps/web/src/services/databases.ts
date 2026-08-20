import {
  type LocalDatabaseQueryEntry,
  LocalDatabaseQueryError,
  type LocalDatabaseQuerySource,
  queryLocalDatabase,
} from "@myownnotion/client-core";
import type { DatabaseQueryDto, DatabaseQueryPageDto, ProblemDto } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
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

function entryIdFromPayload(payload: Readonly<Record<string, unknown>>): Uuid | null {
  const value = payload["entryId"] ?? payload["id"];
  return typeof value === "string" ? (value as Uuid) : null;
}

export class DatabaseViewService {
  readonly #local: LocalContentService;
  #localGeneration = 1;
  readonly #unsubscribe: () => void;

  constructor(local: LocalContentService) {
    this.#local = local;
    this.#unsubscribe = local.subscribeProjection(() => {
      this.#localGeneration += 1;
    });
  }

  dispose(): void {
    this.#unsubscribe();
  }

  async #localSource(databaseId: Uuid): Promise<LocalDatabaseQuerySource | null> {
    const [database, databaseItem, entryRows] = await Promise.all([
      this.#local.getDatabase(databaseId),
      this.#local.getItem(databaseId),
      this.#local.listDatabaseEntries(databaseId),
    ]);
    if (database === null || databaseItem === null || databaseItem.lifecycle !== "active") {
      return null;
    }
    const entries: LocalDatabaseQueryEntry[] = [];
    for (const row of entryRows) {
      const item = await this.#local.getItem(row.entryItemId);
      if (item === null || item.lifecycle !== "active") continue;
      const relationTargets = await this.#local.getDatabaseEntryRelationTargets(
        databaseId,
        row.entryItemId,
      );
      entries.push({
        entryId: row.entryItemId,
        revisionId: item.currentRevisionId,
        title: item.name,
        availability: row.availability,
        values: row.values.values,
        relationTargets,
      });
    }
    return {
      databaseId,
      definitionRevisionId: databaseItem.currentRevisionId,
      definition: database.definition,
      generation: this.#localGeneration,
      expectedCount: entryRows.length,
      entries,
    };
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

  async #syncStates(): Promise<ReadonlyMap<Uuid, DatabaseRowSyncState>> {
    const [pending, conflicts] = await Promise.all([
      this.#local.outbox.pending(),
      this.#local.outbox.conflicts(),
    ]);
    const states = new Map<Uuid, DatabaseRowSyncState>();
    for (const mutation of pending) {
      const entryId = entryIdFromPayload(mutation.payload);
      if (entryId !== null) states.set(entryId, "pending");
    }
    for (const conflict of conflicts) {
      const entryId = entryIdFromPayload(conflict.payload);
      if (entryId !== null) states.set(entryId, "conflict");
    }
    return states;
  }

  async query(databaseId: Uuid, request: DatabaseQueryDto): Promise<DatabaseViewResult> {
    const localRequest =
      request.cursor?.startsWith("local.") === true
        ? request
        : {
            viewId: request.viewId,
            ...(request.limit === undefined ? {} : { limit: request.limit }),
          };
    const [localPage, states] = await Promise.all([
      this.#localQuery(databaseId, localRequest),
      this.#syncStates(),
    ]);
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

    const withState = (rows: readonly DatabaseQueryPageDto["rows"][number][]): DatabaseViewRow[] =>
      rows.map((row) => ({ ...row, syncState: states.get(row.entryId as Uuid) ?? "synced" }));

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

    const localRows = new Map(localPage.rows.map((row) => [row.entryId, row]));
    const rows = server.value.rows.map((row) => {
      const state = states.get(row.entryId as Uuid) ?? "synced";
      return {
        ...(state === "synced" ? row : (localRows.get(row.entryId) ?? row)),
        syncState: state,
      };
    });
    for (const row of localPage.rows) {
      if (!rows.some(({ entryId }) => entryId === row.entryId) && states.has(row.entryId as Uuid)) {
        rows.push({ ...row, syncState: states.get(row.entryId as Uuid) ?? "pending" });
      }
    }
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
