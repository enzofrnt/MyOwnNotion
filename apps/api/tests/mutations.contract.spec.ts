/**
 * Duplicate idempotency-key and safe-error API contract tests (T071, US4).
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

describe("idempotency keys across mutating routes (T075)", () => {
  it("every mutating route rejects a missing or malformed Idempotency-Key", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Key page" });
    const attempts: Array<{
      method: "POST" | "PATCH" | "PUT" | "DELETE";
      url: string;
      payload?: object;
    }> = [
      { method: "POST", url: "/v1/items", payload: {} },
      {
        method: "PATCH",
        url: `/v1/items/${page.itemId}`,
        payload: { baseRevisionId: page.revisionId, name: "x" },
      },
      { method: "POST", url: `/v1/items/${page.itemId}/trash` },
      { method: "POST", url: `/v1/items/${page.itemId}/restore` },
      { method: "DELETE", url: `/v1/placements/${generateUuidV7()}` },
      {
        method: "POST",
        url: `/v1/placements/${generateUuidV7()}/move`,
        payload: { parentItemId: null, positionKey: "V" },
      },
    ];
    for (const attempt of attempts) {
      const missing = await harness.built.app.inject({
        method: attempt.method,
        url: attempt.url,
        ...(attempt.payload !== undefined ? { payload: attempt.payload } : {}),
      });
      expect([400], `${attempt.method} ${attempt.url} without key`).toContain(missing.statusCode);
      const malformed = await harness.built.app.inject({
        method: attempt.method,
        url: attempt.url,
        headers: { "idempotency-key": "not-a-uuid" },
        ...(attempt.payload !== undefined ? { payload: attempt.payload } : {}),
      });
      expect([400], `${attempt.method} ${attempt.url} malformed key`).toContain(
        malformed.statusCode,
      );
    }
  });

  it("duplicate keys on trash replay the identical prior result", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Trash twice" });
    const mutationId = generateUuidV7();
    const first = await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${page.itemId}/trash`,
      headers: idempotencyHeaders(mutationId),
    });
    const second = await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${page.itemId}/trash`,
      headers: idempotencyHeaders(mutationId),
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { revisionIds: string[] }).revisionIds).toEqual(
      (first.json() as { revisionIds: string[] }).revisionIds,
    );
  });

  it("problem responses never leak private content (FR-022)", async () => {
    const secretName = "TopSecretDocumentName-98765";
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        kind: "page",
        name: secretName,
        placement: {
          kind: "hierarchy",
          parentItemId: generateUuidV7(), // unknown parent → 409
          positionKey: "V",
        },
        pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain(secretName);
    const problem = response.json() as { code: string; title: string };
    expect(problem.code).toBe("containment.parent-not-found");
  });

  it("unexpected content types are rejected safely", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { ...idempotencyHeaders(), "content-type": "text/plain" },
      payload: "raw text",
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });
});
