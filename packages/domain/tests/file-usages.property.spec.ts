/**
 * Extracting file usages from a document (T009, US1, FR-004, FR-005).
 *
 * Two properties, and they are the two ways this can be wrong in a way that
 * costs an owner something:
 *
 * - **Nothing is missed.** A file the extraction fails to see is a file that
 *   later reports itself unused while a page still shows it, and the deletion
 *   confirmation then tells the owner it is safe to destroy.
 * - **Nothing is invented.** A usage that does not exist blocks a deletion the
 *   owner is entitled to make, and sends them looking for a page that does not
 *   reference the file.
 *
 * Written as properties rather than examples because the case that broke the
 * first implementation was nesting — an embed inside a list item — and nesting
 * is exactly what an example-based test forgets to include.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Block, type BlockDocument, embeddedFiles, generateUuidV7 } from "../src/index.ts";

/** A file embed carrying a known id, so the expectation is computable. */
function embedOf(fileItemId: string): Block {
  return {
    type: "fileEmbed",
    id: generateUuidV7(),
    fileItemId: fileItemId as never,
    caption: null,
  };
}

function paragraph(): Block {
  return { type: "paragraph", id: generateUuidV7(), content: [] };
}

/** A list item, which is where nesting actually happens in this model. */
function listItemWith(children: readonly Block[]): Block {
  return {
    type: "bulletedListItem",
    id: generateUuidV7(),
    content: [],
    children,
  };
}

const fileId = fc.constantFrom(
  "01a00000-0000-7000-8000-00000000000a",
  "01a00000-0000-7000-8000-00000000000b",
  "01a00000-0000-7000-8000-00000000000c",
);

describe("finding every file a document uses", () => {
  it("finds embeds at the top level", () => {
    fc.assert(
      fc.property(fc.array(fileId, { maxLength: 8 }), (ids) => {
        const document: BlockDocument = { blocks: ids.map(embedOf) };
        const found = embeddedFiles(document).map((usage) => usage.fileItemId);
        expect(found).toEqual(ids);
      }),
    );
  });

  it("finds embeds nested inside list items, however deep", () => {
    fc.assert(
      fc.property(fileId, fc.integer({ min: 1, max: 6 }), (id, depth) => {
        // Bury one embed `depth` levels down and confirm it is still found.
        let block = embedOf(id);
        for (let level = 0; level < depth; level += 1) {
          block = listItemWith([block]);
        }
        const found = embeddedFiles({ blocks: [block] });
        expect(found).toHaveLength(1);
        expect(found[0]?.fileItemId).toBe(id);
      }),
    );
  });

  it("invents nothing for documents that embed no file", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (count) => {
        const blocks = Array.from({ length: count }, () => paragraph());
        expect(embeddedFiles({ blocks })).toEqual([]);
      }),
    );
  });

  it("reports the same file twice when it is embedded twice", () => {
    // Not deduplicated, and deliberately: a confirmation saying "used in 1
    // place" for a file appearing twice on the page describes something else.
    const id = "01a00000-0000-7000-8000-00000000000a";
    const found = embeddedFiles({ blocks: [embedOf(id), paragraph(), embedOf(id)] });
    expect(found).toHaveLength(2);
    expect(found[0]?.blockId).not.toBe(found[1]?.blockId);
  });

  it("carries the block id, so a usage can be pointed at", () => {
    const embed = embedOf("01a00000-0000-7000-8000-00000000000a");
    const found = embeddedFiles({ blocks: [embed] });
    expect(found[0]?.blockId).toBe(embed.id);
    expect(found[0]?.usageKind).toBe("embed");
  });

  it("does not guess at references inside a block it cannot read", () => {
    // The documented consequence of not interpreting unknown blocks: a file
    // referenced only from one is reported as unused. Guessing which field of
    // an unrecognised block is a file pointer would be inventing a schema for
    // data we have already said we do not understand.
    const found = embeddedFiles({
      blocks: [
        {
          type: "unknown",
          id: generateUuidV7(),
          declaredType: "kanbanBoard",
          raw: { type: "kanbanBoard", fileItemId: "01a00000-0000-7000-8000-00000000000a" },
          syntheticId: false,
        },
      ],
    });
    expect(found).toEqual([]);
  });
});
