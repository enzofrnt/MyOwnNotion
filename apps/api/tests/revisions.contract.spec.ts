/**
 * Revision fetch, restore, expired snapshot, and comparison API contract
 * tests (T079, US5).
 */

import { schema } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
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

async function editPage(itemId: Uuid, baseRevisionId: Uuid, text: string): Promise<Uuid> {
  const response = await harness.built.app.inject({
    method: "PUT",
    url: `/v1/pages/${itemId}/document`,
    headers: idempotencyHeaders(),
    payload: {
      baseRevisionId,
      document: { format: "myownnotion.document+json", formatVersion: 1, body: { text } },
    },
  });
  expect(response.statusCode).toBe(200);
  return ((response.json() as { revisionIds: string[] }).revisionIds[0] ?? "") as Uuid;
}

describe("revision retrieval", () => {
  it("returns the header with retained snapshot", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Rev page" });
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/revisions/${page.revisionId}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      id: string;
      itemId: string;
      parentRevisionIds: string[];
      snapshotRetained: boolean;
      snapshot: Record<string, unknown>;
    };
    expect(body.id).toBe(page.revisionId);
    expect(body.itemId).toBe(page.itemId);
    expect(body.parentRevisionIds).toEqual([]);
    expect(body.snapshot).not.toBeNull();
  });

  it("410s when the snapshot has been pruned but the header survives", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Pruned page" });
    await editPage(page.itemId, page.revisionId, "supersede");
    await harness.built.context.db
      .update(schema.revisions)
      .set({ snapshot: null })
      .where(eq(schema.revisions.id, page.revisionId));

    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/revisions/${page.revisionId}`,
    });
    expect(response.statusCode).toBe(410);
    expect((response.json() as { code: string }).code).toBe("revision.snapshot-expired");
  });

  it("404s for unknown revisions", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/revisions/${generateUuidV7()}`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("revision comparison", () => {
  it("classifies sequential and concurrent revisions", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Compare page" });
    const v2 = await editPage(page.itemId, page.revisionId, "v2");

    const sequential = await harness.built.app.inject({
      method: "POST",
      url: "/v1/revisions/compare",
      payload: { leftRevisionId: page.revisionId, rightRevisionId: v2 },
    });
    expect((sequential.json() as { classification: string }).classification).toBe("left-ancestor");

    const identical = await harness.built.app.inject({
      method: "POST",
      url: "/v1/revisions/compare",
      payload: { leftRevisionId: v2, rightRevisionId: v2 },
    });
    expect((identical.json() as { classification: string }).classification).toBe("identical");

    // Distinct items' creation revisions share no ancestry → concurrent.
    const other = await createItemViaApi(harness, { kind: "page", name: "Other page" });
    const concurrent = await harness.built.app.inject({
      method: "POST",
      url: "/v1/revisions/compare",
      payload: { leftRevisionId: v2, rightRevisionId: other.revisionId },
    });
    expect((concurrent.json() as { classification: string }).classification).toBe("concurrent");
  });
});

describe("revision restoration", () => {
  it("restores retained content as a new descendant (200)", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Restore page" });
    const v2 = await editPage(page.itemId, page.revisionId, "v2");

    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${page.revisionId}/restore`,
      headers: idempotencyHeaders(),
      payload: { currentRevisionId: v2 },
    });
    expect(response.statusCode).toBe(200);
    const restored = (response.json() as { revisionIds: string[] }).revisionIds[0] as string;

    const header = await harness.built.app.inject({
      method: "GET",
      url: `/v1/revisions/${restored}`,
    });
    expect((header.json() as { parentRevisionIds: string[] }).parentRevisionIds).toEqual([v2]);
  });

  it("409s with competing revisions when the head is stale", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Stale head page" });
    const v2 = await editPage(page.itemId, page.revisionId, "v2");
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${page.revisionId}/restore`,
      headers: idempotencyHeaders(),
      payload: { currentRevisionId: page.revisionId },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json() as { code: string; competingRevisionIds: string[] };
    expect(body.code).toBe("mutation.conflict");
    expect(body.competingRevisionIds).toEqual([v2]);
  });

  it("410s when restoring an expired snapshot", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Expired source" });
    const v2 = await editPage(page.itemId, page.revisionId, "v2");
    await harness.built.context.db
      .update(schema.revisions)
      .set({ snapshot: null })
      .where(eq(schema.revisions.id, page.revisionId));
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${page.revisionId}/restore`,
      headers: idempotencyHeaders(),
      payload: { currentRevisionId: v2 },
    });
    expect(response.statusCode).toBe(410);
    expect((response.json() as { code: string }).code).toBe("revision.snapshot-expired");
  });
});
