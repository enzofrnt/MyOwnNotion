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

  it("accepts and returns a validated version 2 editor document", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Editor page" });
    const editorBody = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Structured", marks: [{ type: "bold" }] }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Document" }] },
      ],
    };
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: page.revisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: editorBody,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect((item.json() as { pageDocument: { body: unknown } }).pageDocument.body).toEqual(
      editorBody,
    );
  });

  it("accepts version 3 wiki links and exposes their canonical relationship", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Linked editor page" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Contract target" });
    const occurrenceId = generateUuidV7();
    const editorBody = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Private linked label",
              marks: [
                {
                  type: "wikiLink",
                  attrs: { targetItemId: target.itemId, occurrenceId },
                },
              ],
            },
          ],
        },
      ],
    };
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${source.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: source.revisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: editorBody,
        },
      },
    });
    expect(response.statusCode).toBe(200);

    const listed = await harness.built.app.inject({
      method: "GET",
      url: `/v1/relationships?itemId=${source.itemId}`,
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { relationships: unknown[] }).relationships).toEqual([
      expect.objectContaining({
        id: occurrenceId,
        sourceItemId: source.itemId,
        targetItemId: target.itemId,
        relationType: "link:references",
      }),
    ]);
  });

  it("rebuilds the exact wiki-link projection when a retained revision is restored", async () => {
    const source = await createItemViaApi(harness, { kind: "page", name: "Restore link source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Restore link target" });
    const occurrenceId = generateUuidV7();
    const linked = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${source.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: source.revisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Restore link target",
                    marks: [
                      { type: "wikiLink", attrs: { targetItemId: target.itemId, occurrenceId } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(linked.statusCode).toBe(200);
    const linkedRevisionId = (linked.json() as { revisionIds: string[] }).revisionIds[0] as string;
    const unlinked = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${source.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: linkedRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: { type: "doc", content: [{ type: "paragraph" }] },
        },
      },
    });
    expect(unlinked.statusCode).toBe(200);
    const unlinkedRevisionId = (unlinked.json() as { revisionIds: string[] }).revisionIds[0];
    const restored = await harness.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${linkedRevisionId}/restore`,
      headers: idempotencyHeaders(),
      payload: { currentRevisionId: unlinkedRevisionId },
    });
    expect(restored.statusCode).toBe(200);

    const listed = await harness.built.app.inject({
      method: "GET",
      url: `/v1/relationships?itemId=${source.itemId}`,
    });
    expect((listed.json() as { relationships: unknown[] }).relationships).toEqual([
      expect.objectContaining({
        id: occurrenceId,
        sourceItemId: source.itemId,
        targetItemId: target.itemId,
      }),
    ]);
  });

  it("rejects unsupported version 2 nodes without returning private text", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Future node page" });
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: page.revisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: { type: "doc", content: [{ type: "futureWidget", text: "private-text" }] },
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe("document.unsupported-content");
    expect(response.body).not.toContain("private-text");
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
