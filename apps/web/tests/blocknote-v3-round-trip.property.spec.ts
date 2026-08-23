import {
  type BlockDocumentV3,
  canonicalDocumentJsonV3,
  generateUuidV7,
  normaliseDocumentV3,
} from "@myownnotion/domain";
import { documentV3Arbitrary } from "@myownnotion/test-utils/documents";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  blockNoteDocumentToCanonical,
  canonicalDocumentToBlockNote,
} from "../src/features/editor/blocknote-conversion.ts";

function canonical(document: BlockDocumentV3): string {
  return canonicalDocumentJsonV3(normaliseDocumentV3(document));
}

describe("canonical v3 ↔ BlockNote rich projection", () => {
  it("preserves every v3 block, mark, nested identity and property", () => {
    fc.assert(
      fc.property(documentV3Arbitrary, (source) => {
        const visible = canonicalDocumentToBlockNote(source);
        const projected = blockNoteDocumentToCanonical(visible);

        expect(canonical(projected)).toBe(canonical(source));
      }),
      { numRuns: 200 },
    );
  });

  it("maps table, row and cell identities to addressable editor nodes", () => {
    const tableId = generateUuidV7();
    const columnId = generateUuidV7();
    const rowId = generateUuidV7();
    const cellId = generateUuidV7();
    const source: BlockDocumentV3 = {
      blocks: [
        {
          type: "table",
          id: tableId,
          columns: [{ id: columnId, width: 240 }],
          rows: [{ id: rowId, cells: [{ id: cellId, content: [{ text: "Cellule" }] }] }],
        },
      ],
    };

    const visible = canonicalDocumentToBlockNote(source);

    expect(visible[0]).toMatchObject({
      id: tableId,
      type: "table",
      children: [
        {
          id: rowId,
          type: "tableRow",
          children: [{ id: cellId, type: "tableCell" }],
        },
      ],
    });
    expect(canonical(blockNoteDocumentToCanonical(visible))).toBe(canonical(source));
  });

  it("keeps forward-compatible properties and marks opaque instead of reducing them", () => {
    const blockId = generateUuidV7();
    const source: BlockDocumentV3 = {
      blocks: [
        {
          type: "paragraph",
          id: blockId,
          content: [
            {
              text: "Conservé",
              marks: [
                {
                  type: "unknown",
                  declaredType: "futureMark",
                  raw: { type: "futureMark", palette: "aurora" },
                },
              ],
            },
          ],
          rawExtraProperties: { futureLayout: { columns: 2 } },
        },
      ],
    };

    const visible = canonicalDocumentToBlockNote(source);

    expect(visible[0]).toMatchObject({
      id: blockId,
      type: "unknown",
      props: { declaredType: "paragraph" },
    });
    expect(canonical(blockNoteDocumentToCanonical(visible))).toBe(canonical(source));
  });
});
