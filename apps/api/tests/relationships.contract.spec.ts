/**
 * Relationship create/list/remove API contract tests (T064, US3).
 */

import { generateUuidV7 } from "@myownnotion/domain";
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
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe("relationship contract (T067)", () => {
  it("creates a typed relationship (201) and lists it for either endpoint", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Rel source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Rel target" });
    const relationshipId = generateUuidV7();
    const created = await harness.built.app.inject({
      method: "POST",
      url: "/v1/relationships",
      headers: idempotencyHeaders(),
      payload: {
        id: relationshipId,
        sourceItemId: source.itemId,
        targetItemId: target.itemId,
        relationType: "link:references",
        metadata: { context: "test" },
      },
    });
    expect(created.statusCode).toBe(201);

    for (const endpoint of [source.itemId, target.itemId]) {
      const listing = await harness.built.app.inject({
        method: "GET",
        url: `/v1/relationships?itemId=${endpoint}`,
      });
      const body = listing.json() as { relationships: Array<{ id: string }> };
      expect(body.relationships.map((entry) => entry.id)).toContain(relationshipId);
    }
  });

  it("rejects an invalid relation-type vocabulary (400)", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Bad type source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Bad type target" });
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/relationships",
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        sourceItemId: source.itemId,
        targetItemId: target.itemId,
        relationType: "Not A Valid Type!",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects direct creation of the page:link relation reserved for documents", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Reserved source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Reserved target" });
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/relationships",
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        sourceItemId: source.itemId,
        targetItemId: target.itemId,
        relationType: "page:link",
      },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe("validation.invalid-payload");
  });

  it("exposes endpoint availability diagnostics after trash", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Diag source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Diag target" });
    const relationshipId = generateUuidV7();
    await harness.built.app.inject({
      method: "POST",
      url: "/v1/relationships",
      headers: idempotencyHeaders(),
      payload: {
        id: relationshipId,
        sourceItemId: source.itemId,
        targetItemId: target.itemId,
        relationType: "link:references",
      },
    });
    await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${target.itemId}/trash`,
      headers: idempotencyHeaders(),
    });
    const listing = await harness.built.app.inject({
      method: "GET",
      url: `/v1/relationships?itemId=${source.itemId}`,
    });
    const body = listing.json() as {
      relationships: Array<{ id: string; targetAvailability?: string }>;
    };
    const relationship = body.relationships.find((entry) => entry.id === relationshipId);
    expect(relationship?.targetAvailability).toBe("trashed");
  });

  it("removes a relationship (200) and 404s for a second removal", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Remove source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Remove target" });
    const relationshipId = generateUuidV7();
    await harness.built.app.inject({
      method: "POST",
      url: "/v1/relationships",
      headers: idempotencyHeaders(),
      payload: {
        id: relationshipId,
        sourceItemId: source.itemId,
        targetItemId: target.itemId,
        relationType: "link:references",
      },
    });
    const removal = await harness.built.app.inject({
      method: "DELETE",
      url: `/v1/relationships/${relationshipId}`,
      headers: idempotencyHeaders(),
    });
    expect(removal.statusCode).toBe(200);
    const second = await harness.built.app.inject({
      method: "DELETE",
      url: `/v1/relationships/${relationshipId}`,
      headers: idempotencyHeaders(),
    });
    expect(second.statusCode).toBe(404);
  });
});
