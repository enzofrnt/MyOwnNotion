import { canonicalDocumentJsonV3, generateUuidV7, type JsonObject } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { OperationalPageDocument } from "../src/index.ts";

describe("canonical operational projection", () => {
  it("round-trips rich v3 structure, unknown data and derived references", async () => {
    const pageId = generateUuidV7();
    const targetItemId = generateUuidV7();
    const fileItemId = generateUuidV7();
    const unknownId = generateUuidV7();
    const unknownRaw: JsonObject = {
      type: "futureDiagram",
      id: unknownId,
      payload: { nodes: [1, 2, 3] },
    };
    const document = {
      blocks: [
        {
          type: "paragraph" as const,
          id: generateUuidV7(),
          content: [
            {
              text: "Destination",
              marks: [{ type: "pageLink" as const, targetItemId }],
            },
          ],
          rawExtraProperties: { futureLayout: { span: 2 } },
        },
        {
          type: "table" as const,
          id: generateUuidV7(),
          columns: [{ id: generateUuidV7(), width: 240 }],
          rows: [
            {
              id: generateUuidV7(),
              cells: [
                {
                  id: generateUuidV7(),
                  content: [{ text: "Cellule" }],
                  children: [
                    {
                      type: "image" as const,
                      id: generateUuidV7(),
                      fileItemId,
                      caption: "Image",
                      altText: null,
                      displayWidth: null,
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "unknown" as const,
          id: unknownId,
          declaredType: "futureDiagram",
          raw: unknownRaw,
          syntheticId: false,
        },
      ],
    };
    const page = OperationalPageDocument.create({ pageId, document });
    const projection = await page.project();

    expect(canonicalDocumentJsonV3(projection.document)).toBe(canonicalDocumentJsonV3(document));
    expect(projection.pageLinkTargets).toEqual([targetItemId]);
    expect(projection.fileUsageIds).toEqual([fileItemId]);
    expect(projection.canonicalDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(projection.operationalDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(projection.warnings).toEqual([]);
  });

  it("projects identical canonical bytes from independent sessions of one checkpoint", async () => {
    const pageId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "paragraph",
            id: generateUuidV7(),
            content: [{ text: "Même contenu", marks: [{ type: "underline" }] }],
          },
        ],
      },
    });
    const checkpoint = await origin.checkpoint();
    const first = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const second = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });

    const [left, right] = await Promise.all([first.project(), second.project()]);
    expect(left.canonicalDigest).toBe(right.canonicalDigest);
    expect(canonicalDocumentJsonV3(left.document)).toBe(canonicalDocumentJsonV3(right.document));
  });
});
