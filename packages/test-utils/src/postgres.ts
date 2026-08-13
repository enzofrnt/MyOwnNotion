/**
 * Disposable PostgreSQL fixtures (T016).
 *
 * Preference order:
 * 1. `TEST_DATABASE_URL` — an already running disposable PostgreSQL (used in
 *    environments without Docker). Each acquisition creates a uniquely named
 *    database on that server so tests stay isolated, and drops it on release.
 * 2. Testcontainers — starts a `postgres:18` container per suite.
 */
import { randomBytes } from "node:crypto";
import { migrate } from "@myownnotion/database";
import pg from "pg";

export interface DisposablePostgres {
  readonly connectionString: string;
  stop(): Promise<void>;
}

async function createFromTemplateServer(baseUrl: string): Promise<DisposablePostgres> {
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  const databaseName = `mon_test_${randomBytes(8).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await admin.end();

  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  const connectionString = url.toString();

  return {
    connectionString,
    stop: async () => {
      const cleanup = new pg.Client({ connectionString: baseUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

async function createFromTestcontainers(): Promise<DisposablePostgres> {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer("postgres:18").start();
  return {
    connectionString: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

export async function startDisposablePostgres(): Promise<DisposablePostgres> {
  const explicit = process.env["TEST_DATABASE_URL"];
  if (explicit !== undefined && explicit.length > 0) {
    return createFromTemplateServer(explicit);
  }
  return createFromTestcontainers();
}

/**
 * Applies every reviewed SQL migration to the disposable database.
 *
 * Delegates to the one runner in `@myownnotion/database`. This used to be a
 * second copy of the same loop, which meant fixtures could drift from what
 * `pnpm db:migrate` and the API image actually apply — the one thing a
 * migration fixture must not do.
 */
export async function applyMigrations(connectionString: string): Promise<string[]> {
  return await migrate(connectionString);
}

export async function startMigratedPostgres(): Promise<DisposablePostgres> {
  const database = await startDisposablePostgres();
  try {
    await applyMigrations(database.connectionString);
  } catch (error) {
    await database.stop();
    throw error;
  }
  return database;
}
