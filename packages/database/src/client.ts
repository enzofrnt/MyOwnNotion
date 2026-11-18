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
  /**
   * Single-connection lane for short write-ahead facts that must commit
   * independently of a caller's canonical transaction.
   */
  readonly journalDb: Database;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Tracks every connected client until its PostgreSQL stream ends.
 *
 * `Pool.end()` resolves as soon as every client has been removed from the
 * pool's bookkeeping, while each client's asynchronous close callback may
 * still be pending. A caller that destroys its disposable PostgreSQL database
 * immediately afterwards can therefore terminate those sockets with 57P01
 * even though it correctly awaited `close()`. Tracking the socket from the
 * pool's `connect` event also covers a client that started leaving the pool
 * before `close()` was called.
 */
function trackPoolShutdown(pool: pg.Pool): () => Promise<void> {
  const clientClosures = new Map<pg.PoolClient, Promise<void>>();
  const recordConnection = (client: pg.PoolClient): void => {
    let markClosed = (): void => undefined;
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve;
    });
    clientClosures.set(client, closed);
    const stream = client.connection.stream;
    const recordEnd = (): void => {
      stream.off("end", recordEnd);
      stream.off("close", recordEnd);
      markClosed();
      clientClosures.delete(client);
    };
    // Graceful PostgreSQL shutdown ends the readable stream. A forced socket
    // teardown may reach `close` without `end`, so either event completes it.
    stream.once("end", recordEnd);
    stream.once("close", recordEnd);
  };
  pool.on("connect", recordConnection);

  return async () => {
    try {
      await pool.end();
      await Promise.all(clientClosures.values());
    } finally {
      pool.off("connect", recordConnection);
    }
  };
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Fail fast in development rather than hanging on a missing database.
    connectionTimeoutMillis: 10_000,
  });
  const closePrimaryPool = trackPoolShutdown(pool);
  // Keep the write-ahead lane outside the primary pool. A transaction may
  // already own the last primary connection when it has to journal a physical
  // side effect; borrowing from that same pool would deadlock at saturation.
  const journalPool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const closeJournalPool = trackPoolShutdown(journalPool);
  const db = drizzle(pool, { schema, casing: "snake_case" });
  const journalDb = drizzle(journalPool, { schema, casing: "snake_case" });
  let closePromise: Promise<void> | undefined;
  return {
    db,
    journalDb,
    pool,
    close: () => {
      closePromise ??= Promise.all([closePrimaryPool(), closeJournalPool()]).then(() => undefined);
      return closePromise;
    },
  };
}
