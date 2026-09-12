import { createDatabase } from "@myownnotion/database";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let postgres: DisposablePostgres;

beforeAll(async () => {
  postgres = await startMigratedPostgres();
});

afterAll(async () => {
  await postgres.stop();
});

describe("database client lifecycle", () => {
  it("does not resolve close until every PostgreSQL socket has ended", async () => {
    const handle = createDatabase(postgres.connectionString);
    const clients = await Promise.all([handle.pool.connect(), handle.pool.connect()]);
    for (const client of clients) client.release();

    const expectedRemovals = handle.pool.totalCount;
    let observedRemovals = 0;
    handle.pool.on("remove", () => {
      observedRemovals += 1;
    });

    await Promise.all([handle.close(), handle.close()]);

    expect(expectedRemovals).toBe(2);
    expect(observedRemovals).toBe(expectedRemovals);
  });

  it("closes the reserved write-ahead lane with the primary pool", async () => {
    const handle = createDatabase(postgres.connectionString);
    await expect(handle.journalDb.execute(sql`SELECT 1 AS ready`)).resolves.toBeDefined();

    await handle.close();

    await expect(handle.journalDb.execute(sql`SELECT 1 AS ready`)).rejects.toThrow();
  });
});
