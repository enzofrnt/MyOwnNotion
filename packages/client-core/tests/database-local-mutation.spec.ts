import {
  applyLocalMutation,
  type LocalDatabase,
  LocalDatabaseRepository,
  type LocalRecordCodec,
  LocalRepository,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let databases: LocalDatabaseRepository;
let items: LocalRepository;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`database-local-${generateUuidV7()}`);
  databases = new LocalDatabaseRepository(db, codec);
  items = new LocalRepository(db, codec);
});

afterEach(async () => {
  await db.delete();
});

async function apply(
  commandType: string,
  payload: Record<string, unknown>,
  mutationId = generateUuidV7(),
) {
  return await applyLocalMutation(
    db,
    { mutationId, commandType, payload, baseRevisionIds: [] },
    () => new Date("2026-08-20T10:00:00.000Z"),
    codec,
  );
}

function createPayload() {
  return {
    id: generateUuidV7(),
    name: "Offline projects",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Offline table",
  };
}

function expandedDefinition(
  current: DatabaseDefinition,
  textPropertyId: Uuid,
  relationPropertyId: Uuid,
): DatabaseDefinition {
  return {
    ...current,
    properties: [
      ...current.properties,
      {
        id: textPropertyId,
        name: "Private note",
        type: "text",
        positionKey: "b",
        state: "active",
        config: {},
      },
      {
        id: relationPropertyId,
        name: "Related",
        type: "relation",
        positionKey: "c",
        state: "active",
        config: { cardinality: "many" },
      },
    ],
    views: current.views.map((view) => ({
      ...view,
      properties: [
        ...view.properties,
        { propertyId: textPropertyId, visible: true, positionKey: "b" },
        { propertyId: relationPropertyId, visible: true, positionKey: "c" },
      ],
    })),
  };
}

describe("atomic structured local mutation (T021)", () => {
  it("creates a page, sealed database definition, revision and outbox atomically", async () => {
    const payload = createPayload();
    const result = await apply("database.create", payload);
    expect(result.ok).toBe(true);
    expect((await items.getItem(payload.id))?.kind).toBe("page");
    const database = await databases.getDatabase(payload.id);
    expect(database).toMatchObject({ itemId: payload.id, definitionVersion: 1 });
    expect(database?.definition.databaseId).toBe(payload.id);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.revisionHeaders.count()).toBe(1);

    const stored = await db.databases.get(payload.id);
    expect(stored).toHaveProperty("sealedDefinition");
    expect(stored).not.toHaveProperty("definition");
    expect(JSON.stringify(stored)).not.toContain("Offline table");
  });

  it("seals crypto preparation before opening the Dexie write transaction", async () => {
    const observed: Array<unknown> = [];
    const original = codec.sealDatabase.bind(codec);
    vi.spyOn(codec, "sealDatabase").mockImplementation(async (row) => {
      observed.push(Dexie.currentTransaction);
      return await original(row);
    });
    expect((await apply("database.create", createPayload())).ok).toBe(true);
    expect(observed).toEqual([null]);
  });

  it("replaces definition, creates an entry and replaces values with stable identities", async () => {
    const create = createPayload();
    expect((await apply("database.create", create)).ok).toBe(true);
    const currentDatabase = await databases.getDatabase(create.id);
    const databaseItem = await items.getItem(create.id);
    if (currentDatabase === null || databaseItem === null) throw new Error("database missing");
    const textPropertyId = generateUuidV7();
    const relationPropertyId = generateUuidV7();
    const definition = expandedDefinition(
      currentDatabase.definition,
      textPropertyId,
      relationPropertyId,
    );
    expect(
      (
        await apply("database.definition.replace", {
          databaseId: create.id,
          baseRevisionId: databaseItem.currentRevisionId,
          definition,
        })
      ).ok,
    ).toBe(true);

    const targetId = generateUuidV7();
    await apply("item.create", {
      id: targetId,
      kind: "page",
      name: "Target",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "z" },
    });
    const entryId = generateUuidV7();
    const entryMutationId = generateUuidV7();
    const entryPayload = {
      databaseId: create.id,
      id: entryId,
      title: "Offline entry",
      placement: { id: generateUuidV7(), parentItemId: create.id, positionKey: "a" },
      values: { [textPropertyId]: { kind: "text", value: "Draft one" } },
      relationTargets: { [relationPropertyId]: [targetId] },
    };
    const first = await apply("database.entry.create", entryPayload, entryMutationId);
    const replay = await apply("database.entry.create", entryPayload, entryMutationId);
    expect(first.ok && replay.ok).toBe(true);
    if (first.ok && replay.ok) {
      expect(replay.value.localRevisionIds).toEqual(first.value.localRevisionIds);
    }
    expect(await db.databaseEntries.count()).toBe(1);
    expect(await db.items.where("id").equals(entryId).count()).toBe(1);
    expect(await db.outbox.where("mutationId").equals(entryMutationId).count()).toBe(1);

    const createdEntry = await databases.getEntry(entryId);
    expect(createdEntry?.values.values[textPropertyId]).toEqual({
      kind: "text",
      value: "Draft one",
    });
    const entryItem = await items.getItem(entryId);
    if (entryItem === null) throw new Error("entry item missing");
    const replaced = await apply("database.entry.values.replace", {
      databaseId: create.id,
      entryId,
      baseRevisionId: entryItem.currentRevisionId,
      values: { [textPropertyId]: { kind: "text", value: "Draft two" } },
      relationTargets: { [relationPropertyId]: [targetId] },
    });
    expect(replaced.ok).toBe(true);
    expect(await databases.getEntry(entryId)).toMatchObject({ valueVersion: 2 });
    expect((await databases.getEntry(entryId))?.values.values[textPropertyId]).toEqual({
      kind: "text",
      value: "Draft two",
    });
    const relations = await db.relationships.where("sourceItemId").equals(entryId).toArray();
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      targetItemId: targetId,
      relationType: "database:property",
      metadata: { databaseId: create.id, propertyId: relationPropertyId },
    });
  });

  it("rolls every projection store back when outbox persistence fails", async () => {
    const original = db.outbox.add.bind(db.outbox);
    const quota = new Error("quota");
    quota.name = "QuotaExceededError";
    (db.outbox as { add: unknown }).add = () => Promise.reject(quota);
    const result = await apply("database.create", createPayload());
    (db.outbox as { add: unknown }).add = original;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("storage.quota-exceeded");
    expect(await db.items.count()).toBe(0);
    expect(await db.placements.count()).toBe(0);
    expect(await db.databases.count()).toBe(0);
    expect(await db.revisionHeaders.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
