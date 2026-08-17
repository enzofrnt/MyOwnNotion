/**
 * What a merge does, and what it refuses to decide (T022, US3, FR-013, FR-014).
 *
 * The whole table from `contracts/conflict-resolution.md`, because the two rows
 * that matter are easy to write wrongly and impossible to notice afterwards:
 *
 *   - both sides edited the same block — obvious, and asserted;
 *   - one side deleted a block and the other rewrote it — a naive merge picks a
 *     winner. Taking the deletion discards a rewrite; taking the rewrite
 *     resurrects something the owner removed. Both are intentions, so the only
 *     correct answer is to ask.
 */

import { describe, expect, it } from "vitest";
import {
  applyResolution,
  type BlockDocument,
  generateUuidV7,
  mergeDocuments,
} from "../src/index.ts";

const A = "01a10000-0000-7000-8000-00000000000a" as never;
const B = "01a10000-0000-7000-8000-00000000000b" as never;
const C = "01a10000-0000-7000-8000-00000000000c" as never;

function paragraph(id: string, text: string) {
  return {
    type: "paragraph" as const,
    id: id as never,
    content: text === "" ? [] : [{ text }],
  };
}

function doc(...blocks: ReturnType<typeof paragraph>[]): BlockDocument {
  return { blocks };
}

function mergedText(outcome: ReturnType<typeof mergeDocuments>): string[] {
  if (outcome.kind !== "merged") {
    throw new Error("expected a merge");
  }
  return outcome.document.blocks.map((block) =>
    "content" in block ? block.content.map((run) => run.text).join("") : "",
  );
}

describe("changes that merge without asking", () => {
  it("takes the local side when only local changed", () => {
    const ancestor = doc(paragraph(A, "original"), paragraph(B, "kept"));
    const local = doc(paragraph(A, "edited here"), paragraph(B, "kept"));
    expect(mergedText(mergeDocuments(ancestor, local, ancestor))).toEqual(["edited here", "kept"]);
  });

  it("takes the remote side when only remote changed", () => {
    const ancestor = doc(paragraph(A, "original"), paragraph(B, "kept"));
    const remote = doc(paragraph(A, "edited there"), paragraph(B, "kept"));
    expect(mergedText(mergeDocuments(ancestor, ancestor, remote))).toEqual([
      "edited there",
      "kept",
    ]);
  });

  it("merges different blocks changed on different sides", () => {
    // The commonest real divergence, and the one worth merging silently: two
    // devices working on different paragraphs of the same page.
    const ancestor = doc(paragraph(A, "first"), paragraph(B, "second"));
    const local = doc(paragraph(A, "first, revised"), paragraph(B, "second"));
    const remote = doc(paragraph(A, "first"), paragraph(B, "second, revised"));
    expect(mergedText(mergeDocuments(ancestor, local, remote))).toEqual([
      "first, revised",
      "second, revised",
    ]);
  });

  it("does not ask when both sides made the identical change", () => {
    const ancestor = doc(paragraph(A, "before"));
    const same = doc(paragraph(A, "after"));
    // The owner made the same edit twice. Asking which they meant would be
    // asking them to choose between two identical answers.
    expect(mergeDocuments(ancestor, same, same).kind).toBe("merged");
  });

  it("keeps a block added on one side", () => {
    const ancestor = doc(paragraph(A, "one"));
    const local = doc(paragraph(A, "one"), paragraph(B, "two"));
    expect(mergedText(mergeDocuments(ancestor, local, ancestor))).toEqual(["one", "two"]);
  });

  it("keeps blocks added on both sides, local order first", () => {
    const ancestor = doc(paragraph(A, "one"));
    const local = doc(paragraph(A, "one"), paragraph(B, "from here"));
    const remote = doc(paragraph(A, "one"), paragraph(C, "from there"));
    // Both additions survive. Local order leads because that is the device the
    // owner is looking at; interleaving would produce an arrangement neither
    // device had.
    expect(mergedText(mergeDocuments(ancestor, local, remote))).toEqual([
      "one",
      "from here",
      "from there",
    ]);
  });

  it("honours a deletion the other side did not touch", () => {
    const ancestor = doc(paragraph(A, "one"), paragraph(B, "remove me"));
    const local = doc(paragraph(A, "one"));
    expect(mergedText(mergeDocuments(ancestor, local, ancestor))).toEqual(["one"]);
  });

  it("merges when nothing changed at all", () => {
    const ancestor = doc(paragraph(A, "still"));
    expect(mergeDocuments(ancestor, ancestor, ancestor).kind).toBe("merged");
  });
});

