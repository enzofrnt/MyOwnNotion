import {
  LocalDatabaseQueryError,
  type LocalDatabaseQuerySource,
  queryLocalDatabase,
} from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";
import type { DatabaseRowSyncState, DatabaseViewResult } from "../../services/databases.ts";

/** A page-backed display queries its selected source with its own view settings. */
export class PageViewQuery {
  #source: LocalDatabaseQuerySource | null = null;
  #signature = "";
  #generation = 0;
  #states: ReadonlyMap<Uuid, DatabaseRowSyncState> = new Map();

  update(
    source: Omit<LocalDatabaseQuerySource, "generation">,
    states: ReadonlyMap<Uuid, DatabaseRowSyncState>,
  ): number {
    const signature = JSON.stringify(source);
    if (signature !== this.#signature) {
      this.#signature = signature;
      this.#source = { ...source, generation: ++this.#generation };
    }
    this.#states = states;
    return this.#generation;
  }

  async query(viewId: Uuid, cursor?: string): Promise<DatabaseViewResult> {
    if (this.#source === null) throw new Error("Source unavailable");
    let recovered = false;
    const request = { viewId, limit: 100, ...(cursor === undefined ? {} : { cursor }) };
    let page: ReturnType<typeof queryLocalDatabase>;
    try {
      page = queryLocalDatabase(this.#source, request);
    } catch (error) {
      if (!(error instanceof LocalDatabaseQueryError)) throw error;
      if (error.code !== "database.cursor-stale") {
        return {
          ok: false,
          problem: {
            type: "about:blank",
            title: "Cette vue ne peut pas être chargée.",
            status: 422,
            code: error.code,
          },
        };
      }
      page = queryLocalDatabase(this.#source, { viewId, limit: 100 });
      recovered = true;
    }
    return {
      ok: true,
      value: {
        ...page,
        rows: page.rows.map((row) => ({
          ...row,
          syncState: this.#states.get(row.entryId as Uuid) ?? "synced",
        })),
        source: "local",
        staleCursorRecovered: recovered,
      },
    };
  }
}
