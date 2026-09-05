import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DisposablePostgres, startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentAad, openFullStream, sealFullStream } from "../src/backup/full/crypto.ts";
import { PostgresFullBackupTools, postgresToolEnvironment } from "../src/backup/full/postgres.ts";
import { inspectFullSource } from "../src/backup/full/source.ts";

let source: DisposablePostgres;
let target: DisposablePostgres;
let sourceClient: pg.Client;
let targetClient: pg.Client;
let directory: string;
const tools = new PostgresFullBackupTools();

beforeAll(async () => {
  source = await startDisposablePostgres();
  target = await startDisposablePostgres();
  sourceClient = new pg.Client({ connectionString: source.connectionString });
  targetClient = new pg.Client({ connectionString: target.connectionString });
  await sourceClient.connect();
  await targetClient.connect();
  directory = await mkdtemp(join(tmpdir(), "mon-pg-full-test-"));
  await tools.checkVersions(source.connectionString);
});
afterAll(async () => {
  await sourceClient?.end();
  await targetClient?.end();
  await source?.stop();
  await target?.stop();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

describe("native PostgreSQL full backup tools", () => {
  it("inspects a blank source without creating current-schema guard tables", async () => {
    const before = await inspectFullSource(sourceClient);
    expect(before.nonempty).toBe(false);
    expect(before.source).toMatchObject({
      installationId: null,
      applicationVersion: null,
      appliedMigrations: [],
    });
    expect(
      (await sourceClient.query("SELECT to_regclass('public.schema_migrations') AS relation"))
        .rows[0].relation,
    ).toBeNull();
  });

  it("restores unknown tables, binary values and sequences from the exported snapshot through encrypted staging", async () => {
    await sourceClient.query(
      "CREATE TABLE surprise (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, content bytea NOT NULL)",
    );
    const value = randomBytes(80_000);
    await sourceClient.query("INSERT INTO surprise(content) VALUES ($1)", [value]);
    await sourceClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const snapshot = (await sourceClient.query("SELECT pg_export_snapshot() AS snapshot")).rows[0]
        .snapshot as string;
      const other = new pg.Client({ connectionString: source.connectionString });
      await other.connect();
      try {
        await other.query("INSERT INTO surprise(content) VALUES ($1)", [
          Buffer.from("committed after snapshot"),
        ]);
      } finally {
        await other.end();
      }
      const key = randomBytes(32);
      const aad = componentAad(randomUUID(), 0, "database.dump");
      const encrypted = join(directory, "dump.encrypted");
      const metadata = await sealFullStream(
        tools.dump(source.connectionString, snapshot),
        key,
        aad,
        encrypted,
      );
      const handle = await open(encrypted, "r");
      try {
        // This adapter fixture owns the output; the public restore path must
        // authenticate the complete archive before it can call this adapter.
        await tools.restore(
          target.connectionString,
          openFullStream(handle, 0, metadata.byteLength, key, aad),
        );
      } finally {
        await handle.close();
      }
      const restored = await targetClient.query("SELECT id, content FROM surprise ORDER BY id");
      expect(restored.rows).toEqual([{ id: "1", content: value }]);
      const next = await targetClient.query(
        "INSERT INTO surprise(content) VALUES ($1) RETURNING id",
        [Buffer.from("after restore")],
      );
      expect(Number(next.rows[0].id)).toBeGreaterThan(1);
      expect((await inspectFullSource(sourceClient)).nonempty).toBe(true);
    } finally {
      await sourceClient.query("ROLLBACK");
    }
  });

  it("reads historical provenance without the application_version column and preserves a recorded version when present", async () => {
    await sourceClient.query("CREATE TABLE schema_migrations(version text PRIMARY KEY)");
    await sourceClient.query("INSERT INTO schema_migrations VALUES ('0001_initial')");
    await sourceClient.query("CREATE TABLE installations(id uuid PRIMARY KEY)");
    const id = randomUUID();
    await sourceClient.query("INSERT INTO installations VALUES ($1)", [id]);
    expect((await inspectFullSource(sourceClient)).source).toMatchObject({
      installationId: id,
      applicationVersion: null,
      appliedMigrations: ["0001_initial"],
    });
    await sourceClient.query("ALTER TABLE installations ADD COLUMN application_version text");
    await sourceClient.query("UPDATE installations SET application_version = '0.1.0'");
    expect((await inspectFullSource(sourceClient)).source.applicationVersion).toBe("0.1.0");
    await sourceClient.query("INSERT INTO installations(id) VALUES ($1)", [randomUUID()]);
    await expect(inspectFullSource(sourceClient)).rejects.toThrow("ambiguous");
  });

  it("refuses invalid snapshots and failed dumps without returning successful metadata", async () => {
    async function consume(snapshot: string) {
      for await (const _bytes of tools.dump(source.connectionString, snapshot)) {
        /* Drain the process. */
      }
    }
    await expect(consume("--file=secret")).rejects.toThrow("snapshot identifier");
    await expect(consume("00000000-00000000-1")).rejects.toThrow("did not complete");
    await expect(
      tools.restore(
        target.connectionString,
        (async function* () {
          yield Buffer.from("invalid dump");
        })(),
      ),
    ).rejects.toThrow();
    expect(
      (await targetClient.query("SELECT count(*)::integer AS count FROM surprise")).rows[0].count,
    ).toBe(2);
  });
});

describe("PostgreSQL process configuration", () => {
  it("decodes credentials only into the child environment and carries TLS options explicitly", () => {
    const env = postgresToolEnvironment(
      "postgres://owner:p%40ss%3Aword@[::1]:55432/private%20data?sslmode=verify-full&connect_timeout=9",
    );
    expect(env).toMatchObject({
      PGHOST: "::1",
      PGPORT: "55432",
      PGUSER: "owner",
      PGPASSWORD: "p@ss:word",
      PGDATABASE: "private data",
      PGSSLMODE: "verify-full",
      PGCONNECT_TIMEOUT: "9",
    });
    expect(env["DATABASE_URL"]).toBeUndefined();
    expect(env["PGOPTIONS"]).toBeUndefined();
  });
  it.each([
    "not a URL",
    "https://owner@host/db",
    "postgres://host/db",
    "postgres://owner@host/",
    "postgres://owner@host/db?options=private",
  ])("refuses incomplete or unsupported connection settings", (url) => {
    expect(() => postgresToolEnvironment(url)).toThrow();
  });
  it("reports missing tools without exposing connection credentials", async () => {
    const missing = new PostgresFullBackupTools({ binDirectory: join(directory, "missing") });
    await expect(
      missing.checkVersions("postgres://owner:secret@localhost/private"),
    ).rejects.toThrow("pg_dump did not complete");
  });
});
