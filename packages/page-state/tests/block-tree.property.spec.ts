import { canonicalDocumentJsonV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OperationalPageDocument, PageCommandError } from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

describe("the movable operational block tree", () => {
  it("converges concurrent insertions at the same position with every identity intact", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("gauche", "left"),
        fc.constantFrom("droite", "right"),
        async (a, b) => {
          const pageId = generateUuidV7();
          const anchorId = generateUuidV7();
          const leftId = generateUuidV7();
          const rightId = generateUuidV7();
          const origin = OperationalPageDocument.create({
            pageId,
            document: { blocks: [paragraph(anchorId, "Ancre")] },
          });
          const checkpoint = await origin.checkpoint();
          const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
          const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });

          const leftUpdate = left.transact([
            {
              type: "insert-block",
              block: paragraph(leftId, a),
              parentBlockId: null,
              beforeBlockId: anchorId,
            },
          ]);
          const rightUpdate = right.transact([
            {
              type: "insert-block",
              block: paragraph(rightId, b),
              parentBlockId: null,
              beforeBlockId: anchorId,
            },
          ]);
          left.importUpdate(rightUpdate.updateBytes);
          right.importUpdate(leftUpdate.updateBytes);

          const leftDocument = (await left.project()).document;
          const rightDocument = (await right.project()).document;
          expect(canonicalDocumentJsonV3(leftDocument)).toBe(
            canonicalDocumentJsonV3(rightDocument),
          );
          expect(new Set(leftDocument.blocks.map(({ id }) => id))).toEqual(
            new Set([anchorId, leftId, rightId]),
          );
        },
      ),
    );
  });

  it("converges independent concurrent moves", async () => {
    const pageId = generateUuidV7();
    const ids = [generateUuidV7(), generateUuidV7(), generateUuidV7(), generateUuidV7()] as const;
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: ids.map((id, index) => paragraph(id, String(index))) },
    });
    const checkpoint = await origin.checkpoint();
    const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const leftUpdate = left.transact([
      { type: "move-block", blockId: ids[3], parentBlockId: null, beforeBlockId: ids[0] },
    ]);
    const rightUpdate = right.transact([
      { type: "move-block", blockId: ids[1], parentBlockId: null, beforeBlockId: null },
    ]);

    right.importUpdate(leftUpdate.updateBytes);
    left.importUpdate(rightUpdate.updateBytes);
    expect(canonicalDocumentJsonV3((await left.project()).document)).toBe(
      canonicalDocumentJsonV3((await right.project()).document),
    );
    expect(new Set((await left.project()).document.blocks.map(({ id }) => id))).toEqual(
      new Set(ids),
    );
  });

  it("rejects a cycle without changing the tree", async () => {
    const pageId = generateUuidV7();
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "toggle",
            id: parentId,
            content: [{ text: "Parent" }],
            children: [
              {
                type: "toggle",
                id: childId,
                content: [{ text: "Enfant" }],
              },
            ],
          },
        ],
      },
    });
    const before = canonicalDocumentJsonV3((await page.project()).document);

    expect(() =>
      page.transact([
        {
          type: "move-block",
          blockId: parentId,
          parentBlockId: childId,
          beforeBlockId: null,
        },
      ]),
    ).toThrow(PageCommandError);
    expect(canonicalDocumentJsonV3((await page.project()).document)).toBe(before);
  });
});
