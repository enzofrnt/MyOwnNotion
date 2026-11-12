import { readCurrentDatabaseDefinition, readDatabaseRecord } from "@myownnotion/database";
import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness, idempotencyHeaders } from "./helpers/app.ts";

let harness: ApiHarness;
beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);
afterAll(async () => {
  await harness?.close();
});

async function mutate(commandType: string, payload: Record<string, unknown>) {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/mutations/batch",
    headers: idempotencyHeaders(),
    payload: {
      mutations: [{ mutationId: generateUuidV7(), commandType, baseRevisionIds: [], payload }],
    },
  });
  return response;
}

async function database(name: string): Promise<Uuid> {
  const id = generateUuidV7();
  const response = await mutate("database.create", {
    id,
    name,
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Table",
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().results[0].status).toBe("accepted");
  return id;
}

describe("two-way relation commands over HTTP", () => {
  it("creates and removes a pair through the mutation route", async () => {
    const origin = await database("HTTP pair origin");
    const target = await database("HTTP pair target");
    const originRecord = await readDatabaseRecord(harness.built.database.db, origin);
    const targetRecord = await readDatabaseRecord(harness.built.database.db, target);
    const originDefinition = await readCurrentDatabaseDefinition(harness.built.database.db, origin);
    if (originRecord === null || targetRecord === null || originDefinition === null)
      throw new Error("fixture");
    const relationId = generateUuidV7();
    const withRelation: DatabaseDefinition = {
      ...originDefinition,
      properties: [
        ...originDefinition.properties,
        {
          id: relationId,
          name: "Related",
          type: "relation",
          positionKey: "b",
          state: "active",
          config: { cardinality: "many", targetSourceId: targetRecord.sourceId },
        },
      ],
    };
    const replaced = await mutate("database.definition.replace", {
      databaseId: origin,
      baseRevisionId: originRecord.definitionRevisionId,
      definition: withRelation,
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.json().results[0].status, replaced.body).toBe("accepted");
    const freshOrigin = await readDatabaseRecord(harness.built.database.db, origin);
    const freshTarget = await readDatabaseRecord(harness.built.database.db, target);
    if (freshOrigin?.definitionRevisionId == null || freshTarget?.definitionRevisionId == null)
      throw new Error("revisions");
    const inverseId = generateUuidV7();
    const created = await mutate("database.relation.pair.create", {
      databaseId: originRecord.sourceId,
      relationPropertyId: relationId,
      inversePropertyId: inverseId,
      inverseName: "Projets liés",
      baseRevisionId: freshOrigin.definitionRevisionId,
      inverseBaseRevisionId: freshTarget.definitionRevisionId,
    });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().results[0].status, created.body).toBe("accepted");
    const targetDefinition = await readCurrentDatabaseDefinition(harness.built.database.db, target);
    expect(
      targetDefinition?.properties.find((property) => property.id === inverseId),
    ).toMatchObject({
      config: { reciprocalPropertyId: relationId },
    });
  });
});
