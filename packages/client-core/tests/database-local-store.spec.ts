import {
  LOCAL_SCHEMA_VERSION,
  type LocalDatabase,
  LocalDatabaseRepository,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { createInitialDatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

const databasesToDelete = new Set<string>();

afterEach(async () => {
  for (const name of databasesToDelete) await Dexie.delete(name);
  databasesToDelete.clear();
});

function databaseDefinition(databaseId: Uuid) {
  return createInitialDatabaseDefinition({
    type: "database.create",
    id: databaseId,
    name: "Private database",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Private table",
  });
}

async function seedHost(db: LocalDatabase, databaseId: Uuid, offlineIntent = false) {
  const { codec } = await createTestCodec();
  await db.items.put(
    await codec.sealItem({
      id: databaseId,
      kind: "page",
      name: "Private database",
      icon: null,
      lifecycle: "active",
      currentRevisionId: generateUuidV7(),
      trashedAt: null,
      purgeAfter: null,
      favourite: false,
      offlineIntent,
      localAvailability: "present",
      pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
      file: null,
    }),
  );
}

describe("structured local schema migration (T070)", () => {
  it("upgrades a version-5 projection without losing existing rows", async () => {
    const name = `database-migration-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const legacy = new Dexie(name);
    legacy.version(5).stores({
      items: "id, kind, lifecycle, localAvailability",
      placements: "id, itemId, parentKey, [parentKey+kind]",
      relationships: "id, sourceItemId, targetItemId",
      revisionHeaders: "id, itemId, local",
      outbox: "mutationId, status, enqueueOrder",
      conflicts: "mutationId, capturedAt",
      meta: "key",
    });
    await legacy.table("meta").put({ key: "lastChangeCursor", value: "before-v6" });
    legacy.close();

    const upgraded = openLocalDatabase(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(LOCAL_SCHEMA_VERSION);
    expect(await upgraded.meta.get("lastChangeCursor")).toEqual({
      key: "lastChangeCursor",
      value: "before-v6",
    });
    expect(upgraded.databases.schema.primKey.name).toBe("itemId");
    expect(
      upgraded.databaseEntries.schema.indexes.some(
        (index) => index.name === "[databaseId+availability]",
      ),
    ).toBe(true);
    upgraded.close();
  });
});

describe("structured local durability and coverage (T070)", () => {
  it("keeps sealed data across restart and reports offloaded values as partial", async () => {
    const name = `database-restart-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const { codec } = await createTestCodec();
    let db = openLocalDatabase(name);
    const databaseId = generateUuidV7();
    const entryId = generateUuidV7();
    await seedHost(db, databaseId);
    let repository = new LocalDatabaseRepository(db, codec);
    await repository.putDatabase({
      itemId: databaseId,
      definitionVersion: 1,
      definition: databaseDefinition(databaseId),
    });
    await repository.putEntry({
      entryItemId: entryId,
      databaseId,
      valueVersion: 1,
      availability: "present",
      values: {
        format: "myownnotion.database-entry-values+json",
        formatVersion: 1,
        databaseId,
        entryId,
        values: {},
        preserved: [],
      },
    });

    expect(JSON.stringify(await db.databases.get(databaseId))).not.toContain("Private table");
    expect(await repository.coverage(databaseId)).toMatchObject({
      coverage: "complete",
      availableCount: 1,
      expectedCount: 1,
      offlineReady: false,
    });
    expect((await repository.setOfflineIntent(databaseId, true)).offlineReady).toBe(true);
    expect(await repository.offloadEntryValues(entryId)).toBe(false);
    await repository.setOfflineIntent(databaseId, false);
    expect(await repository.offloadEntryValues(entryId)).toBe(true);
    expect(await db.databaseEntries.get(entryId)).toMatchObject({
      availability: "offloaded",
      sealedValues: null,
    });

    db.close();
    db = openLocalDatabase(name);
    repository = new LocalDatabaseRepository(db, codec);
    expect(await repository.coverage(databaseId)).toMatchObject({
      coverage: "partial",
      availableCount: 0,
      expectedCount: 1,
      offlineReady: false,
    });
    expect(await repository.getEntry(entryId)).toMatchObject({
      entryItemId: entryId,
      availability: "offloaded",
      values: { databaseId, entryId, values: {}, preserved: [] },
    });
    expect(await repository.listEntries(databaseId)).toEqual([
      expect.objectContaining({ entryItemId: entryId, databaseId }),
    ]);
    db.close();
  });

  it("never offloads structured values with unsynchronized local work", async () => {
    const name = `database-pending-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const { codec } = await createTestCodec();
    const db = openLocalDatabase(name);
    const repository = new LocalDatabaseRepository(db, codec);
    const databaseId = generateUuidV7();
    const entryId = generateUuidV7();
    await seedHost(db, databaseId);
    await repository.putEntry({
      entryItemId: entryId,
      databaseId,
      valueVersion: 1,
      availability: "present",
      values: {
        format: "myownnotion.database-entry-values+json",
        formatVersion: 1,
        databaseId,
        entryId,
        values: {},
        preserved: [],
      },
    });
    await db.outbox.put(
      (await codec.sealOutbox({
        mutationId: generateUuidV7(),
        commandType: "database.entry.values.replace",
        payload: { databaseId, entryId },
        baseRevisionIds: [],
        localRevisionIds: [],
        status: "pending",
        createdAt: new Date().toISOString(),
        lastAttemptAt: null,
        enqueueOrder: 1,
      })) as never,
    );

    expect(await repository.offloadEntryValues(entryId)).toBe(false);
    expect((await db.databaseEntries.get(entryId))?.sealedValues).not.toBeNull();
    db.close();
  });

  it("detects unsynchronized work stored with a plaintext payload", async () => {
    const name = `database-plaintext-outbox-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const { codec } = await createTestCodec();
    const db = openLocalDatabase(name);
    const repository = new LocalDatabaseRepository(db, codec);
    const databaseId = generateUuidV7();
    const entryId = generateUuidV7();
    await seedHost(db, databaseId);
    await repository.putEntry({
      entryItemId: entryId,
      databaseId,
      valueVersion: 1,
      availability: "present",
      values: {
        format: "myownnotion.database-entry-values+json",
        formatVersion: 1,
        databaseId,
        entryId,
        values: {},
        preserved: [],
      },
    });
    await db.outbox.put({
      mutationId: generateUuidV7(),
      commandType: "database.entry.values.replace",
      payload: { databaseId, entryId },
      baseRevisionIds: [],
      localRevisionIds: [],
      status: "pending",
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
      enqueueOrder: 1,
    });

    expect(await repository.offloadEntryValues(entryId)).toBe(false);
    db.close();
  });

  it("keeps related targets scoped, deduplicated, and deterministically ordered", async () => {
    const name = `database-relations-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const { codec } = await createTestCodec();
    const db = openLocalDatabase(name);
    const repository = new LocalDatabaseRepository(db, codec);
    const databaseId = generateUuidV7();
    const otherDatabaseId = generateUuidV7();
    const entryId = generateUuidV7();
    const propertyId = generateUuidV7();
    const targetA = generateUuidV7();
    const targetB = generateUuidV7();

    await db.relationships.bulkPut([
      {
        id: generateUuidV7(),
        sourceItemId: entryId,
        targetItemId: targetB,
        relationType: "database:property",
        metadata: { databaseId, propertyId },
      },
      {
        id: generateUuidV7(),
        sourceItemId: entryId,
        targetItemId: targetA,
        relationType: "database:property",
        metadata: { databaseId, propertyId },
      },
      {
        id: generateUuidV7(),
        sourceItemId: entryId,
        targetItemId: targetA,
        relationType: "database:property",
        metadata: { databaseId, propertyId },
      },
      {
        id: generateUuidV7(),
        sourceItemId: entryId,
        targetItemId: generateUuidV7(),
        relationType: "database:property",
        metadata: { databaseId: otherDatabaseId, propertyId },
      },
      {
        id: generateUuidV7(),
        sourceItemId: entryId,
        targetItemId: generateUuidV7(),
        relationType: "attachment",
        metadata: { databaseId, propertyId },
      },
      {
        id: generateUuidV7(),
        sourceItemId: entryId,
        targetItemId: generateUuidV7(),
        relationType: "database:property",
        metadata: { databaseId, propertyId: 42 },
      },
    ]);

    expect(await repository.getRelationTargets(databaseId, entryId)).toEqual({
      [propertyId]: [targetA, targetB].sort(),
    });
    db.close();
  });

  it("protects values referenced by a sealed conflict and rejects absent entries", async () => {
    const name = `database-conflict-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const { codec } = await createTestCodec();
    const db = openLocalDatabase(name);
    const repository = new LocalDatabaseRepository(db, codec);
    const databaseId = generateUuidV7();
    const entryId = generateUuidV7();
    await seedHost(db, databaseId);
    await repository.putEntry({
      entryItemId: entryId,
      databaseId,
      valueVersion: 1,
      availability: "present",
      values: {
        format: "myownnotion.database-entry-values+json",
        formatVersion: 1,
        databaseId,
        entryId,
        values: {},
        preserved: [],
      },
    });
    await db.conflicts.put(
      (await codec.sealConflict({
        mutationId: generateUuidV7(),
        commandType: "database.entry.values.replace",
        payload: { itemId: entryId },
        baseRevisionIds: [],
        localRevisionIds: [],
        competingRevisionIds: [generateUuidV7()],
        capturedAt: new Date().toISOString(),
        errorCode: "revision.stale-base",
      })) as never,
    );

    expect(await repository.offloadEntryValues(generateUuidV7())).toBe(false);
    expect(await repository.offloadEntryValues(entryId)).toBe(false);
    expect((await db.databaseEntries.get(entryId))?.sealedValues).not.toBeNull();
    db.close();
  });
});
