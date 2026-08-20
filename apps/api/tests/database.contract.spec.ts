import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseProjectionUnavailableError } from "../src/databases/database-query-service.ts";
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
      titlePropertyName: "Titre",
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
      name: "Titre",
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

  it("announces the active database entry count before trash confirmation", async () => {
    const created = await createDatabase();
    for (let index = 0; index < 2; index += 1) {
      const response = await harness.built.app.inject({
        method: "POST",
        url: `/v1/databases/${created.databaseId}/entries`,
        headers: idempotencyHeaders(),
        payload: {
          id: generateUuidV7(),
          title: `Entry ${index + 1}`,
          placement: {
            id: generateUuidV7(),
            parentItemId: null,
            positionKey: `m${index}`,
          },
          values: {},
          relationTargets: {},
        },
      });
      expect(response.statusCode, response.body).toBe(201);
    }

    const impact = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${created.databaseId}/trash-impact`,
    });
    expect(impact.statusCode, impact.body).toBe(200);
    expect(impact.json()).toEqual({ isDatabase: true, activeEntryCount: 2 });
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

  it("queries stable pages without duplicates and rejects a cursor after a commit", async () => {
    const created = await createDatabase();
    const entryIds = [generateUuidV7(), generateUuidV7(), generateUuidV7()];
    for (const [index, entryId] of entryIds.entries()) {
      const response = await harness.built.app.inject({
        method: "POST",
        url: `/v1/databases/${created.databaseId}/entries`,
        headers: idempotencyHeaders(),
        payload: {
          id: entryId,
          title: ["Alpha", "Beta", "Gamma"][index],
          placement: {
            id: generateUuidV7(),
            parentItemId: created.databaseId,
            positionKey: String.fromCharCode(97 + index),
          },
          values: {},
          relationTargets: {},
        },
      });
      expect(response.statusCode, response.body).toBe(201);
    }

    const first = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/query`,
      payload: { viewId: created.viewId, limit: 1 },
    });
    expect(first.statusCode, first.body).toBe(200);
    const firstPage = first.json() as {
      generation: number;
      rows: Array<{ entryId: Uuid }>;
      nextCursor: string | null;
    };
    expect(firstPage.rows).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const cursor = firstPage.nextCursor;
    if (cursor === null) throw new Error("expected a second page");
    expect(cursor).not.toContain(firstPage.rows[0]?.entryId ?? "missing");

    const second = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/query`,
      payload: { viewId: created.viewId, limit: 1, cursor },
    });
    expect(second.statusCode, second.body).toBe(200);
    const secondPage = second.json() as { rows: Array<{ entryId: Uuid }> };
    expect(secondPage.rows).toHaveLength(1);
    expect(secondPage.rows[0]?.entryId).not.toBe(firstPage.rows[0]?.entryId);

    const added = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/entries`,
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        title: "Delta",
        placement: {
          id: generateUuidV7(),
          parentItemId: created.databaseId,
          positionKey: "d",
        },
        values: {},
        relationTargets: {},
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    const stale = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/query`,
      payload: { viewId: created.viewId, limit: 1, cursor },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({ code: "database.cursor-stale" });
    expect(stale.body).not.toContain(cursor);
  });

  it("reports a redacted degraded projection without claiming partial completeness", async () => {
    const created = await createDatabase();
    const descriptor = Object.getOwnPropertyDescriptor(harness.built.context, "structuredQueries");
    Object.defineProperty(harness.built.context, "structuredQueries", {
      configurable: true,
      value: {
        query() {
          throw new DatabaseProjectionUnavailableError("degraded", 2, 7);
        },
      },
    });
    try {
      const response = await harness.built.app.inject({
        method: "POST",
        url: `/v1/databases/${created.databaseId}/query`,
        payload: { viewId: created.viewId },
      });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.json()).toMatchObject({
        code: "database.projection-degraded",
        projectionState: "degraded",
        indexedCount: 2,
        expectedCount: 7,
      });
      expect(response.body).not.toContain("rows");
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(harness.built.context, "structuredQueries", descriptor);
      }
    }
  });

  it("does not echo a private malformed cursor from a structured query", async () => {
    const created = await createDatabase();
    const privateCursor = "PrivateFilterSentinel-90210";
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${created.databaseId}/query`,
      payload: { viewId: created.viewId, cursor: privateCursor },
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({
      code: "database.invalid-cursor",
      title: "Database query cannot be executed",
    });
    expect(response.body).not.toContain(privateCursor);
  });
});
