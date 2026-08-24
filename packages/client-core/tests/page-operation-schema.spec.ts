import { LOCAL_SCHEMA_VERSION, openLocalDatabase } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it } from "vitest";

const databasesToDelete = new Set<string>();

const v6Stores = {
  items: "id, kind, lifecycle, localAvailability",
  placements: "id, itemId, parentKey, [parentKey+kind]",
  relationships: "id, sourceItemId, targetItemId",
  revisionHeaders: "id, itemId, local",
  outbox: "mutationId, status, enqueueOrder",
  conflicts: "mutationId, capturedAt",
  meta: "key",
  databases: "itemId",
  databaseEntries: "entryItemId, databaseId, availability, [databaseId+availability]",
} as const;

const v7Stores = {
  ...v6Stores,
  pageOperationStates: "pageId, status, localAvailability, lastAccessedAt",
  pageOperationUpdates: "updateId, pageId, status, enqueueOrder, [pageId+status]",
  pageAmbiguities: "ambiguityId, pageId, status, [pageId+status]",
  legacyOfflineBranches: "pageId, branchId, status",
} as const;

afterEach(async () => {
  for (const name of databasesToDelete) await Dexie.delete(name);
  databasesToDelete.clear();
});

describe("page-operation local schema v8", () => {
  it("upgrades v6 without changing historical projection rows", async () => {
    const name = `page-operations-v6-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const legacy = new Dexie(name);
    legacy.version(6).stores(v6Stores);
    const databaseId = generateUuidV7();
    const entryId = generateUuidV7();
    await legacy.table("meta").put({ key: "lastChangeCursor", value: "before-v7" });
    await legacy.table("databaseEntries").put({
      entryItemId: entryId,
      databaseId,
      valueVersion: 4,
      availability: "offloaded",
      sealedValues: null,
    });
    legacy.close();

    const upgraded = openLocalDatabase(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(LOCAL_SCHEMA_VERSION);
    expect(await upgraded.meta.get("lastChangeCursor")).toEqual({
      key: "lastChangeCursor",
      value: "before-v7",
    });
    expect(await upgraded.databaseEntries.get(entryId)).toMatchObject({
      databaseId,
      valueVersion: 4,
      availability: "offloaded",
    });
    expect(await upgraded.pageOperationStates.count()).toBe(0);
    expect(await upgraded.pageOperationUpdates.count()).toBe(0);
    expect(await upgraded.pageAmbiguities.count()).toBe(0);
    expect(await upgraded.legacyOfflineBranches.count()).toBe(0);
    upgraded.close();
  });

  it("retains the complete historical version chain when opening a v1 database", async () => {
    const name = `page-operations-v1-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      items: "id, kind, lifecycle",
      placements: "id, itemId, parentKey, [parentKey+kind]",
      relationships: "id, sourceItemId, targetItemId",
      revisionHeaders: "id, itemId, local",
      outbox: "mutationId, status, enqueueOrder",
      conflicts: "mutationId, capturedAt",
      meta: "key",
    });
    await legacy.table("meta").put({ key: "historical", value: { retained: true } });
    legacy.close();

    const upgraded = openLocalDatabase(name);
    await upgraded.open();

    expect(await upgraded.meta.get("historical")).toEqual({
      key: "historical",
      value: { retained: true },
    });
    expect(upgraded.tables.map(({ name: tableName }) => tableName).sort()).toEqual([
      "conflicts",
      "databaseEntries",
      "databases",
      "items",
      "legacyOfflineBranches",
      "meta",
      "outbox",
      "pageAmbiguities",
      "pageOperationStates",
      "pageOperationUpdates",
      "placements",
      "relationships",
      "revisionHeaders",
    ]);
    upgraded.close();
  });

  it("adds the status-first queue index without rewriting encrypted v7 updates", async () => {
    const name = `page-operations-v7-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const legacy = new Dexie(name);
    legacy.version(7).stores(v7Stores);
    const pageId = generateUuidV7();
    const updateId = generateUuidV7();
    const retained = {
      updateId,
      pageId,
      status: "pending",
      enqueueOrder: 42,
      createdAt: "2026-08-24T12:00:00.000Z",
      recordVersion: 3,
      sealedUpdate: { opaque: "ciphertext-must-not-be-opened-by-the-schema-upgrade" },
    };
    await legacy.table("pageOperationUpdates").put(retained);
    legacy.close();

    const upgraded = openLocalDatabase(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(LOCAL_SCHEMA_VERSION);
    expect(await upgraded.pageOperationUpdates.get(updateId)).toEqual(retained);
    expect(
      upgraded.pageOperationUpdates.schema.indexes.map(({ name: indexName }) => indexName),
    ).toContain("[status+pageId]");
    upgraded.close();
  });

  it("indexes only routing metadata for operational records", async () => {
    const name = `page-operations-indexes-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const db = openLocalDatabase(name);
    await db.open();

    expect(db.pageOperationStates.schema.primKey.name).toBe("pageId");
    expect(db.pageOperationUpdates.schema.indexes.map(({ name: indexName }) => indexName)).toEqual(
      expect.arrayContaining([
        "pageId",
        "status",
        "enqueueOrder",
        "[pageId+status]",
        "[status+pageId]",
      ]),
    );
    expect(db.pageAmbiguities.schema.indexes.map(({ name: indexName }) => indexName)).toEqual(
      expect.arrayContaining(["pageId", "status", "[pageId+status]"]),
    );
    expect(db.legacyOfflineBranches.schema.primKey.name).toBe("pageId");

    db.close();
  });
});
