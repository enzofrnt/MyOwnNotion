import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

async function createDatabase() {
  const ids = {
    databaseId: generateUuidV7(),
    placementId: generateUuidV7(),
    titlePropertyId: generateUuidV7(),
    viewId: generateUuidV7(),
  };
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/databases",
    headers: idempotencyHeaders(),
    payload: {
      id: ids.databaseId,
      name: "Projets",
      placement: { id: ids.placementId, parentItemId: null, positionKey: "V" },
      titlePropertyId: ids.titlePropertyId,
      initialViewId: ids.viewId,
      initialViewName: "Table principale",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json() as {
    mutationId: Uuid;
    revisionIds: Uuid[];
    database: { databaseId: Uuid; definitionRevisionId: Uuid; definition: DatabaseDefinition };
  };
  return { ...ids, response, body };
}

function withTextAndRelation(
  input: Awaited<ReturnType<typeof createDatabase>>,
  textPropertyId: Uuid,
  relationPropertyId: Uuid,
): DatabaseDefinition {
  return {
    ...input.body.database.definition,
    properties: [
      ...input.body.database.definition.properties,
      {
        id: textPropertyId,
        name: "Note privée",
        type: "text",
        positionKey: "b",
        state: "active",
        config: {},
      },
      {
        id: relationPropertyId,
        name: "Lié à",
        type: "relation",
        positionKey: "c",
        state: "active",
        config: { cardinality: "many" },
      },
    ],
    views: input.body.database.definition.views.map((view) => ({
      ...view,
      properties: [
        ...view.properties,
        { propertyId: textPropertyId, visible: true, positionKey: "b" },
        { propertyId: relationPropertyId, visible: true, positionKey: "c" },
      ],
    })),
  };
}

describe("owner database contract (T020)", () => {
  it("creates and reads a page-backed database with its opened definition", async () => {
    const created = await createDatabase();
    expect(created.body.database).toMatchObject({
      databaseId: created.databaseId,
      definitionRevisionId: created.body.revisionIds[0],
      lifecycle: "active",
      name: "Projets",
    });
    expect(created.body.database.definition.properties).toHaveLength(1);
    expect(created.body.database.definition.properties[0]).toMatchObject({
      id: created.titlePropertyId,
      type: "title",
      state: "active",
    });

    const read = await harness.built.app.inject({
      method: "GET",
      url: `/v1/databases/${created.databaseId}`,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual(created.body.database);
  });

  it("replaces a definition and returns a deterministic destructive-impact preview", async () => {
    const created = await createDatabase();
    const textPropertyId = generateUuidV7();
    const relationPropertyId = generateUuidV7();
    const expanded = withTextAndRelation(created, textPropertyId, relationPropertyId);
    const replace = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/databases/${created.databaseId}/definition`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: created.body.database.definitionRevisionId,
        definition: expanded,
      },
    });
    expect(replace.statusCode, replace.body).toBe(200);
    const replaced = replace.json() as {
      revisionIds: Uuid[];
      database: { definitionRevisionId: Uuid; definition: DatabaseDefinition };
    };
    expect(replaced.database.definition).toEqual(expanded);

    const retired: DatabaseDefinition = {
      ...expanded,
      properties: expanded.properties.map((property) =>
        property.id === textPropertyId ? { ...property, state: "retired" as const } : property,
      ),
    };
    const first = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/definition/impact`,
      payload: { baseRevisionId: replaced.database.definitionRevisionId, definition: retired },
    });
    const second = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/definition/impact`,
      payload: { baseRevisionId: replaced.database.definitionRevisionId, definition: retired },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({
      destructive: true,
      affectedEntryCount: 0,
      affectedValueCount: 0,
      reasons: ["property-retired"],
    });
    expect((first.json() as { impactDigest: string }).impactDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates, reads and replaces one entry without changing its page identity", async () => {
    const created = await createDatabase();
    const textPropertyId = generateUuidV7();
    const relationPropertyId = generateUuidV7();
    const expanded = withTextAndRelation(created, textPropertyId, relationPropertyId);
    const definitionResponse = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/databases/${created.databaseId}/definition`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: created.body.database.definitionRevisionId,
        definition: expanded,
      },
    });
    expect(definitionResponse.statusCode, definitionResponse.body).toBe(200);
    const target = await createItemViaApi(harness, { kind: "page", name: "Target" });
    const entryId = generateUuidV7();
    const entryResponse = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/entries`,
      headers: idempotencyHeaders(),
      payload: {
        id: entryId,
        title: "Alpha",
        placement: {
          id: generateUuidV7(),
          parentItemId: created.databaseId,
          positionKey: "a",
        },
        values: { [textPropertyId]: { kind: "text", value: "First value" } },
        relationTargets: { [relationPropertyId]: [target.itemId] },
      },
    });
    expect(entryResponse.statusCode, entryResponse.body).toBe(201);
    const entry = (entryResponse.json() as { entry: Record<string, unknown> }).entry as {
      entryId: Uuid;
      revisionId: Uuid;
      values: Record<string, unknown>;
      relationTargets: Record<string, Uuid[]>;
    };
    expect(entry.entryId).toBe(entryId);
    expect(entry.values[textPropertyId]).toEqual({ kind: "text", value: "First value" });
    expect(entry.relationTargets[relationPropertyId]).toEqual([target.itemId]);

    const replace = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/databases/${created.databaseId}/entries/${entryId}/values`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: entry.revisionId,
        values: { [textPropertyId]: { kind: "text", value: "Second value" } },
        relationTargets: { [relationPropertyId]: [target.itemId] },
      },
    });
    expect(replace.statusCode, replace.body).toBe(200);
    const read = await harness.built.app.inject({
      method: "GET",
      url: `/v1/databases/${created.databaseId}/entries/${entryId}`,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      databaseId: created.databaseId,
      entryId,
      title: "Alpha",
      values: { [textPropertyId]: { kind: "text", value: "Second value" } },
    });
  });

  it("returns safe problems without reflecting private values", async () => {
    const created = await createDatabase();
    const secret = "do-not-reflect-private-database-value";
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/entries`,
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        title: "Rejected",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
        values: { [generateUuidV7()]: { kind: "text", value: secret } },
        relationTargets: {},
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.body).not.toContain(secret);
    expect(response.json()).toMatchObject({ code: "validation.invalid-payload" });
  });
});
