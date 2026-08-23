/**
 * Drizzle PostgreSQL client (T013).
 *
 * The canonical store is PostgreSQL; every canonical write happens through a
 * transaction created by `runMutation` (see mutations/run-mutation.ts).
 * Schema changes ship as reviewed SQL migrations — never schema push.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Waits for node-postgres to close the sockets it removed from the pool.
 *
 * `Pool.end()` resolves as soon as every client has been removed from the
 * pool's bookkeeping, while each client's asynchronous close callback may
 * still be pending. A caller that destroys its disposable PostgreSQL database
 * immediately afterwards can therefore terminate those sockets with 57P01
 * even though it correctly awaited `close()`. The pool emits `remove` only
 * after the corresponding client has actually ended, so that is the lifecycle
 * boundary this handle promises to its callers.
 */
async function closePool(pool: pg.Pool): Promise<void> {
  const clientsToClose = pool.totalCount;
  if (clientsToClose === 0) {
    await pool.end();
    return;
  }

  let removedClients = 0;
  let resolveAllRemoved: (() => void) | undefined;
  const allRemoved = new Promise<void>((resolve) => {
    resolveAllRemoved = resolve;
  });
  const recordRemoval = (): void => {
    removedClients += 1;
    if (removedClients === clientsToClose) resolveAllRemoved?.();
  };
  pool.on("remove", recordRemoval);
  try {
    await pool.end();
    if (removedClients < clientsToClose) await allRemoved;
  } finally {
    pool.off("remove", recordRemoval);
  }
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Fail fast in development rather than hanging on a missing database.
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  let closePromise: Promise<void> | undefined;
  return {
    db,
    pool,
    close: () => {
      closePromise ??= closePool(pool);
      return closePromise;
    },
  };
}
