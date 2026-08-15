/**
 * The conversion boundary is lossless (T030, T031, US1, FR-006, SC-009).
 *
 * The most important test in this feature, and the one it would be easiest to
 * write uselessly. A round trip through `toTiptap` and `fromTiptap` alone would
 * prove that two functions I wrote agree with each other — which they would,
 * being written together, and which is not the risk.
 *
 * The risk is ProseMirror. It validates content against its schema and discards
 * what does not fit; `Node.fromJSON` throws on a node type it has never seen.
 * So the trip here goes through the **real schema**: model → JSON →
 * `schema.nodeFromJSON` → `node.toJSON()` → model. That is the path an owner's
 * document actually takes when a page is opened and saved, and it is the one
 * where a block can disappear.
 *
 * Documents are compared after normalisation, because the editor is entitled to
 * split and merge text nodes for reasons that are not content. That is what
 * normalisation is for, and comparing before it would assert the editor never
 * touches its own internals.
 */

import type { BlockDocument } from "@myownnotion/domain";
import { normaliseDocument, serialiseDocument } from "@myownnotion/domain";
import {
  documentArbitrary,
  documentWithUnknownBlockArbitrary,
} from "@myownnotion/test-utils/documents";
import { getSchema } from "@tiptap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromTiptap } from "../src/features/editor/from-tiptap.ts";
import { editorExtensions } from "../src/features/editor/tiptap-schema.ts";
import { toTiptap } from "../src/features/editor/to-tiptap.ts";

const schema = getSchema(editorExtensions());

/** The trip a document takes when a page is opened and then saved. */
function throughEditor(document: BlockDocument): BlockDocument {
  const json = toTiptap(document);
  // The step that matters: ProseMirror parses the JSON against the schema,
  // applying every rule that could drop content, then emits it again.
  const node = schema.nodeFromJSON(json);
  // `nodeFromJSON` is more forgiving than the editor is. It happily built a
  // `doc` with no children, which `check()` rejects and which threw
  // `RangeError: Invalid content for node doc` the moment a real editor mounted
  // on a new page. Without this line the suite was green while the application
  // crashed on the most ordinary action there is — opening an empty page.
  node.check();
  return fromTiptap(node.toJSON());
}

function canonical(document: BlockDocument): unknown {
  return serialiseDocument(normaliseDocument(document));
}

describe("model → editor → model", () => {
  it("is the identity on generated documents", () => {
    fc.assert(
      fc.property(
        // Non-empty only, and the exclusion is a real statement about the
        // model rather than a convenience: ProseMirror's `doc` cannot hold
        // zero blocks, so an empty document is not representable in the editor
        // and comes back as one empty paragraph. That case is asserted on its
        // own below instead of being quietly excluded here.
        documentArbitrary.filter((document) => document.blocks.length > 0),
        (document) => {
          expect(canonical(throughEditor(document))).toEqual(canonical(document));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("turns an empty document into one empty paragraph", () => {
    // The single point where the trip is deliberately not the identity. An
    // editor with nowhere to type is not editable, and a `doc` with no
    // children is rejected by the schema — so a new page opens on one empty
    // paragraph. Nothing is lost; the alternative is a crash on every new page,
    // which is exactly what happened before this was asserted.
    const result = throughEditor({ blocks: [] });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.type).toBe("paragraph");
  });

  it("never throws, whatever the document contains", () => {
    // A round trip that throws is content loss with a stack trace attached.
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        expect(() => throughEditor(document)).not.toThrow();
      }),
    );
  });

  it("is stable under repetition", () => {
    // Opening and saving a page twice must not drift. A conversion that loses a
    // little each time passes a single round trip and destroys a document over
    // a week of editing.
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        const once = throughEditor(document);
        const twice = throughEditor(once);
        expect(canonical(twice)).toEqual(canonical(once));
      }),
    );
  });
});

describe("an unrecognised block", () => {
  it("survives the trip with its JSON identical", () => {
    // SC-009. Compared against the stored value directly rather than against a
    // normalised form: an unknown block is never interpreted, so there is
    // nothing for normalisation to do to it.
    fc.assert(
      fc.property(documentWithUnknownBlockArbitrary, (document) => {
        const before = document.blocks.filter((block) => block.type === "unknown");
        const after = throughEditor(document).blocks.filter((block) => block.type === "unknown");

        expect(after).toHaveLength(before.length);
        for (const [index, block] of before.entries()) {
          expect(after[index]?.type).toBe("unknown");
          if (block.type === "unknown" && after[index]?.type === "unknown") {
            expect(JSON.stringify(after[index].raw)).toBe(JSON.stringify(block.raw));
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("keeps its identity rather than being re-minted", () => {
    fc.assert(
      fc.property(documentWithUnknownBlockArbitrary, (document) => {
        const before = document.blocks.filter((block) => block.type === "unknown");
        const after = throughEditor(document).blocks.filter((block) => block.type === "unknown");
        expect(after.map((block) => block.id)).toEqual(before.map((block) => block.id));
      }),
    );
  });
});

describe("block identity", () => {
  it("is preserved for every block that had one", () => {
    // Not tidiness. Identity is what a future backlink or comment anchors to,
    // and feature 001 established that it is never derived from position or
    // content. A block whose id changes on every open is one nothing can refer
    // to.
    fc.assert(
      // Non-empty for the same reason as above: an empty document gains an
      // empty paragraph, and that paragraph is new, so it has a new identity.
      fc.property(
        documentArbitrary.filter((document) => document.blocks.length > 0),
        (document) => {
          const before = document.blocks.map((block) => block.id);
          const after = throughEditor(document).blocks.map((block) => block.id);
          expect(after).toEqual(before);
        },
      ),
      { numRuns: 200 },
    );
  });
});
