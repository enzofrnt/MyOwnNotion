import {
  canonicalDocumentJsonV3,
  migrateDocumentV2ToV3,
  normaliseDocumentV3,
} from "@myownnotion/domain";
import { documentArbitrary } from "@myownnotion/test-utils/documents";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  blockNoteDocumentToCanonical,
  canonicalDocumentToBlockNote,
} from "../src/features/editor/blocknote-conversion.ts";

function canonical(document: ReturnType<typeof migrateDocumentV2ToV3>): string {
  return canonicalDocumentJsonV3(normaliseDocumentV3(document));
}

describe("canonical v3 ↔ BlockNote projection", () => {
  it("preserves every v2 block, mark, child and canonical UUID", () => {
    fc.assert(
      fc.property(
        documentArbitrary.filter((document) => document.blocks.length > 0),
        (document) => {
          const source = migrateDocumentV2ToV3(document);
          const visible = canonicalDocumentToBlockNote(source);
          const projected = blockNoteDocumentToCanonical(visible);

          expect(canonical(projected)).toBe(canonical(source));
          expect(visible.map((block) => block.id)).toEqual(source.blocks.map((block) => block.id));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("projects a fileEmbed natively and losslessly once the editor supports it", () => {
    const source = {
      blocks: [
        {
          type: "fileEmbed" as const,
          id: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056" as const,
          fileItemId: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2057" as const,
          caption: "Archive",
        },
      ],
    };

    const visible = canonicalDocumentToBlockNote(source);

    expect(visible[0]).toMatchObject({
      id: source.blocks[0].id,
      type: "fileEmbed",
      props: { fileItemId: source.blocks[0].fileItemId, caption: "Archive" },
    });
    expect(canonical(blockNoteDocumentToCanonical(visible))).toBe(canonical(source));
  });

  it("keeps an unsupported block visible and lossless instead of reducing it to a paragraph", () => {
    const source = {
      blocks: [
        {
          type: "unknown" as const,
          id: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056" as const,
          declaredType: "hologram",
          raw: { type: "hologram", depth: 3 } as const,
          syntheticId: false,
        },
      ],
    };

    const visible = canonicalDocumentToBlockNote(source);

    expect(visible[0]).toMatchObject({
      id: source.blocks[0].id,
      type: "unknown",
      props: { declaredType: "hologram" },
    });
    expect(canonical(blockNoteDocumentToCanonical(visible))).toBe(canonical(source));
  });
});
