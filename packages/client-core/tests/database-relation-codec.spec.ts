import {
  applyLocalMutation,
  type LocalDatabase,
  LocalDatabaseRepository,
  type LocalRecordCodec,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let databases: LocalDatabaseRepository;
let databaseName: string;
beforeEach(async () => {
  ({ codec } = await createTestCodec());
  databaseName = `relation-codec-${generateUuidV7()}`;
  db = openLocalDatabase(databaseName);
  databases = new LocalDatabaseRepository(db, codec);
});
afterEach(async () => {
  await db.delete();
});
async function apply(commandType: string, payload: Record<string, unknown>) {
  const result = await applyLocalMutation(
    db,
    {
      mutationId: generateUuidV7(),
      commandType,
      payload,
      baseRevisionIds: [],
    },
    () => new Date("2026-11-11T12:00:00Z"),
    codec,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
}
async function owner() {
  const id = generateUuidV7();
  await apply("database.create", {
    id,
    name: "Encrypted relation fixture",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Table",
  });
  const row = await databases.getDatabase(id);
  if (!row?.sourceId) throw new Error("Missing source fixture");
  return { ...row, sourceId: row.sourceId };
}
async function define(databaseId: Uuid, definition: DatabaseDefinition) {
  const row = await databases.getDatabase(databaseId);
  if (!row) throw new Error("Missing fixture");
  await apply("database.definition.replace", {
    databaseId,
    baseRevisionId: row.definitionRevisionId,
    definition,
  });
}

describe("057 encrypted local relation persistence", () => {
  it("roundtrips configured and historical definitions plus existing out-of-source links through real mutation, IndexedDB and repository consumers", async () => {
    const origin = await owner();
    const target = await owner();
    const configuredId = generateUuidV7();
    const legacyId = generateUuidV7();
    const definition: DatabaseDefinition = {
      ...origin.definition,
      properties: [
        ...origin.definition.properties,
        ...[configuredId, legacyId].map((id, index) => ({
          id,
          name: index === 0 ? "Private configured relation" : "Private historical relation",
          type: "relation" as const,
          state: "active" as const,
          positionKey: index === 0 ? "b" : "c",
          config: { cardinality: "many" as const },
        })),
      ],
    };
    await define(origin.itemId, definition);
    const memberId = generateUuidV7();
    await apply("database.entry.create", {
      databaseId: target.itemId,
      id: memberId,
      title: "Member",
      values: {},
      relationTargets: {},
    });
    const outsideId = generateUuidV7();
    await apply("item.create", {
      id: outsideId,
      kind: "page",
      name: "Historical outside page",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "z" },
    });
    const entryId = generateUuidV7();
    await apply("database.entry.create", {
      databaseId: origin.itemId,
      id: entryId,
      title: "Origin entry",
      values: {},
      relationTargets: { [configuredId]: [memberId, outsideId], [legacyId]: [outsideId] },
    });
    await define(origin.itemId, {
      ...definition,
      properties: definition.properties.map((property) =>
        property.id === configuredId && property.type === "relation"
          ? { ...property, config: { ...property.config, targetSourceId: target.sourceId } }
          : property,
      ),
    });
    const before = await databases.getDatabase(origin.itemId);
    const links = (await db.relationships.toArray()).filter(
      (link) => link.sourceItemId === entryId,
    );
    expect(links).toHaveLength(3);
    const raw = JSON.stringify({
      databases: await db.databases.toArray(),
      sources: await db.databaseSources.toArray(),
    });
    expect(raw).not.toContain("Private configured relation");
    expect(raw).not.toContain("Private historical relation");
    expect(raw).not.toContain("targetSourceId");
    expect(raw).not.toContain(configuredId);

    // Re-open the stored database, not an in-memory clone of a fixture. Both
    // source routing and relation metadata must survive the codec boundary.
    db.close();
    db = openLocalDatabase(databaseName);
    databases = new LocalDatabaseRepository(db, codec);
    expect(await databases.getDatabase(origin.itemId)).toEqual(before);
    expect(await databases.getDatabase(origin.sourceId)).toEqual(before);
    const opened = await databases.getDatabase(origin.itemId);
    expect(
      opened?.definition.properties.find((property) => property.id === configuredId),
    ).toMatchObject({
      id: configuredId,
      config: { cardinality: "many", targetSourceId: target.sourceId },
    });
    expect(
      opened?.definition.properties.find((property) => property.id === legacyId)?.config,
    ).toEqual({ cardinality: "many" });
    const targets = await databases.getRelationTargets(origin.itemId, entryId);
    expect(targets[configuredId]).toEqual(expect.arrayContaining([memberId, outsideId]));
    expect(targets[configuredId]).toHaveLength(2);
    expect(targets[legacyId]).toEqual([outsideId]);
    const storedLinks = (await db.relationships.toArray()).filter(
      (link) => link.sourceItemId === entryId,
    );
    expect(storedLinks).toEqual(links);
    expect(storedLinks.map((link) => link.metadata["propertyId"])).toEqual(
      expect.arrayContaining([configuredId, legacyId]),
    );
  });
});
