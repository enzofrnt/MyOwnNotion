import {
  applyLocalMutation,
  type LocalDatabase,
  LocalDatabaseRepository,
  type LocalRecordCodec,
  openLocalDatabase,
} from "@myownnotion/client-core";
import {
  type DatabaseDefinition,
  generateUuidV7,
  ownedSourceIdFromItemId,
  type Uuid,
} from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let databases: LocalDatabaseRepository;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`relation-pair-${generateUuidV7()}`);
  databases = new LocalDatabaseRepository(db, codec);
});

afterEach(async () => {
  await db.delete();
});

async function apply(commandType: string, payload: Record<string, unknown>) {
  return applyLocalMutation(
    db,
    { mutationId: generateUuidV7(), commandType, payload, baseRevisionIds: [] },
    () => new Date("2026-11-12T10:00:00.000Z"),
    codec,
  );
}

async function database(name: string): Promise<{
  readonly id: Uuid;
  readonly sourceId: Uuid;
  readonly revisionId: Uuid;
  readonly definition: DatabaseDefinition;
}> {
  const id = generateUuidV7();
  await apply("database.create", {
    id,
    name,
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Table",
  });
  const row = await databases.getDatabase(id);
  if (row === null) throw new Error("fixture");
  return {
    id,
    sourceId: row.sourceId ?? ownedSourceIdFromItemId(id),
    revisionId: row.definitionRevisionId as Uuid,
    definition: row.definition,
  };
}

describe("two-way relation pair offline", () => {
  it("writes both definitions and removes only the inverse", async () => {
    const a = await database("Offline A");
    const b = await database("Offline B");
    const relationId = generateUuidV7();
    const withRelation: DatabaseDefinition = {
      ...a.definition,
      properties: [
        ...a.definition.properties,
        {
          id: relationId,
          name: "Related",
          type: "relation",
          positionKey: "b",
          state: "active",
          config: { cardinality: "many", targetSourceId: b.sourceId },
        },
      ],
    };
    await apply("database.definition.replace", {
      databaseId: a.id,
      baseRevisionId: a.revisionId,
      definition: withRelation,
    });
    const afterReplace = await databases.getDatabase(a.id);
    const bBefore = await databases.getDatabase(b.id);
    if (afterReplace?.definitionRevisionId == null || bBefore?.definitionRevisionId == null)
      throw new Error("fixture");
    const inverseId = generateUuidV7();
    await apply("database.relation.pair.create", {
      databaseId: a.sourceId,
      relationPropertyId: relationId,
      inversePropertyId: inverseId,
      inverseName: "Projects linked",
      baseRevisionId: afterReplace.definitionRevisionId,
      inverseBaseRevisionId: bBefore.definitionRevisionId,
    });
    const bAfter = await databases.getDatabase(b.id);
    expect(
      bAfter?.definition.properties.find((property) => property.id === inverseId),
    ).toMatchObject({
      type: "relation",
      name: "Projects linked",
      config: {
        cardinality: "many",
        targetSourceId: a.sourceId,
        reciprocalPropertyId: relationId,
      },
    });
    // The canonical definition carries the column in its views. Displaying it
    // also needs the presentation update, which is not written yet.
    expect(
      bAfter?.definition.views.some((view) =>
        view.properties.some((column) => column.propertyId === inverseId),
      ),
    ).toBe(true);

    const aNow = await databases.getDatabase(a.id);
    expect(
      aNow?.definition.properties.find((property) => property.id === relationId),
    ).toMatchObject({ config: { reciprocalPropertyId: inverseId } });

    await apply("database.relation.pair.remove", {
      databaseId: a.sourceId,
      relationPropertyId: relationId,
      baseRevisionId: (await databases.getDatabase(a.id))?.definitionRevisionId as Uuid,
      inverseBaseRevisionId: (await databases.getDatabase(b.id))?.definitionRevisionId as Uuid,
    });
    const bRemoved = await databases.getDatabase(b.id);
    expect(
      bRemoved?.definition.properties.find((property) => property.id === inverseId)?.state,
    ).toBe("retired");
    expect(
      (await databases.getDatabase(a.id))?.definition.properties.find(
        (property) => property.id === relationId,
      ),
    ).toMatchObject({ type: "relation" });
  });

  it("refuses to delete a property that still belongs to a pair", async () => {
    const a = await database("Offline C");
    const b = await database("Offline D");
    const relationId = generateUuidV7();
    await apply("database.definition.replace", {
      databaseId: a.id,
      baseRevisionId: a.revisionId,
      definition: {
        ...a.definition,
        properties: [
          ...a.definition.properties,
          {
            id: relationId,
            name: "Related",
            type: "relation",
            positionKey: "b",
            state: "active",
            config: { cardinality: "many", targetSourceId: b.sourceId },
          },
        ],
      },
    });
    const aNow = await databases.getDatabase(a.id);
    const bNow = await databases.getDatabase(b.id);
    if (aNow?.definitionRevisionId == null || bNow?.definitionRevisionId == null)
      throw new Error("fixture");
    await apply("database.relation.pair.create", {
      databaseId: a.sourceId,
      relationPropertyId: relationId,
      inversePropertyId: generateUuidV7(),
      inverseName: "Inverse",
      baseRevisionId: aNow.definitionRevisionId,
      inverseBaseRevisionId: bNow.definitionRevisionId,
    });
    const current = await databases.getDatabase(a.id);
    if (current?.definitionRevisionId == null) throw new Error("fixture");
    const refused = await apply("database.definition.replace", {
      databaseId: a.id,
      baseRevisionId: current.definitionRevisionId,
      definition: {
        ...current.definition,
        properties: current.definition.properties.filter((property) => property.id !== relationId),
      },
    });
    expect(JSON.stringify(refused)).toContain("database.relation.pair-active");
  });
});