describe("changes that need the owner", () => {
  it("refuses when both sides edited the same block differently", () => {
    const ancestor = doc(paragraph(A, "original"));
    const local = doc(paragraph(A, "mine"));
    const remote = doc(paragraph(A, "theirs"));

    const outcome = mergeDocuments(ancestor, local, remote);
    expect(outcome.kind).toBe("needs-owner");
    expect(outcome.kind === "needs-owner" && outcome.conflictedBlockIds).toEqual([A]);
  });

  it("refuses when one side deleted a block and the other rewrote it", () => {
    // The row a naive merge gets wrong. Taking the deletion discards a rewrite;
    // taking the rewrite resurrects something the owner removed. Both are
    // intentions and neither is safe to assume.
    const ancestor = doc(paragraph(A, "keep"), paragraph(B, "contested"));
    const deleted = doc(paragraph(A, "keep"));
    const rewritten = doc(paragraph(A, "keep"), paragraph(B, "completely rewritten"));

    const outcome = mergeDocuments(ancestor, deleted, rewritten);
    expect(outcome.kind).toBe("needs-owner");
    expect(outcome.kind === "needs-owner" && outcome.conflictedBlockIds).toEqual([B]);
  });

  it("carries all three versions, so the screen shows what was decided against", () => {
    const ancestor = doc(paragraph(A, "original"));
    const local = doc(paragraph(A, "mine"));
    const remote = doc(paragraph(A, "theirs"));

    const outcome = mergeDocuments(ancestor, local, remote);
    if (outcome.kind !== "needs-owner") {
      throw new Error("expected a conflict");
    }
    // Three columns need three documents. Without the ancestor an owner cannot
    // tell which side changed what, and is left comparing two plausible pages.
    expect(outcome.ancestor).toBe(ancestor);
    expect(outcome.local).toBe(local);
    expect(outcome.remote).toBe(remote);
  });

  it("reports every conflicted block, not only the first", () => {
    const ancestor = doc(paragraph(A, "a"), paragraph(B, "b"));
    const local = doc(paragraph(A, "a-mine"), paragraph(B, "b-mine"));
    const remote = doc(paragraph(A, "a-theirs"), paragraph(B, "b-theirs"));

    const outcome = mergeDocuments(ancestor, local, remote);
    // Stopping at the first would let the owner resolve one and be surprised by
    // the next.
    expect(outcome.kind === "needs-owner" && outcome.conflictedBlockIds).toEqual([A, B]);
  });

  it("treats an unknown block exactly like any other", () => {
    // A block type this version does not understand still has an identity, and
    // comparing it by serialisation means it merges and conflicts correctly
    // without this function knowing what it is.
    const unknown = (text: string) => ({
      type: "unknown" as const,
      id: C as never,
      declaredType: "kanbanBoard",
      raw: { type: "kanbanBoard", note: text },
      syntheticId: false,
    });
    const ancestor: BlockDocument = { blocks: [unknown("before")] };
    const local: BlockDocument = { blocks: [unknown("mine")] };
    const remote: BlockDocument = { blocks: [unknown("theirs")] };

    expect(mergeDocuments(ancestor, local, remote).kind).toBe("needs-owner");
    expect(mergeDocuments(ancestor, local, ancestor).kind).toBe("merged");
  });

  it("does not invent conflicts for blocks nobody touched", () => {
    const untouched = paragraph(generateUuidV7(), "quiet");
    const ancestor = doc(paragraph(A, "x"), untouched);
    const local = doc(paragraph(A, "mine"), untouched);
    const remote = doc(paragraph(A, "theirs"), untouched);

    const outcome = mergeDocuments(ancestor, local, remote);
    expect(outcome.kind === "needs-owner" && outcome.conflictedBlockIds).toEqual([A]);
  });
});

