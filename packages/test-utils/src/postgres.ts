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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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

const migrationsDir = path.resolve(import.meta.dirname, "../../database/migrations");

/** Applies every reviewed SQL migration to the disposable database. */
export async function applyMigrations(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const { rowCount } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version],
      );
      if ((rowCount ?? 0) > 0) {
        continue;
      }
      applied.push(version);
      await client.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  } finally {
    await client.end();
  }
  return applied;
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
