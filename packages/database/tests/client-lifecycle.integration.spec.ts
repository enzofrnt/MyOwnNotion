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

    const expectedSockets = handle.pool.totalCount;
    let closedSockets = 0;
    for (const client of clients) {
      client.connection.stream.once("end", () => {
        closedSockets += 1;
      });
    }

    await Promise.all([handle.close(), handle.close()]);

    expect(expectedSockets).toBe(2);
    expect(closedSockets).toBe(expectedSockets);
  });

  it("waits for a socket already removed from pool bookkeeping", async () => {
    const handle = createDatabase(postgres.connectionString);
    const client = await handle.pool.connect();
    const originalEnd = client.end.bind(client) as (callback: () => void) => void;
    let reportSocketClosed = (): void => undefined;
    let markEndingStarted = (): void => undefined;
    const endingStarted = new Promise<void>((resolve) => {
      markEndingStarted = resolve;
    });
    client.end = ((callback: () => void): void => {
      markEndingStarted();
      reportSocketClosed = () => originalEnd(callback);
    }) as typeof client.end;

    client.release(new Error("retire this client before closing the pool"));
    await endingStarted;
    expect(handle.pool.totalCount).toBe(0);

    let closeResolved = false;
    const closing = handle.close().then(() => {
      closeResolved = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const resolvedBeforeSocketClosed = closeResolved;

    reportSocketClosed();
    await closing;

    expect(resolvedBeforeSocketClosed).toBe(false);
    expect(closeResolved).toBe(true);
  });

  it("closes the reserved write-ahead lane with the primary pool", async () => {
    const handle = createDatabase(postgres.connectionString);
    await expect(handle.journalDb.execute(sql`SELECT 1 AS ready`)).resolves.toBeDefined();

    await handle.close();

    await expect(handle.journalDb.execute(sql`SELECT 1 AS ready`)).rejects.toThrow();
  });
});
