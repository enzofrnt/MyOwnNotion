import {
  type CanonicalExportManifest,
  generateUuidV7,
  validateCanonicalExport,
} from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "../../apps/api/tests/helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

describe("editor document export (US1)", () => {
  it("round-trips every supported v3 block and mark without HTML conversion", async () => {
    const target = await createItemViaApi(harness, { kind: "page", name: "Linked export page" });
    const page = await createItemViaApi(harness, { kind: "page", name: "Editor export" });
    const occurrenceId = generateUuidV7();
    const editorBody = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [
            { type: "text", text: "Bold", marks: [{ type: "bold" }] },
            { type: "text", text: " italic", marks: [{ type: "italic" }] },
            { type: "text", text: " strike", marks: [{ type: "strike" }] },
            { type: "text", text: " code", marks: [{ type: "code" }] },
            {
              type: "text",
              text: " linked",
              marks: [
                {
                  type: "wikiLink",
                  attrs: { targetItemId: target.itemId, occurrenceId },
                },
              ],
            },
          ],
        },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Level two" }] },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Level three" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Private paragraph" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Bullet" }] }],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 2 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Numbered" }] }],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Private task" }] }],
            },
          ],
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }],
        },
        {
          type: "codeBlock",
          attrs: { language: null },
          content: [{ type: "text", text: "const exported = true" }],
        },
        { type: "horizontalRule" },
      ],
    };
    const replaced = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: idempotencyHeaders(),
      payload: {
        baseRevisionId: page.revisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: editorBody,
        },
      },
    });
    expect(replaced.statusCode).toBe(200);

    const created = await harness.built.app.inject({
      method: "POST",
      url: "/v1/export",
      headers: idempotencyHeaders(),
    });
    const exportId = (created.json() as { exportId: string }).exportId;
    let status = "pending";
    for (let attempt = 0; attempt < 50 && status === "pending"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const poll = await harness.built.app.inject({ method: "GET", url: `/v1/export/${exportId}` });
      status = (poll.json() as { status: string }).status;
    }
    expect(status).toBe("ready");
    const artifact = await harness.built.app.inject({
      method: "GET",
      url: `/v1/export/${exportId}/artifact`,
    });
    const manifest = artifact.json() as CanonicalExportManifest;
    const exportedPage = manifest.items.find((item) => item.id === page.itemId);
    expect(exportedPage?.pageDocument).toEqual({
      format: "myownnotion.document+json",
      formatVersion: 3,
      body: editorBody,
    });
    expect(manifest.relationships).toContainEqual(
      expect.objectContaining({
        id: occurrenceId,
        sourceItemId: page.itemId,
        targetItemId: target.itemId,
        relationType: "link:references",
        metadata: { label: " linked" },
        removedRevisionId: null,
      }),
    );
    expect(validateCanonicalExport(manifest)).toEqual([]);
  });
});
