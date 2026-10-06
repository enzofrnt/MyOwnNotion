import {
  type BlockDocumentV3,
  exportMarkdownV3,
  generateUuidV7,
  serialiseDocumentV3,
  validateDocumentV3,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { OperationalPageDocument } from "../src/index.ts";

describe("math and contents document durability", () => {
  it("preserves source, adjacent inline identities and a derived contents block through checkpoint", async () => {
    const pageId = generateUuidV7(),
      id = generateUuidV7();
    const expression = "\\frac{1}{2}\n\n\n + \\sqrt{x}";
    const document: BlockDocumentV3 = {
      blocks: [
        { type: "equation", id, expression },
        { type: "tableOfContents", id: generateUuidV7() },
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [1, 2].map(() => ({
            text: "a+b",
            marks: [{ type: "equation", equationId: generateUuidV7(), expression: "a+b" }],
          })),
        },
      ],
    };
    expect(validateDocumentV3(serialiseDocumentV3(document))).toMatchObject({ ok: true });
    const page = OperationalPageDocument.create({ pageId, document });
    expect(page.snapshot()).toEqual(document);
    page.transact([
      { type: "set-block-property", blockId: id, key: "expression", value: "\\invalid{" },
    ]);
    const reopened = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await page.checkpoint(),
    });
    expect(reopened.snapshot().blocks[0]).toEqual({
      type: "equation",
      id,
      expression: "\\invalid{",
    });
    expect(reopened.snapshot().blocks[2]).toEqual(document.blocks[2]);
    expect(exportMarkdownV3(document)).toContain(`$$\n${expression}\n$$`);
    expect(exportMarkdownV3(document)).toContain("$a+b$$a+b$");
  });
  it("transforms a cleared slash block durably and forbids dropping live text", () => {
    for (const blockType of ["equation", "tableOfContents"] as const) {
      const pageId = generateUuidV7(),
        id = generateUuidV7();
      const page = OperationalPageDocument.create({
        pageId,
        document: { blocks: [{ type: "paragraph", id, content: [{ text: "/math" }] }] },
      });
      expect(() => page.transact([{ type: "set-block-type", blockId: id, blockType }])).toThrow();
      page.transact([
        { type: "replace-text", blockId: id, from: 0, to: 5, text: "" },
        { type: "set-block-type", blockId: id, blockType },
      ]);
      expect(page.snapshot().blocks[0]?.type).toBe(blockType);
    }
  });
});
