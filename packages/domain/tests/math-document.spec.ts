import { describe, expect, it } from "vitest";
import {
  type BlockDocumentV3,
  exportMarkdownV3,
  extractSearchableDocumentTextV3,
  generateUuidV7,
  normaliseDocumentV3,
  serialiseDocumentV3,
  validateDocumentV3,
} from "../src/index.ts";

describe("math and contents canonical boundaries", () => {
  it("retains exact sources, adjacent identities and unknown block fields through normalization/export", () => {
    const expression = "\\frac{a}{b}\n\n\n\t+ c",
      id = generateUuidV7();
    const doc: BlockDocumentV3 = {
      blocks: [
        { type: "equation", id, expression, rawExtraProperties: { future: 42 } },
        { type: "tableOfContents", id: generateUuidV7() },
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [1, 2].map(() => ({
            text: "x",
            marks: [{ type: "equation", equationId: generateUuidV7(), expression: "x" }],
          })),
        },
      ],
    };
    const normalized = normaliseDocumentV3(doc);
    expect(normalized.blocks[0]).toEqual(doc.blocks[0]);
    expect(normalized.blocks[2]).toEqual(doc.blocks[2]);
    expect(validateDocumentV3(serialiseDocumentV3(normalized))).toMatchObject({
      ok: true,
      document: normalized,
    });
    expect(exportMarkdownV3(normalized)).toContain(`$$\n${expression}\n$$`);
    expect(extractSearchableDocumentTextV3(normalized)).toContain("frac");
  });
  it("rejects invalid identities, unsafe controls and code conflicts while accepting syntax errors as source", () => {
    expect(
      validateDocumentV3({
        blocks: [{ type: "equation", id: generateUuidV7(), expression: "\\frac{" }],
      }).ok,
    ).toBe(true);
    for (const block of [
      { type: "equation", id: generateUuidV7(), expression: "x\u0000" },
      { type: "equation", id: generateUuidV7(), expression: 42 },
      {
        type: "paragraph",
        id: generateUuidV7(),
        content: [{ text: "x", marks: [{ type: "equation", equationId: "bad", expression: "x" }] }],
      },
      {
        type: "paragraph",
        id: generateUuidV7(),
        content: [
          {
            text: "x",
            marks: [
              { type: "equation", equationId: generateUuidV7(), expression: "x" },
              { type: "code" },
            ],
          },
        ],
      },
    ])
      expect(validateDocumentV3({ blocks: [block] }).ok).toBe(false);
  });
});
