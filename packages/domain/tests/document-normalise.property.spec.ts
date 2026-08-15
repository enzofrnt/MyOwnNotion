/**
 * Normalisation is idempotent, and why that matters (T015, FR-006, SC-009).
 *
 * Normalisation looks like tidying, and this file is the reason it is not. The
 * round-trip guarantee — a document survives an editing session unchanged —
 * needs a fixed point to compare against. Editors split text nodes for reasons
 * that are not content: a cursor position, a mark applied and removed, a paste
 * boundary. Without a canonical form, "the document came back unchanged" would
 * depend on those accidents, and the property would be untestable rather than
 * false.
 *
 * So: `normalise(normalise(d))` must equal `normalise(d)` on every document,
 * and normalisation must never change what the document says.
 */

import type { Block, BlockDocument, Inline } from "@myownnotion/domain";
import {
  childrenOf,
  isUnknownBlock,
  normaliseDocument,
  normaliseInline,
  serialiseDocument,
} from "@myownnotion/domain";
import { documentArbitrary, inlineArbitrary } from "@myownnotion/test-utils/documents";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/** The text a document says, ignoring how it is split into nodes. */
function plainText(document: BlockDocument): string {
  const parts: string[] = [];
  const visit = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      if (isUnknownBlock(block)) {
        parts.push(JSON.stringify(block.raw));
      } else if ("content" in block) {
        // Concatenated with no separator, deliberately: merging ["a"]["b"] into
        // ["ab"] is exactly what normalisation is for, so a comparison able to
        // tell those apart would be asserting that normalisation does nothing.
        parts.push(block.content.map((node) => node.text).join(""));
      } else if (block.type === "code") {
        parts.push(block.text);
      }
      visit(childrenOf(block));
    }
  };
  visit(document.blocks);
  return parts.join("\n");
}

describe("normalisation", () => {
  it("is idempotent", () => {
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        const once = normaliseDocument(document);
        const twice = normaliseDocument(once);
        expect(serialiseDocument(twice)).toEqual(serialiseDocument(once));
      }),
    );
  });

  it("never changes what the document says", () => {
    // Idempotence alone would be satisfied by a function that empties the
    // document. This is the property saying normalisation is conservative.
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        expect(plainText(normaliseDocument(document))).toBe(plainText(document));
      }),
    );
  });

  it("leaves unknown blocks completely alone", () => {
    // Normalising an unknown block would mean interpreting it, which is the one
    // thing that must never happen to it.
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        const normalised = normaliseDocument(document);
        for (const [index, block] of document.blocks.entries()) {
          if (isUnknownBlock(block)) {
            expect(normalised.blocks[index]).toBe(block);
          }
        }
      }),
    );
  });
});

describe("inline normalisation", () => {
  it("merges adjacent runs carrying identical marks", () => {
    fc.assert(
      fc.property(inlineArbitrary, (node) => {
        const merged = normaliseInline([node, node]);
        expect(merged).toHaveLength(1);
        expect(merged[0]?.text).toBe(node.text + node.text);
      }),
    );
  });

  it("drops empty text nodes", () => {
    fc.assert(
      fc.property(fc.array(inlineArbitrary, { maxLength: 4 }), (nodes) => {
        const withEmpties: Inline[] = [];
        for (const node of nodes) {
          withEmpties.push({ text: "" }, node);
        }
        expect(normaliseInline(withEmpties)).toEqual(normaliseInline(nodes));
      }),
    );
  });

  it("puts marks in an order that does not depend on how they were applied", () => {
    fc.assert(
      fc.property(inlineArbitrary, (node) => {
        const reversed: Inline =
          node.marks === undefined ? node : { text: node.text, marks: [...node.marks].reverse() };
        expect(normaliseInline([reversed])).toEqual(normaliseInline([node]));
      }),
    );
  });
});

describe("marks the editor schema would reject", () => {
  // These three rules were not invented for tidiness. Each one was a document
  // the model considered legal and ProseMirror refused to open, found by
  // running the round trip through the real schema with `check()` rather than
  // only through `nodeFromJSON`, which is far more forgiving than an editor is.

  it("keeps only one link per run, the first one", () => {
    // A run of text points somewhere, or somewhere else — it cannot do both.
    const first = { type: "link" as const, href: "https://example.org/" };
    const second = { type: "link" as const, href: "mailto:someone@example.org" };
    expect(normaliseInline([{ text: "x", marks: [first, second] }])).toEqual([
      { text: "x", marks: [first] },
    ]);
  });

  it("drops every other mark when the run is code", () => {
    // Bold inside a code span has no typographic meaning, the Markdown export
    // already ignored it, and the editor schema excludes it outright.
    expect(normaliseInline([{ text: "x", marks: [{ type: "bold" }, { type: "code" }] }])).toEqual([
      { text: "x", marks: [{ type: "code" }] },
    ]);
  });

  it("keeps a code run's mark even when code came first", () => {
    expect(normaliseInline([{ text: "x", marks: [{ type: "code" }, { type: "italic" }] }])).toEqual(
      [{ text: "x", marks: [{ type: "code" }] }],
    );
  });
});
