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
    const storedOutbox = await db.outbox.get(
      result.ok ? result.value.mutationId : generateUuidV7(),
    );
    expect(storedOutbox).toHaveProperty("sealedPayload");
    expect(storedOutbox).not.toHaveProperty("payload");
    expect(JSON.stringify(storedOutbox)).not.toContain("Offline projects");
    expect(JSON.stringify(storedOutbox)).not.toContain("Offline table");
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

  it("writes nothing when preparation fails before the transaction", async () => {
    vi.spyOn(codec, "sealDatabase").mockRejectedValueOnce(new Error("device locked"));

    const result = await apply("database.create", createPayload());

    expect(result).toMatchObject({ ok: false, error: { code: "storage.unavailable" } });
    expect(await db.items.count()).toBe(0);
    expect(await db.databases.count()).toBe(0);
    expect(await db.revisionHeaders.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("writes nothing when the app stops after preparation but before commit", async () => {
    let prepared = false;
    const originalSeal = codec.sealDatabase.bind(codec);
    vi.spyOn(codec, "sealDatabase").mockImplementation(async (row) => {
      const sealed = await originalSeal(row);
      prepared = true;
      return sealed;
    });
    vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("simulated stop"));

    const result = await apply("database.create", createPayload());

    expect(prepared).toBe(true);
    expect(result).toMatchObject({ ok: false, error: { code: "storage.unavailable" } });
    expect(await db.items.count()).toBe(0);
    expect(await db.placements.count()).toBe(0);
    expect(await db.databases.count()).toBe(0);
    expect(await db.revisionHeaders.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
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
    const replaceMutationId = generateUuidV7();
    const replacePayload = {
      databaseId: create.id,
      entryId,
      baseRevisionId: entryItem.currentRevisionId,
      values: { [textPropertyId]: { kind: "text", value: "Draft two" } },
      relationTargets: { [relationPropertyId]: [targetId] },
    };
    const replaced = await apply(
      "database.entry.values.replace",
      replacePayload,
      replaceMutationId,
    );
    const replacedReplay = await apply(
      "database.entry.values.replace",
      replacePayload,
      replaceMutationId,
    );
    expect(replaced.ok && replacedReplay.ok).toBe(true);
    if (replaced.ok && replacedReplay.ok) {
      expect(replacedReplay.value.localRevisionIds).toEqual(replaced.value.localRevisionIds);
    }
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

  it("trashes moved active members atomically and restores only that mutation group", async () => {
    const create = createPayload();
    expect((await apply("database.create", create)).ok).toBe(true);
    const entryIds = [generateUuidV7(), generateUuidV7()];
    for (const [index, entryId] of entryIds.entries()) {
      expect(
        (
          await apply("database.entry.create", {
            databaseId: create.id,
            id: entryId,
            title: `Moved entry ${index + 1}`,
            placement: { id: generateUuidV7(), parentItemId: null, positionKey: `m${index}` },
            values: {},
            relationTargets: {},
          })
        ).ok,
      ).toBe(true);
    }
    const independentlyTrashed = entryIds[1] as Uuid;
    expect((await apply("item.trash", { itemId: independentlyTrashed })).ok).toBe(true);

    const trashed = await apply("item.trash", { itemId: create.id });
    expect(trashed.ok && trashed.value.localRevisionIds).toHaveLength(2);
    expect((await items.getItem(create.id))?.lifecycle).toBe("trashed");
    expect((await items.getItem(entryIds[0] as Uuid))?.lifecycle).toBe("trashed");

    const restored = await apply("item.restore", { itemId: create.id });
    expect(restored.ok && restored.value.localRevisionIds).toHaveLength(2);
    expect((await items.getItem(create.id))?.lifecycle).toBe("active");
    expect((await items.getItem(entryIds[0] as Uuid))?.lifecycle).toBe("active");
    // The test clock returns the exact same instant for every action. Mutation
    // identity, not timestamp coincidence, keeps this separately trashed page
    // out of the database host's restore group.
    expect((await items.getItem(independentlyTrashed))?.lifecycle).toBe("trashed");
    expect(await databases.getEntry(independentlyTrashed)).not.toBeNull();
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

describe("database entry value validation", () => {
  it("rejects values for properties that do not exist or are title/relation", async () => {
    const create = createPayload();
    expect((await apply("database.create", create)).ok).toBe(true);
    const current = await databases.getDatabase(create.id);
    if (current === null) throw new Error("database missing");
    const entryId = generateUuidV7();

    // A property id that was never defined.
    const unknownProperty = await apply("database.entry.create", {
      databaseId: create.id,
      id: entryId,
      title: "Entry",
      placement: { id: generateUuidV7(), parentItemId: create.id, positionKey: "a" },
      values: { [generateUuidV7()]: { kind: "text", value: "x" } },
      relationTargets: {},
    });
    expect(unknownProperty.ok).toBe(false);

    // The title property cannot receive structured values.
    const titlePropertyId = current.definition.properties.find(
      (property) => property.type === "title",
    )?.id;
    if (titlePropertyId === undefined) throw new Error("no title property");
    const onTitle = await apply("database.entry.values.replace", {
      databaseId: create.id,
      entryId,
      baseRevisionId: generateUuidV7(),
      values: { [titlePropertyId]: { kind: "text", value: "x" } },
      relationTargets: {},
    });
    expect(onTitle.ok).toBe(false);
  });

  it("rejects relation targets on a non-relation property and unavailable endpoints", async () => {
    const create = createPayload();
    expect((await apply("database.create", create)).ok).toBe(true);
    const current = await databases.getDatabase(create.id);
    if (current === null) throw new Error("database missing");
    const textPropertyId = generateUuidV7();
    const relationPropertyId = generateUuidV7();
    const definition = expandedDefinition(current.definition, textPropertyId, relationPropertyId);
    expect(
      (
        await apply("database.definition.replace", {
          databaseId: create.id,
          baseRevisionId: (await items.getItem(create.id))?.currentRevisionId ?? generateUuidV7(),
          definition,
        })
      ).ok,
    ).toBe(true);

    const entryId = generateUuidV7();
    expect(
      (
        await apply("database.entry.create", {
          databaseId: create.id,
          id: entryId,
          title: "Entry",
          placement: { id: generateUuidV7(), parentItemId: create.id, positionKey: "a" },
          values: { [textPropertyId]: { kind: "text", value: "ok" } },
          relationTargets: { [relationPropertyId]: [] },
        })
      ).ok,
    ).toBe(true);

    // Relation targets on a text property are refused.
    const onText = await apply("database.entry.values.replace", {
      databaseId: create.id,
      entryId,
      baseRevisionId: (await items.getItem(entryId))?.currentRevisionId ?? generateUuidV7(),
      values: {},
      relationTargets: { [textPropertyId]: [generateUuidV7()] },
    });
    expect(onText.ok).toBe(false);

    // Relation targets pointing at a purged item are refused.
    const purgedId = generateUuidV7();
    const onPurged = await apply("database.entry.values.replace", {
      databaseId: create.id,
      entryId,
      baseRevisionId: (await items.getItem(entryId))?.currentRevisionId ?? generateUuidV7(),
      values: {},
      relationTargets: { [relationPropertyId]: [purgedId] },
    });
    expect(onPurged.ok).toBe(false);
  });
});

describe("database definition and value validation errors", () => {
  it("rejects a definition replace whose base revision is stale", async () => {
    const create = createPayload();
    expect((await apply("database.create", create)).ok).toBe(true);
    const current = await databases.getDatabase(create.id);
    if (current === null) throw new Error("database missing");
    const textPropertyId = generateUuidV7();
    const relationPropertyId = generateUuidV7();
    const definition = expandedDefinition(current.definition, textPropertyId, relationPropertyId);
    // Use a wrong base revision so the stale-base guard fires.
    const stale = await apply("database.definition.replace", {
      databaseId: create.id,
      baseRevisionId: generateUuidV7(),
      definition,
    });
    expect(stale.ok).toBe(false);
  });

  it("rejects entry values whose normalisation fails", async () => {
    const create = createPayload();
    expect((await apply("database.create", create)).ok).toBe(true);
    const current = await databases.getDatabase(create.id);
    if (current === null) throw new Error("database missing");
    const textPropertyId = generateUuidV7();
    const numberPropertyId = generateUuidV7();
    const relationPropertyId = generateUuidV7();
    const definition: typeof current.definition = {
      ...current.definition,
      properties: [
        ...current.definition.properties,
        {
          id: textPropertyId,
          name: "Text",
          type: "text",
          positionKey: "b",
          state: "active",
          config: {},
        },
        {
          id: numberPropertyId,
          name: "Number",
          type: "number",
          positionKey: "c",
          state: "active",
          config: {},
        },
        {
          id: relationPropertyId,
          name: "Rel",
          type: "relation",
          positionKey: "d",
          state: "active",
          config: { cardinality: "many" },
        },
      ],
      views: current.definition.views.map((view) => ({
        ...view,
        properties: [
          ...view.properties,
          { propertyId: textPropertyId, visible: true, positionKey: "b" },
          { propertyId: numberPropertyId, visible: true, positionKey: "c" },
          { propertyId: relationPropertyId, visible: true, positionKey: "d" },
        ],
      })),
    };
    expect(
      (
        await apply("database.definition.replace", {
          databaseId: create.id,
          baseRevisionId: (await items.getItem(create.id))?.currentRevisionId ?? generateUuidV7(),
          definition,
        })
      ).ok,
    ).toBe(true);

    const entryId = generateUuidV7();
    // Create the entry first.
    expect(
      (
        await apply("database.entry.create", {
          databaseId: create.id,
          id: entryId,
          title: "Entry",
          placement: { id: generateUuidV7(), parentItemId: create.id, positionKey: "a" },
          values: {},
          relationTargets: {},
        })
      ).ok,
    ).toBe(true);

    // An invalid decimal string fails normalisation.
    const badDecimal = await apply("database.entry.values.replace", {
      databaseId: create.id,
      entryId,
      baseRevisionId: (await items.getItem(entryId))?.currentRevisionId ?? generateUuidV7(),
      values: { [numberPropertyId]: { kind: "number", value: "not-a-number" } },
      relationTargets: {},
    });
    expect(badDecimal.ok).toBe(false);

    // An absent optional value triggers the "absent" error path.
    const absentValue = await apply("database.entry.values.replace", {
      databaseId: create.id,
      entryId,
      baseRevisionId: (await items.getItem(entryId))?.currentRevisionId ?? generateUuidV7(),
      values: { [textPropertyId]: { kind: "text", value: "" } },
      relationTargets: {},
    });
    expect(absentValue.ok).toBe(true);
  });
});
