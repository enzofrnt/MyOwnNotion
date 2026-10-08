import {
  LOCAL_SCHEMA_VERSION,
  type LocalDatabase,
  type LocalDatabaseEntryRow,
  LocalDatabaseRepository,
  type LocalDatabaseRow,
  openLocalDatabase,
  type SealedConflictRecordRow,
  type SealedOutboxMutationRow,
} from "@myownnotion/client-core";
import { createInitialDatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

const databasesToDelete = new Set<string>();

afterEach(async () => {
  vi.restoreAllMocks();
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
    await db.items.put(
      await codec.sealItem({
        id: entryId,
        kind: "page",
        name: "Private entry",
        icon: null,
        lifecycle: "active",
        currentRevisionId: generateUuidV7(),
        trashedAt: null,
        purgeAfter: null,
        favourite: false,
        offlineIntent: false,
        localAvailability: "present",
        pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
        file: null,
      }),
    );
    await db.placements.add({
      id: generateUuidV7(),
      itemId: entryId,
      kind: "hierarchy",
      parentItemId: databaseId,
      parentKey: databaseId,
      positionKey: "a",
    });
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
    expect(await db.databaseEntryPairs.get(`${databaseId}:${entryId}`)).toMatchObject({
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
    expect(
      (await db.databaseEntryPairs.get(`${databaseId}:${entryId}`))?.sealedValues,
    ).not.toBeNull();
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
    const outsideBatch = generateUuidV7();
    await db.relationships.put({
      id: generateUuidV7(),
      sourceItemId: outsideBatch,
      targetItemId: generateUuidV7(),
      relationType: "database:property",
      metadata: { databaseId, propertyId },
    });
    expect(await repository.getRelationTargetsForEntries(databaseId, [])).toEqual(new Map());
    expect(
      await repository.getRelationTargetsForEntries(databaseId, [entryId, generateUuidV7()]),
    ).toEqual(new Map([[entryId, await repository.getRelationTargets(databaseId, entryId)]]));
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
    expect(
      (await db.databaseEntryPairs.get(`${databaseId}:${entryId}`))?.sealedValues,
    ).not.toBeNull();
    db.close();
  });
});

describe("owned sources and retained memberships", () => {
  async function setup() {
    const name = `owned-source-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const db = openLocalDatabase(name);
    const { codec } = await createTestCodec();
    const repository = new LocalDatabaseRepository(db, codec);
    const ownerId = generateUuidV7();
    const sourceId = generateUuidV7();
    const revisionId = generateUuidV7();
    const definition = databaseDefinition(ownerId);
    const container: LocalDatabaseRow = {
      itemId: ownerId,
      sourceId,
      definitionVersion: 1,
      definitionRevisionId: revisionId,
      definition,
      presentationVersion: 2,
      presentationRevisionId: revisionId,
      presentation: {
        format: "myownnotion.database-presentation+json",
        formatVersion: 1,
        containerItemId: ownerId,
        views: definition.views.map((view) => ({ ...view, sourceId })),
      },
    };
    async function item(id: Uuid, kind: "database" | "database_view" | "page" | "folder" = "page") {
      await db.items.put(
        await codec.sealItem({
          id,
          kind,
          name: "Private title",
          icon: null,
          lifecycle: "active",
          currentRevisionId: revisionId,
          trashedAt: null,
          purgeAfter: null,
          favourite: false,
          offlineIntent: false,
          localAvailability: "present",
          pageDocument: null,
          file: null,
        }),
      );
    }
    async function membership(entryId: Uuid) {
      await item(entryId);
      await db.placements.put({
        id: generateUuidV7(),
        itemId: entryId,
        kind: "hierarchy",
        parentItemId: ownerId,
        parentKey: ownerId,
        positionKey: "a",
      });
      await repository.putEntry({
        databaseId: ownerId,
        entryItemId: entryId,
        valueVersion: 1,
        availability: "present",
        values: {
          format: "myownnotion.database-entry-values+json",
          formatVersion: 1,
          databaseId: ownerId,
          entryId,
          values: {},
          preserved: [],
        },
      });
    }
    await item(ownerId, "database");
    await repository.putDatabase(container);
    return { db, codec, repository, ownerId, sourceId, container, item, membership };
  }

  it("lists legacy containers and extra sources without inventing presentation metadata", async () => {
    const { db, codec, repository, ownerId, container } = await setup();
    await db.databases.clear();
    await db.databaseSources.clear();
    const legacy = { itemId: ownerId, definitionVersion: 1, definition: container.definition };
    await repository.putDatabase(legacy);
    const extra = { ...legacy, sourceId: generateUuidV7() };
    await db.databaseSources.put(await codec.sealDatabase(extra));
    expect(await repository.listDatabases()).toEqual([legacy, extra]);
    expect(await repository.getDatabase(extra.sourceId)).toEqual(extra);
    db.close();
  });

  it("ignores absent, trashed and non-entry items in a retained hierarchy projection", async () => {
    const { db, repository, ownerId, item } = await setup();
    for (const kind of ["missing", "trashed", "database_view"] as const) {
      const entryId = generateUuidV7();
      if (kind !== "missing") await item(entryId, kind === "trashed" ? "page" : kind);
      if (kind === "trashed") await db.items.update(entryId, { lifecycle: "trashed" });
      await db.placements.put({
        id: generateUuidV7(),
        itemId: entryId,
        kind: "hierarchy",
        parentItemId: ownerId,
        parentKey: ownerId,
        positionKey: "a",
      });
    }
    expect(await repository.listEntries(ownerId)).toEqual([]);
    expect(await repository.coverage(ownerId)).toMatchObject({
      coverage: "complete",
      expectedCount: 0,
      availableCount: 0,
    });
    db.close();
  });

  it.each(["outbox", "conflicts"] as const)(
    "keeps entries protected by a legacy plain %s during journal migration",
    async (table) => {
      const { db, repository, ownerId, membership } = await setup();
      const entryId = generateUuidV7();
      await membership(entryId);
      const mutationId = generateUuidV7();
      const base = {
        mutationId,
        commandType: "item.rename",
        payload: { itemId: entryId, name: "Unsent" },
        baseRevisionIds: [],
        localRevisionIds: [],
      };
      if (table === "outbox")
        await db.outbox.put({
          ...base,
          status: "pending",
          createdAt: "2026-10-03T12:00:00Z",
          lastAttemptAt: null,
          enqueueOrder: 1,
        });
      else
        await db.conflicts.put({
          ...base,
          capturedAt: "2026-10-03T12:00:00Z",
          errorCode: "revision.stale-base",
          competingRevisionIds: [generateUuidV7()],
        });
      expect(await repository.offloadEntryValues(entryId)).toBe(false);
      expect((await repository.getEntry(entryId))?.availability).toBe("present");
      await db.table(table).delete(mutationId);
      await db.items.update(ownerId, { offlineIntent: true });
      expect(await repository.offloadEntryValues(entryId)).toBe(false);
      await db.items.update(ownerId, { offlineIntent: false });
      expect(await repository.offloadEntryValues(entryId)).toBe(true);
      db.close();
    },
  );

  it("opens each extra source with its own definition and the owner's current views", async () => {
    const { db, codec, repository, ownerId, container } = await setup();
    const sourceId = generateUuidV7();
    const extra: LocalDatabaseRow = {
      itemId: ownerId,
      sourceId,
      definitionVersion: 3,
      definitionRevisionId: generateUuidV7(),
      definition: {
        ...container.definition,
        properties: container.definition.properties.map((p) => ({ ...p, name: "Secondary title" })),
      },
    };
    await db.databaseSources.put(await codec.sealDatabase(extra));
    expect(await repository.getDatabase(sourceId)).toEqual({
      ...extra,
      presentation: container.presentation,
      presentationRevisionId: container.presentationRevisionId,
      presentationVersion: container.presentationVersion,
    });
    expect(await repository.countOwnedSources(ownerId)).toBe(2);
    const list = await repository.listDatabases();
    expect(list).toHaveLength(2);
    expect(list.find((row) => row.sourceId === sourceId)?.definition).toEqual(extra.definition);
    expect(list.every((row) => row.presentationVersion === 2)).toBe(true);
    db.close();
  });

  it("keeps a newer primary definition while inheriting the container's current presentation", async () => {
    const { db, codec, repository, ownerId, sourceId, container } = await setup();
    if (container.presentation === undefined) throw new Error("Missing presentation fixture");
    const primary: LocalDatabaseRow = {
      ...container,
      definitionVersion: 7,
      definitionRevisionId: generateUuidV7(),
      definition: { ...container.definition, name: "Newer primary source" },
      presentationVersion: 1,
      presentationRevisionId: generateUuidV7(),
      presentation: { ...container.presentation, views: [] },
    };
    await db.databaseSources.put(await codec.sealDatabase(primary));
    const extra: LocalDatabaseRow = {
      ...primary,
      sourceId: generateUuidV7(),
      definition: { ...primary.definition, name: "Independent secondary source" },
    };
    await db.databaseSources.put(await codec.sealDatabase(extra));

    expect(await repository.listDatabases()).toEqual([
      {
        ...primary,
        presentation: container.presentation,
        presentationVersion: container.presentationVersion,
        presentationRevisionId: container.presentationRevisionId,
      },
      {
        ...extra,
        presentation: container.presentation,
        presentationVersion: container.presentationVersion,
        presentationRevisionId: container.presentationRevisionId,
      },
    ]);
    expect(primary.itemId).toBe(ownerId);
    expect(primary.sourceId).toBe(sourceId);
    db.close();
  });

  it("recovers a retained source without an available owner and distinguishes a missing source", async () => {
    const { db, repository, ownerId, sourceId, container } = await setup();
    await db.databases.delete(ownerId);
    expect(await repository.getDatabase(sourceId)).toEqual(container);
    expect(await repository.listDatabases()).toEqual([container]);
    expect(await repository.getDatabase(generateUuidV7())).toBeNull();
    db.close();
  });

  it("keeps an older source's presentation when the container has none", async () => {
    const { db, codec, repository, ownerId, sourceId, container } = await setup();
    const legacy = {
      itemId: ownerId,
      sourceId,
      definitionVersion: 1,
      definition: container.definition,
    };
    await db.databases.put(await codec.sealDatabase(legacy));
    expect(await repository.getDatabase(sourceId)).toEqual(container);
    expect(await repository.listDatabases()).toEqual([container]);
    await db.databaseSources.put(await codec.sealDatabase(legacy));
    expect(await repository.getDatabase(sourceId)).toEqual(legacy);
    expect(await repository.listDatabases()).toEqual([legacy]);
    db.close();
  });

  it.each(["database", "database_view", "page"] as const)(
    "counts legacy source ownership according to %s kind",
    async (kind) => {
      const { db, repository, ownerId, item } = await setup();
      await db.databaseSources.clear();
      await item(ownerId, kind);
      expect(await repository.countOwnedSources(ownerId)).toBe(kind === "database" ? 1 : 0);
      await db.databases.delete(ownerId);
      expect(await repository.countOwnedSources(ownerId)).toBe(0);
      db.close();
    },
  );

  it("preserves retained values when a page leaves its database and restores them on return", async () => {
    const { db, repository, ownerId, membership } = await setup();
    const entryId = generateUuidV7();
    await membership(entryId);
    const before = await repository.getEntry(entryId);
    expect(before?.valueVersion).toBe(1);
    const placement = await db.placements.where("itemId").equals(entryId).first();
    if (placement === undefined) throw new Error("Missing membership");
    await db.placements.update(placement.id, { parentItemId: null, parentKey: "root" });
    expect(await repository.getEntry(entryId)).toBeNull();
    expect(await repository.listEntries(ownerId)).toEqual([]);
    expect(await repository.classifyStructuredHost(entryId)).toBe("page");
    await db.placements.update(placement.id, { parentItemId: ownerId, parentKey: ownerId });
    expect(await repository.getEntry(entryId)).toEqual(before);
    expect(await repository.listEntries(ownerId)).toEqual([before]);
    expect(await repository.classifyStructuredHost(entryId)).toBe("entry");
    db.close();
  });

  it("gives a moved page empty values without deleting its retained memberships", async () => {
    const { db, repository, ownerId, item } = await setup();
    const entryId = generateUuidV7();
    await item(entryId);
    await db.placements.put({
      id: generateUuidV7(),
      itemId: entryId,
      kind: "hierarchy",
      parentItemId: ownerId,
      parentKey: ownerId,
      positionKey: "a",
    });
    const entry = await repository.getEntry(entryId);
    expect(entry?.valueVersion).toBe(0);
    expect(entry?.values?.values).toEqual({});
    expect(await repository.listEntries(ownerId)).toEqual([entry]);
    expect(await repository.coverage(ownerId)).toMatchObject({
      coverage: "complete",
      availableCount: 1,
    });
    expect(await repository.getEntry(generateUuidV7())).toBeNull();
    db.close();
  });

  it.each(["owner", "entry"] as const)(
    "does not open a retained entry when its %s is trashed",
    async (target) => {
      const { db, repository, ownerId, membership } = await setup();
      const entryId = generateUuidV7();
      await membership(entryId);
      await db.items.update(target === "owner" ? ownerId : entryId, { lifecycle: "trashed" });
      expect(await repository.getEntry(entryId)).toBeNull();
      db.close();
    },
  );

  it.each(["outbox", "conflicts"] as const)(
    "refuses offloading values referenced by a sealed %s",
    async (table) => {
      const { db, codec, repository, ownerId, membership } = await setup();
      const entryId = generateUuidV7();
      await membership(entryId);
      const unrelated = {
        mutationId: generateUuidV7(),
        commandType: "item.rename",
        payload: { itemId: generateUuidV7(), name: "Unrelated" },
        baseRevisionIds: [],
        localRevisionIds: [],
        status: "pending" as const,
        createdAt: "2026-10-03T12:00:00Z",
        lastAttemptAt: null,
        enqueueOrder: 1,
      };
      await db.table<SealedOutboxMutationRow>("outbox").put(await codec.sealOutbox(unrelated));
      const affected = {
        ...unrelated,
        mutationId: generateUuidV7(),
        commandType: "database.entry.values.replace",
        payload: { entryId },
      };
      if (table === "outbox")
        await db.table<SealedOutboxMutationRow>("outbox").put(await codec.sealOutbox(affected));
      else
        await db.table<SealedConflictRecordRow>("conflicts").put(
          await codec.sealConflict({
            mutationId: affected.mutationId,
            commandType: affected.commandType,
            payload: affected.payload,
            baseRevisionIds: [],
            localRevisionIds: [],
            competingRevisionIds: [],
            capturedAt: affected.createdAt,
            errorCode: "revision.stale-base",
          }),
        );
      expect(await repository.offloadEntryValues(entryId)).toBe(false);
      expect((await repository.getEntry(entryId))?.availability).toBe("present");
      await db[table].clear();
      expect(await repository.offloadEntryValues(entryId)).toBe(true);
      expect(await repository.coverage(ownerId)).toMatchObject({
        coverage: "partial",
        availableCount: 0,
      });
      expect(await repository.offloadEntryValues(entryId)).toBe(false);
      db.close();
    },
  );
});

describe("batched structured entry reads", () => {
  async function setup() {
    const name = `batched-database-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const db = openLocalDatabase(name);
    const { codec } = await createTestCodec();
    const repository = new LocalDatabaseRepository(db, codec);
    const databaseId = generateUuidV7();
    const sourceId = generateUuidV7();
    async function membership(
      entryId: Uuid,
      options: {
        kind?: "page" | "folder" | "database_view";
        lifecycle?: "active" | "trashed";
        availability?: LocalDatabaseEntryRow["availability"];
        missingItem?: boolean;
        missingValues?: boolean;
      } = {},
    ) {
      if (!options.missingItem) {
        await db.items.put(
          await codec.sealItem({
            id: entryId,
            kind: options.kind ?? "page",
            name: "Synthetic benchmark entry",
            icon: null,
            lifecycle: options.lifecycle ?? "active",
            currentRevisionId: generateUuidV7(),
            trashedAt: null,
            purgeAfter: null,
            favourite: false,
            offlineIntent: false,
            localAvailability: "present",
            pageDocument: null,
            file: null,
          }),
        );
      }
      await db.placements.add({
        id: generateUuidV7(),
        itemId: entryId,
        kind: "hierarchy",
        parentItemId: databaseId,
        parentKey: databaseId,
        positionKey: "z",
      });
      if (options.missingValues) return;
      await repository.putEntry({
        entryItemId: entryId,
        databaseId,
        sourceId,
        valueVersion: 2,
        availability: options.availability ?? "present",
        values: {
          format: "myownnotion.database-entry-values+json",
          formatVersion: 1,
          databaseId,
          entryId,
          values: {},
          preserved: [],
        },
      });
      if (options.availability !== undefined && options.availability !== "present") {
        await db.databaseEntryPairs.update(`${databaseId}:${entryId}`, { sealedValues: null });
      }
    }
    return { db, codec, repository, databaseId, sourceId, membership };
  }

  it("reads only active memberships and preserves order, source identity and missing values", async () => {
    const { db, codec, repository, databaseId, sourceId, membership } = await setup();
    const present = generateUuidV7();
    const folder = generateUuidV7();
    const offloaded = generateUuidV7();
    const neverFetched = generateUuidV7();
    const synthetic = generateUuidV7();
    const missing = generateUuidV7();
    const trashed = generateUuidV7();
    const wrongKind = generateUuidV7();
    await membership(present);
    await membership(folder, { kind: "folder" });
    await membership(offloaded, { availability: "offloaded" });
    await membership(neverFetched, { availability: "never-fetched" });
    await membership(synthetic, { missingValues: true });
    await membership(missing, { missingItem: true });
    await membership(trashed, { lifecycle: "trashed" });
    await membership(wrongKind, { kind: "database_view" });
    const foreignDatabaseId = generateUuidV7();
    await repository.putEntry({
      entryItemId: synthetic,
      databaseId: foreignDatabaseId,
      valueVersion: 9,
      availability: "present",
      values: {
        format: "myownnotion.database-entry-values+json",
        formatVersion: 1,
        databaseId: foreignDatabaseId,
        entryId: synthetic,
        values: {},
        preserved: [],
      },
    });
    // A retained projection can contain duplicate memberships; batching must
    // preserve its current row order instead of silently deduplicating it.
    await db.placements.add({
      id: generateUuidV7(),
      itemId: present,
      kind: "hierarchy",
      parentItemId: databaseId,
      parentKey: databaseId,
      positionKey: "a",
    });
    const valid = new Set([present, folder, offloaded, neverFetched, synthetic]);
    const expectedIds = (await db.placements.where("parentKey").equals(databaseId).toArray())
      .map((row) => row.itemId)
      .filter((id) => valid.has(id));
    const perEntry = vi
      .spyOn(db.databaseEntryPairs, "get")
      .mockRejectedValue(new Error("Per-entry reads are forbidden"));
    const fullScan = vi
      .spyOn(db.databaseEntryPairs, "toArray")
      .mockRejectedValue(new Error("Foreign retained values must not be scanned"));
    const lookup = vi.spyOn(db.databaseEntryPairs, "bulkGet");
    const open = vi.spyOn(codec, "openDatabaseEntry");

    const entries = await repository.listEntries(databaseId);

    expect(entries.map((entry) => entry.entryItemId)).toEqual(expectedIds);
    expect(perEntry).not.toHaveBeenCalled();
    expect(fullScan).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expectedIds.map((id) => `${databaseId}:${id}`));
    expect(open.mock.calls.map(([row]) => row.entryItemId)).toEqual(
      expectedIds.filter((id) => id !== synthetic),
    );
    expect(
      entries
        .filter((entry) => entry.entryItemId !== synthetic)
        .every((entry) => entry.sourceId === sourceId && entry.valueVersion === 2),
    ).toBe(true);
    expect(entries.find((entry) => entry.entryItemId === offloaded)?.availability).toBe(
      "offloaded",
    );
    expect(entries.find((entry) => entry.entryItemId === neverFetched)?.availability).toBe(
      "never-fetched",
    );
    expect(entries.find((entry) => entry.entryItemId === synthetic)).toEqual({
      key: `${databaseId}:${synthetic}`,
      entryItemId: synthetic,
      databaseId,
      valueVersion: 0,
      availability: "present",
      values: {
        format: "myownnotion.database-entry-values+json",
        formatVersion: 1,
        databaseId,
        entryId: synthetic,
        values: {},
        preserved: [],
      },
    });
    db.close();
  });

  it("opens at most 64 values concurrently outside the transaction while keeping row order", async () => {
    const { db, codec, repository, databaseId, membership } = await setup();
    for (let index = 0; index < 130; index += 1) await membership(generateUuidV7());
    const expectedIds = (await db.placements.where("parentKey").equals(databaseId).toArray()).map(
      (row) => row.itemId,
    );
    const original = codec.openDatabaseEntry.bind(codec);
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    vi.spyOn(codec, "openDatabaseEntry").mockImplementation(async (row) => {
      expect(Dexie.currentTransaction).toBeNull();
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      try {
        return await original(row);
      } finally {
        active -= 1;
      }
    });
    const result = repository.listEntries(databaseId);
    await vi.waitFor(() => expect(releases).toHaveLength(64));
    for (const release of releases.slice(0, 64).reverse()) release();
    await vi.waitFor(() => expect(releases).toHaveLength(128));
    for (const release of releases.slice(64, 128).reverse()) release();
    await vi.waitFor(() => expect(releases).toHaveLength(130));
    for (const release of releases.slice(128).reverse()) release();

    expect((await result).map((entry) => entry.entryItemId)).toEqual(expectedIds);
    expect(peak).toBe(64);
    expect(active).toBe(0);
    db.close();
  });

  it("rejects an unreadable value rather than publishing a partial list", async () => {
    const { db, repository, databaseId, membership } = await setup();
    const valid = generateUuidV7();
    const damaged = generateUuidV7();
    await membership(valid);
    await membership(damaged);
    const key = `${databaseId}:${damaged}`;
    const stored = await db.databaseEntryPairs.get(key);
    if (stored?.sealedValues == null) throw new Error("Missing sealed fixture");
    await db.databaseEntryPairs.update(key, {
      sealedValues: { ...stored.sealedValues, ciphertext: "invalid ciphertext" },
    });
    const before = await db.databaseEntryPairs.toArray();

    await expect(repository.listEntries(databaseId)).rejects.toThrow();

    expect(await db.databaseEntryPairs.toArray()).toEqual(before);
    db.close();
  });
});
