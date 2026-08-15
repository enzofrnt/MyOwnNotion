import { createDatabase, type DatabaseHandle, getOrCreateWorkspace } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { applyMigrations, startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: Awaited<ReturnType<typeof startDisposablePostgres>>;
let handle: DatabaseHandle;

beforeAll(async () => {
  database = await startDisposablePostgres();
  await applyMigrations(database.connectionString);
  handle = createDatabase(database.connectionString);
});

afterAll(async () => {
  await handle.close();
  await database.stop();
});

async function withClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: database.connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function workspaceCount(): Promise<number> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ count: string }>("SELECT count(*) FROM workspaces");
    return Number(rows[0]?.count ?? "0");
  });
}

describe("migration 0002_workspace_singleton", () => {
  it("is applied and creates the singleton index", async () => {
    const indexes = await withClient(async (client) => {
      const { rows } = await client.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'workspaces'",
      );
      return rows.map((row) => row.indexname);
    });
    expect(indexes).toContain("workspaces_singleton_idx");
  });

  // The former "applies forward over an existing database" case was removed
  // with feature 004, which collapsed 0001-0005 into one initial migration.
  // It applied 0001 alone, seeded a workspace, then applied 0002 — a path that
  // no longer exists, and cannot be re-created without keeping the migrations
  // it was testing. The guarantee it protected is still covered above: the
  // singleton index exists, and the concurrent-bootstrap cases below assert
  // the behaviour it gives.
});

describe("workspace bootstrap", () => {
  it("creates exactly one workspace and returns the same row afterwards", async () => {
    const first = await getOrCreateWorkspace(handle.db);
    const second = await getOrCreateWorkspace(handle.db);

    expect(second.id).toBe(first.id);
    expect(second.schemaVersion).toBe(first.schemaVersion);
    expect(await workspaceCount()).toBe(1);
  });

  it("concurrent bootstraps all resolve to the one workspace", async () => {
    const existing = await getOrCreateWorkspace(handle.db);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getOrCreateWorkspace(handle.db)),
    );

    for (const result of results) {
      expect(result.id).toBe(existing.id);
    }
    expect(await workspaceCount()).toBe(1);
  });
});

describe("the storage layer refuses a second workspace", () => {
  it("rejects a direct insert of another workspace", async () => {
    const before = await workspaceCount();
    expect(before).toBe(1);

    await expect(
      withClient(async (client) => {
        await client.query("INSERT INTO workspaces (id, schema_version) VALUES ($1, $2)", [
          generateUuidV7(),
          1,
        ]);
      }),
      // A stray workspace is now a loud unique violation, not a silent extra row.
    ).rejects.toMatchObject({ code: "23505" });

    expect(await workspaceCount()).toBe(before);
  });

  it("still rejects the insert inside an explicit transaction", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      await expect(
        client.query("INSERT INTO workspaces (id, schema_version) VALUES ($1, $2)", [
          generateUuidV7(),
          1,
        ]),
      ).rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK");
    });
    expect(await workspaceCount()).toBe(1);
  });

  it("keeps rejecting a schema_version below the documented minimum", async () => {
    // Pre-existing CHECK from migration 0001, now also declared in the
    // Drizzle schema so the two representations agree.
    await withClient(async (client) => {
      await client.query("DELETE FROM workspaces");
      await expect(
        client.query("INSERT INTO workspaces (id, schema_version) VALUES ($1, $2)", [
          generateUuidV7(),
          0,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});
