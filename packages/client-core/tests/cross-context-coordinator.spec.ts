import { openLocalDatabase, withLocalDatabaseLock } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it } from "vitest";

const openedDatabases: ReturnType<typeof openLocalDatabase>[] = [];

function database(name: string) {
  const db = openLocalDatabase(name);
  openedDatabases.push(db);
  return db;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(async () => {
  const names = new Set(openedDatabases.map(({ name }) => name));
  for (const db of openedDatabases.splice(0)) db.close();
  for (const name of names) await openLocalDatabase(name).delete();
});

describe("cross-context local coordination", () => {
  it("serializes the same resource across independent Dexie handles", async () => {
    const name = `cross-context-${generateUuidV7()}`;
    const firstDb = database(name);
    const secondDb = database(name);
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const order: string[] = [];

    const first = withLocalDatabaseLock(firstDb, "page:one:write", async () => {
      order.push("first-enter");
      firstEntered.resolve();
      await releaseFirst.promise;
      order.push("first-leave");
    });
    await firstEntered.promise;

    let secondEntered = false;
    const second = withLocalDatabaseLock(secondDb, "page:one:write", async () => {
      secondEntered = true;
      order.push("second-enter");
    });

    await Promise.resolve();
    expect(secondEntered).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-enter", "first-leave", "second-enter"]);
  });

  it("releases the resource when its owner throws", async () => {
    const db = database(`cross-context-failure-${generateUuidV7()}`);
    const failure = new Error("simulated owner termination");

    await expect(
      withLocalDatabaseLock(db, "workspace:sync", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    await expect(
      withLocalDatabaseLock(db, "workspace:sync", async () => "successor"),
    ).resolves.toBe("successor");
  });

  it("does not serialize unrelated resources", async () => {
    const db = database(`cross-context-independent-${generateUuidV7()}`);
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let secondEntered = false;

    const first = withLocalDatabaseLock(db, "page:one:sync", async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;
    await withLocalDatabaseLock(db, "page:two:sync", async () => {
      secondEntered = true;
    });

    expect(secondEntered).toBe(true);
    releaseFirst.resolve();
    await first;
  });
});
