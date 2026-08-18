/**
 * What a merge must never do, for any three documents (T021, US3, FR-013, FR-016).
 *
 * Properties rather than examples, because the failure this guards against is
 * silent: a merge that quietly prefers one side produces a plausible document
 * and loses a paragraph, and nothing in the interface can tell the owner it
 * happened. An example-based suite proves the cases someone imagined.
 *
 * Two properties carry the weight:
 *
 * 1. **A change made on exactly one side is never lost.** If only one device
 *    touched a block, the merge has all the information it needs and asking the
 *    owner — or dropping it — would both be failures.
 * 2. **A block changed on both sides is never resolved silently.** That is the
 *    case where no rule can be right, so the only correct outcome is to ask.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type BlockDocument, mergeDocuments } from "../src/index.ts";

/** A small pool of ids, so divergence on the same block actually happens. */
const ids = ["01a1", "01a2", "01a3", "01a4"].map(
  (suffix) => `01a10000-0000-7000-8000-0000000${suffix}` as never,
);

function paragraph(id: (typeof ids)[number], text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

/** A document over a subset of the id pool, with per-block text. */
const documentOf = fc
  .array(fc.tuple(fc.constantFrom(...ids), fc.string({ minLength: 1, maxLength: 6 })), {
    maxLength: 5,
  })
  .map((entries): BlockDocument => {
    const seen = new Set<string>();
    const blocks = [];
    for (const [id, text] of entries) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      blocks.push(paragraph(id, text));
    }
    return { blocks };
  });

function textOf(document: BlockDocument, id: string): string | undefined {
  const block = document.blocks.find((candidate) => candidate.id === id);
  return block !== undefined && "content" in block
    ? block.content.map((run) => run.text).join("")
    : undefined;
}

describe("what a merge never does", () => {
  it("never loses a change made on exactly one side", () => {
    fc.assert(
      fc.property(documentOf, documentOf, (ancestor, local) => {
        // Remote is the ancestor untouched, so every difference is local's.
        const outcome = mergeDocuments(ancestor, local, ancestor);
        // Nothing changed on both sides, so this must merge rather than ask.
        expect(outcome.kind).toBe("merged");
        if (outcome.kind !== "merged") {
          return;
        }
        for (const id of ids) {
          // Whatever local says about a block is what the merge says.
          expect(textOf(outcome.document, id)).toBe(textOf(local, id));
        }
      }),
      { numRuns: 300 },
    );
  });

  it("is symmetric about which side is which when only one changed", () => {
    fc.assert(
      fc.property(documentOf, documentOf, (ancestor, changed) => {
        // The same divergence, with the sides swapped, must reach the same
        // outcome: a merge that depended on argument order would give two
        // devices different documents from the same facts.
        const asLocal = mergeDocuments(ancestor, changed, ancestor);
        const asRemote = mergeDocuments(ancestor, ancestor, changed);
        expect(asLocal.kind).toBe(asRemote.kind);
      }),
      { numRuns: 300 },
    );
  });

  it("never silently resolves a block that changed differently on both sides", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ids),
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.string({ minLength: 1, maxLength: 6 }),
        (id, base, mine, theirs) => {
          fc.pre(mine !== theirs && mine !== base && theirs !== base);
          const outcome = mergeDocuments(
            { blocks: [paragraph(id, base)] },
            { blocks: [paragraph(id, mine)] },
            { blocks: [paragraph(id, theirs)] },
          );
          // No rule can choose correctly here, so the only correct outcome is to
          // ask — and to name the block that needs the answer.
          expect(outcome.kind).toBe("needs-owner");
          expect(outcome.kind === "needs-owner" && outcome.conflictedBlockIds).toContain(id);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never reports a conflict when the two sides agree", () => {
    fc.assert(
      fc.property(documentOf, documentOf, (ancestor, both) => {
        // Both devices ended at the same document. However they got there, there
        // is nothing to ask about.
        expect(mergeDocuments(ancestor, both, both).kind).toBe("merged");
      }),
      { numRuns: 300 },
    );
  });

  it("keeps every block that exists on either side and was not deleted", () => {
    fc.assert(
      fc.property(documentOf, documentOf, (local, remote) => {
        // An empty ancestor means every block on either side was added, and an
        // addition is never a conflict — so nothing may be dropped.
        const outcome = mergeDocuments({ blocks: [] }, local, remote);
        if (outcome.kind !== "merged") {
          return;
        }
        const present = new Set(outcome.document.blocks.map((block) => block.id));
        for (const block of [...local.blocks, ...remote.blocks]) {
          expect(present.has(block.id)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("produces each block at most once", () => {
    fc.assert(
      fc.property(documentOf, documentOf, documentOf, (ancestor, local, remote) => {
        const outcome = mergeDocuments(ancestor, local, remote);
        if (outcome.kind !== "merged") {
          return;
        }
        // A block emitted twice would duplicate an owner's paragraph, which
        // reads as corruption rather than as a merge.
        const ids = outcome.document.blocks.map((block) => block.id);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 300 },
    );
  });
});
