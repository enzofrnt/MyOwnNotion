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

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Fail fast in development rather than hanging on a missing database.
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