/**
 * What the owner's choices become (T024, FR-015, FR-016).
 *
 * `applyResolution` is where a decision turns into a document, so every branch
 * here is a way of getting an owner's words wrong. The one that matters most is
 * the *absence* of a decision: a conflicted block nobody answered must not
 * disappear, because dropping it would destroy content the owner never chose to
 * remove — which is the single thing this whole path exists to prevent.
 */
describe("applying the owner's resolution", () => {
  /** A divergence on block A, with B unchanged on both sides. */
  function divergence() {
    const outcome = mergeDocuments(
      doc(paragraph(A, "original"), paragraph(B, "untouched")),
      doc(paragraph(A, "written here"), paragraph(B, "untouched")),
      doc(paragraph(A, "written there"), paragraph(B, "untouched")),
    );
    if (outcome.kind !== "needs-owner") {
      throw new Error("expected a conflict to resolve");
    }
    return outcome;
  }

  function textOf(document: BlockDocument): string[] {
    return document.blocks.map((block) =>
      "content" in block ? block.content.map((run) => run.text).join("") : "",
    );
  }

  it("keeps the local side when that is what was chosen", () => {
    const resolved = applyResolution({
      outcome: divergence(),
      choices: new Map([[A, "local"]]),
    });
    expect(textOf(resolved)).toEqual(["written here", "untouched"]);
  });

  it("keeps the remote side when that is what was chosen", () => {
    const resolved = applyResolution({
      outcome: divergence(),
      choices: new Map([[A, "remote"]]),
    });
    expect(textOf(resolved)).toEqual(["written there", "untouched"]);
  });

  it("keeps both, local first, when the owner wants both", () => {
    const resolved = applyResolution({
      outcome: divergence(),
      choices: new Map([[A, "both"]]),
    });
    // Local first is the documented order. It is not a preference for the local
    // side: it is the only order either device has actually seen, and the screen
    // lets the owner rearrange it afterwards.
    expect(textOf(resolved)).toEqual(["written here", "written there", "untouched"]);
  });

  it("keeps the local side for a conflict nobody answered", () => {
    // The assertion this function exists for. An unanswered block must not be
    // dropped: that would destroy content the owner never chose to remove, and
    // it would happen silently, in the one screen built to prevent exactly that.
    const resolved = applyResolution({ outcome: divergence(), choices: new Map() });
    expect(textOf(resolved)).toEqual(["written here", "untouched"]);
  });

  it("carries through a block only one side added", () => {
    const outcome = mergeDocuments(
      doc(paragraph(A, "original")),
      doc(paragraph(A, "written here"), paragraph(B, "added here")),
      doc(paragraph(A, "written there"), paragraph(C, "added there")),
    );
    if (outcome.kind !== "needs-owner") {
      throw new Error("expected a conflict to resolve");
    }
    const resolved = applyResolution({ outcome, choices: new Map([[A, "local"]]) });
    // Both additions survive: neither was contested, so neither is the owner's
    // to decide. Losing one because the *other* block needed a decision would be
    // a decision made on their behalf.
    expect(textOf(resolved)).toEqual(["written here", "added here", "added there"]);
  });

  it("omits a block both sides deleted", () => {
    const outcome = mergeDocuments(
      doc(paragraph(A, "original"), paragraph(B, "doomed")),
      doc(paragraph(A, "written here")),
      doc(paragraph(A, "written there")),
    );
    if (outcome.kind !== "needs-owner") {
      throw new Error("expected a conflict to resolve");
    }
    const resolved = applyResolution({ outcome, choices: new Map([[A, "both"]]) });
    // Agreement, not a conflict. Both devices removed it, so restoring it would
    // be the merge overruling two people who wanted the same thing.
    expect(textOf(resolved)).toEqual(["written here", "written there"]);
  });

  it("is stable when applied twice to the same choices", () => {
    const outcome = divergence();
    const choices = new Map<string, "local" | "remote" | "both">([[A, "both"]]);
    expect(applyResolution({ outcome, choices })).toEqual(applyResolution({ outcome, choices }));
  });
});
