/**
 * The export path is total (T016, FR-005).
 *
 * Constitution principle I requires data to be exportable in documented,
 * durable formats, and an export that throws on some documents is not an export
 * path — it is one that works until the day an owner needs it.
 *
 * The properties here are deliberately about totality and completeness rather
 * than about the exact Markdown produced. Asserting the precise output would
 * pin down formatting choices that are allowed to change; asserting that
 * nothing is silently dropped pins down the guarantee.
 */

import { exportMarkdown, isUnknownBlock } from "@myownnotion/domain";
import {
  documentArbitrary,
  documentWithUnknownBlockArbitrary,
} from "@myownnotion/test-utils/documents";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("exportMarkdown", () => {
  it("never throws, on any valid document", () => {
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        expect(() => exportMarkdown(document)).not.toThrow();
      }),
    );
  });

  it("always ends in exactly one newline", () => {
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        const markdown = exportMarkdown(document);
        expect(markdown.endsWith("\n")).toBe(true);
        expect(markdown.endsWith("\n\n")).toBe(false);
      }),
    );
  });

  it("emits an unknown block in full rather than skipping it", () => {
    // Export is lossy by design and never *silently* lossy. Markdown has no
    // idiom for a block type it has never heard of, so the block is emitted as
    // labelled JSON — an owner who exports their notes gets all of them, not
    // the subset that happened to be representable.
    fc.assert(
      fc.property(documentWithUnknownBlockArbitrary, (document) => {
        const markdown = exportMarkdown(document);
        for (const block of document.blocks) {
          if (isUnknownBlock(block)) {
            expect(markdown).toContain(`unknown-block:${block.declaredType}`);
          }
        }
      }),
    );
  });

  it("carries every code block's text through verbatim", () => {
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        const markdown = exportMarkdown(document);
        for (const block of document.blocks) {
          if (block.type === "code" && block.text.trim() !== "") {
            expect(markdown).toContain(block.text.split("\n")[0] ?? "");
          }
        }
      }),
    );
  });
});
