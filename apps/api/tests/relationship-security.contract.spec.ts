import { replaceDatabaseRelationships } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "./helpers/app.ts";

let harness: ApiHarness;
const genericRelationshipId = generateUuidV7();
beforeAll(async () => {
  harness = await createApiHarness();
  const source = await createItemViaApi(harness, { kind: "page", name: "Unrelated source" });
  const target = await createItemViaApi(harness, { kind: "page", name: "Unrelated target" });
  const created = await harness.built.app.inject({
    method: "POST",
    url: "/v1/relationships",
    headers: idempotencyHeaders(),
    payload: {
      id: genericRelationshipId,
      sourceItemId: source.itemId,
      targetItemId: target.itemId,
      relationType: "link:references",
    },
  });
  expect(created.statusCode, created.body).toBe(201);
}, 120_000);
afterAll(async () => {
  await harness?.close();
});

describe("generic relationship security (057 T007)", () => {
  it.each(["not-a-uuid", "", "null", "00000000-0000-0000-0000-00000000000z"])(
    "rejects malformed itemId %j rather than listing the entire workspace",
    async (itemId) => {
      const response = await harness.built.app.inject({
        method: "GET",
        url: `/v1/relationships?itemId=${encodeURIComponent(itemId)}`,
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({ code: "validation.invalid-identifier" });
      expect(response.json()).not.toHaveProperty("relationships");
      expect(response.body).not.toContain(genericRelationshipId);
    },
  );

  it("keeps omitted and valid but unknown itemId compatible", async () => {
    const all = await harness.built.app.inject({ method: "GET", url: "/v1/relationships" });
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json().relationships).toContainEqual(
      expect.objectContaining({ id: genericRelationshipId }),
    );
    const unknown = await harness.built.app.inject({
      method: "GET",
      url: `/v1/relationships?itemId=${generateUuidV7()}`,
    });
    expect(unknown.statusCode, unknown.body).toBe(200);
    expect(unknown.json()).toEqual({ relationships: [] });
  });

  it("rejects generic database:property creation even with forged property identities", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Security source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Security target" });
    const relationshipId = generateUuidV7();
    const headers = idempotencyHeaders();
    const metadata = { databaseId: generateUuidV7(), propertyId: generateUuidV7() };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await harness.built.app.inject({
        method: "POST",
        url: "/v1/relationships",
        headers,
        payload: {
          id: relationshipId,
          sourceItemId: source.itemId,
          targetItemId: target.itemId,
          relationType: "database:property",
          metadata,
        },
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({ code: "validation.invalid-payload" });
    }
    const batch = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: {
        mutations: [
          {
            mutationId: generateUuidV7(),
            commandType: "relationship.create",
            baseRevisionIds: [],
            payload: {
              id: relationshipId,
              sourceItemId: source.itemId,
              targetItemId: target.itemId,
              relationType: "database:property",
              metadata,
            },
          },
        ],
      },
    });
    expect(batch.statusCode, batch.body).toBe(200);
    expect(batch.json().results).toMatchObject([
      { status: "rejected", problem: { code: "validation.invalid-payload" } },
    ]);
    const listing = await harness.built.app.inject({
      method: "GET",
      url: `/v1/relationships?itemId=${source.itemId}`,
    });
    expect(listing.json()).toEqual({ relationships: [] });
  });

  it("preserves internal database rows on generic DELETE and keeps them readable", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Historical source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Historical target" });
    const databaseId = generateUuidV7();
    const propertyId = generateUuidV7();
    const created = await harness.built.context.db.transaction((tx) =>
      replaceDatabaseRelationships(tx, {
        workspaceId: harness.built.context.workspaceId,
        databaseId,
        entryId: source.itemId,
        revisionId: source.revisionId,
        relationTargets: { [propertyId]: [target.itemId] },
      }),
    );
    const relationshipId = created.createdRelationshipIds[0];
    expect(relationshipId).toBeDefined();
    const response = await harness.built.app.inject({
      method: "DELETE",
      url: `/v1/relationships/${relationshipId}`,
      headers: idempotencyHeaders(),
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation.invalid-payload" });
    const batch = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: {
        mutations: [
          {
            mutationId: generateUuidV7(),
            commandType: "relationship.remove",
            baseRevisionIds: [],
            payload: { relationshipId },
          },
        ],
      },
    });
    expect(batch.statusCode, batch.body).toBe(200);
    expect(batch.json().results).toMatchObject([
      { status: "rejected", problem: { code: "validation.invalid-payload" } },
    ]);
    for (const endpoint of [source.itemId, target.itemId]) {
      const listing = await harness.built.app.inject({
        method: "GET",
        url: `/v1/relationships?itemId=${endpoint}`,
      });
      expect(listing.statusCode, listing.body).toBe(200);
      expect(listing.json().relationships).toContainEqual(
        expect.objectContaining({
          id: relationshipId,
          relationType: "database:property",
          metadata: { databaseId, propertyId },
        }),
      );
    }
  });
});
