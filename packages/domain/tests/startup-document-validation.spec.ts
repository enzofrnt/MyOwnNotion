import { describe, expect, it } from "vitest";
import {
  collectBlockIds,
  duplicateBlockIds,
  generateUuidV7,
  serialiseCanonicalDocumentV3,
  validateDocument,
  validateDocumentV3,
} from "../src/index.ts";

describe("legacy page bodies received during startup", () => {
  it.each([
    [null, ""],
    [{ blocks: false }, "blocks"],
    [{ blocks: [null] }, "blocks[0]"],
    [{ blocks: [{}] }, "blocks[0].type"],
    [
      { blocks: [{ type: "checkbox", id: generateUuidV7(), checked: "false" }] },
      "blocks[0].checked",
    ],
    [{ blocks: [{ type: "code", id: generateUuidV7(), text: false }] }, "blocks[0].text"],
    [
      { blocks: [{ type: "code", id: generateUuidV7(), text: "kept", language: 3 }] },
      "blocks[0].language",
    ],
    [
      { blocks: [{ type: "fileEmbed", id: generateUuidV7(), fileItemId: "missing" }] },
      "blocks[0].fileItemId",
    ],
    [
      {
        blocks: [
          { type: "fileEmbed", id: generateUuidV7(), fileItemId: generateUuidV7(), caption: {} },
        ],
      },
      "blocks[0].caption",
    ],
    [{ blocks: [{ type: "paragraph", id: generateUuidV7(), content: {} }] }, "blocks[0].content"],
    [
      { blocks: [{ type: "paragraph", id: generateUuidV7(), content: [null] }] },
      "blocks[0].content[0]",
    ],
    [
      { blocks: [{ type: "paragraph", id: generateUuidV7(), content: [{}] }] },
      "blocks[0].content[0].text",
    ],
    [
      {
        blocks: [
          { type: "paragraph", id: generateUuidV7(), content: [{ text: "kept", marks: {} }] },
        ],
      },
      "blocks[0].content[0].marks",
    ],
    [
      {
        blocks: [
          { type: "paragraph", id: generateUuidV7(), content: [{ text: "kept", marks: [null] }] },
        ],
      },
      "blocks[0].content[0].marks[0]",
    ],
    [
      { blocks: [{ type: "quote", id: generateUuidV7(), content: [], children: {} }] },
      "blocks[0].children",
    ],
  ] as const)("rejects malformed stored body %# with its precise location", (body, path) => {
    const result = validateDocument(body);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Malformed input was accepted");
    expect(result.problems.map((problem) => problem.path)).toContain(path);
  });

  it("keeps the text of an unknown legacy mark and normalizes absent optional fields", () => {
    const paragraphId = generateUuidV7();
    const codeId = generateUuidV7();
    const embedId = generateUuidV7();
    const fileId = generateUuidV7();
    const result = validateDocument({
      blocks: [
        {
          type: "paragraph",
          id: paragraphId,
          content: [{ text: "kept", marks: [{ type: "future-style" }] }],
        },
        { type: "code", id: codeId, text: "source" },
        { type: "fileEmbed", id: embedId, fileItemId: fileId },
        { type: "quote", id: generateUuidV7(), content: [], children: [] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected readable legacy document");
    expect(result.document.blocks.slice(0, 3)).toEqual([
      { type: "paragraph", id: paragraphId, content: [{ text: "kept" }] },
      { type: "code", id: codeId, text: "source", language: null },
      { type: "fileEmbed", id: embedId, fileItemId: fileId, caption: null },
    ]);
  });

  it("finds a repeated identity in nested content without dropping its occurrences", () => {
    const repeated = generateUuidV7();
    const parent = generateUuidV7();
    const document = {
      blocks: [
        {
          type: "quote" as const,
          id: parent,
          content: [],
          children: [
            { type: "paragraph" as const, id: repeated, content: [{ text: "first" }] },
            { type: "paragraph" as const, id: repeated, content: [{ text: "second" }] },
          ],
        },
      ],
    };
    expect(collectBlockIds(document)).toEqual([parent, repeated, repeated]);
    expect(duplicateBlockIds(document)).toEqual([repeated]);
  });

  it("canonicalizes forward-compatible opaque data without interpreting it", () => {
    const id = generateUuidV7();
    const raw = {
      type: "future-widget",
      id,
      z: [{ b: true, a: null }, [2, "kept"]],
      a: { d: 4, c: 3 },
    };
    const result = validateDocumentV3({ blocks: [raw] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected opaque forward-compatible block");
    const serialized = serialiseCanonicalDocumentV3(result.document);
    expect(serialized).toEqual({ blocks: [raw] });
    expect(JSON.stringify(serialized)).toBe(
      JSON.stringify({
        blocks: [
          { a: { c: 3, d: 4 }, id, type: "future-widget", z: [{ a: null, b: true }, [2, "kept"]] },
        ],
      }),
    );
  });
});
