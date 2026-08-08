/**
 * Page-document type discrimination tests (T051, US2).
 */

import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDatabaseDocument, buildDatabaseFixture } from "../../../tests/fixtures/databases.ts";
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

  it("accepts and returns version 4 task metadata without changing identity", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Task contract page" });
    const taskId = generateUuidV7();
    const taskBody = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: {
                checked: false,
                taskId,
                status: "in_progress",
                dueDate: "2028-02-29",
                priority: "high",
              },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Private task title" }] },
              ],
            },
          ],
        },
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
          formatVersion: 4,
          body: taskBody,
        },
      },
    });
    expect(response.statusCode).toBe(200);

    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect(
      (item.json() as { pageDocument: { formatVersion: number; body: unknown } }).pageDocument,
    ).toEqual(expect.objectContaining({ formatVersion: 4, body: taskBody }));
  });

  it("accepts an initial version 4 task document during page creation", async () => {
    const itemId = generateUuidV7();
    const taskId = generateUuidV7();
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(),
      payload: {
        id: itemId,
        kind: "page",
        name: "Initial task page",
        placement: {
          id: generateUuidV7(),
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "V",
        },
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 4,
          body: {
            type: "doc",
            content: [
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: {
                      checked: false,
                      taskId,
                      status: "todo",
                      dueDate: null,
                      priority: "none",
                    },
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(
      (response.json() as { item: { pageDocument: { formatVersion: number } } }).item.pageDocument
        .formatVersion,
    ).toBe(4);
  });

  it("accepts initial and replacement version 5 database documents without changing identities", async () => {
    const itemId = generateUuidV7();
    const initialDocument = buildDatabaseDocument(buildDatabaseFixture(2));
    const created = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(),
      payload: {
        id: itemId,
        kind: "page",
        name: "Initial database page",
        placement: {
          id: generateUuidV7(),
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "W",
        },
        pageDocument: initialDocument,
      },
    });
    expect(created.statusCode).toBe(201);
    const revisionId = (created.json() as { revisionIds: string[] }).revisionIds[0];
    const database = initialDocument.body.content[0]?.attrs;
    if (database === undefined || revisionId === undefined)
      throw new Error("Database create failed");
    const replacement = {
      ...initialDocument,
      body: {
        ...initialDocument.body,
        content: [
          {
            type: "databaseBlock",
            attrs: {
              ...database,
              records: database.records.map((record, index) =>
                index === 0 ? { ...record, title: "Renamed exact record" } : record,
              ),
              view: { ...database.view, mode: "gallery" as const, query: "renamed" },
            },
          },
        ],
      },
    };
    const replaced = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${itemId}/document`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: revisionId, document: replacement },
    });
    expect(replaced.statusCode).toBe(200);
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${itemId}` });
    expect((item.json() as { pageDocument: unknown }).pageDocument).toEqual(replacement);
  });

  it("rejects malformed version 5 database values without exposing private content", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Invalid database page" });
    const document = buildDatabaseDocument(buildDatabaseFixture(1));
    const database = document.body.content[0]?.attrs;
    const property = database?.properties[0];
    const record = database?.records[0];
    if (database === undefined || property === undefined || record === undefined) {
      throw new Error("Database fixture incomplete");
    }
    const privateValue = "PrivateDatabaseValue-71925";
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: page.revisionId,
        document: {
          ...document,
          body: {
            ...document.body,
            content: [
              {
                type: "databaseBlock",
                attrs: {
                  ...database,
                  records: [
                    {
                      ...record,
                      title: privateValue,
                      values: [{ propertyId: property.propertyId, type: "number", value: 12 }],
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(privateValue);
  });

  it("restores an exact version 5 database schema, relation, and view from retained history", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Restore database page" });
    const databaseDocument = buildDatabaseDocument(buildDatabaseFixture(3));
    const saved = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: page.revisionId, document: databaseDocument },
    });
    expect(saved.statusCode).toBe(200);
    const databaseRevisionId = (saved.json() as { revisionIds: string[] }).revisionIds[0];
    if (databaseRevisionId === undefined) throw new Error("Database revision missing");
    const removed = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: databaseRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 5,
          body: { type: "doc", content: [{ type: "paragraph" }] },
        },
      },
    });
    expect(removed.statusCode).toBe(200);
    const removedRevisionId = (removed.json() as { revisionIds: string[] }).revisionIds[0];
    const restored = await harness.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${databaseRevisionId}/restore`,
      headers: idempotencyHeaders(),
      payload: { currentRevisionId: removedRevisionId },
    });
    expect(restored.statusCode).toBe(200);
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect((item.json() as { pageDocument: unknown }).pageDocument).toEqual(databaseDocument);
  });

  it("rejects malformed version 4 task metadata without exposing its title", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Invalid task page" });
    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: page.revisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 4,
          body: {
            type: "doc",
            content: [
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: {
                      checked: true,
                      taskId: generateUuidV7(),
                      status: "in_progress",
                      dueDate: "2026-08-08",
                      priority: "high",
                    },
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Never log this task" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("Never log this task");
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

  it("restores exact version 4 task identity and metadata from retained history", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Restore task page" });
    const taskId = generateUuidV7();
    const taskDocument = {
      format: "myownnotion.document+json",
      formatVersion: 4,
      body: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: {
                  checked: true,
                  taskId,
                  status: "completed",
                  dueDate: "2028-02-29",
                  priority: "high",
                },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Restore exact task" }] },
                ],
              },
            ],
          },
        ],
      },
    };
    const saved = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: page.revisionId, document: taskDocument },
    });
    expect(saved.statusCode).toBe(200);
    const taskRevisionId = (saved.json() as { revisionIds: string[] }).revisionIds[0] as string;
    const removed = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: taskRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 4,
          body: { type: "doc", content: [{ type: "paragraph" }] },
        },
      },
    });
    expect(removed.statusCode).toBe(200);
    const removedRevisionId = (removed.json() as { revisionIds: string[] }).revisionIds[0];

    const restored = await harness.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${taskRevisionId}/restore`,
      headers: idempotencyHeaders(),
      payload: { currentRevisionId: removedRevisionId },
    });
    expect(restored.statusCode).toBe(200);
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect((item.json() as { pageDocument: unknown }).pageDocument).toEqual(taskDocument);
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
