/**
 * Page-document type discrimination tests (T051, US2).
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

const document = (text: string) => ({
  format: "myownnotion.document+json" as const,
  formatVersion: 1,
  body: { text },
});

describe("page-document replacement (T058)", () => {
  it("persists internal page links separately from hierarchy placement", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Link source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Link target" });
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${source.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: source.revisionId,
        document: document("internal reference"),
        pageLinkTargetIds: [target.itemId],
      },
    });
    expect(response.statusCode).toBe(200);
    const listing = await harness.built.app.inject({
      method: "GET",
      url: `/v1/relationships?itemId=${source.itemId}`,
    });
    const body = listing.json() as {
      relationships: Array<{ relationType: string; targetItemId: string }>;
    };
    expect(
      body.relationships.some(
        (relationship) =>
          relationship.relationType === "page:link" && relationship.targetItemId === target.itemId,
      ),
    ).toBe(true);
  });

  it("replaces a page document and returns the new revision", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Doc page" });
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: page.revisionId, document: document("hello") },
    });
    expect(response.statusCode).toBe(200);
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${page.itemId}` });
    const body = item.json() as { pageDocument: { body: { text: string } } };
    expect(body.pageDocument.body.text).toBe("hello");
  });

  it("rejects documents on folders (409 item.wrong-kind)", async () => {
    const folder = await createItemViaApi(harness, { kind: "folder", name: "Doc folder" });
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${folder.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: folder.revisionId, document: document("nope") },
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe("item.wrong-kind");
  });

  it("rejects unknown format versions without stripping (400)", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Version page" });
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: page.revisionId,
        document: { format: "myownnotion.document+json", formatVersion: 99, body: {} },
      },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe("validation.unknown-format-version");
  });

  it("rejects unknown document formats at the schema boundary (400)", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Format page" });
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: page.revisionId,
        document: { format: "text/markdown", formatVersion: 1, body: {} },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("folders and files expose a null page document; pages always expose one", async () => {
    const folder = await createItemViaApi(harness, { kind: "folder", name: "Null doc" });
    const folderItem = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${folder.itemId}`,
    });
    expect((folderItem.json() as { pageDocument: unknown }).pageDocument).toBeNull();

    const page = await createItemViaApi(harness, { kind: "page", name: "Has doc" });
    const pageItem = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
    });
    expect((pageItem.json() as { pageDocument: unknown }).pageDocument).not.toBeNull();
  });

  it("404s for a page that does not exist", async () => {
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${generateUuidV7()}/document`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: generateUuidV7(), document: document("ghost") },
    });
    expect(response.statusCode).toBe(404);
  });
});
