/**
 * What a deletion is allowed to do (T018, US2, FR-004).
 *
 * The asymmetry is the subject. A refused deletion costs an owner a few
 * seconds; an unseen one leaves pages pointing at something that is gone. So
 * every case where the rule could wrongly say "proceed" is asserted, and the
 * one where it could wrongly say "stop" is asserted too — because a rule that
 * refuses everything is safe and useless.
 */

import { describe, expect, it } from "vitest";
import { describeUsages, generateUuidV7, type NamedUsage, planFileDeletion } from "../src/index.ts";

function usage(name: string, kind: NamedUsage["usageKind"] = "attachment"): NamedUsage {
  return {
    usedByItemId: generateUuidV7(),
    usedByName: name,
    usageKind: kind,
    blockId: kind === "embed" ? generateUuidV7() : null,
  };
}

describe("planning a file deletion", () => {
  it("proceeds when nothing points at the file", () => {
    expect(planFileDeletion({ fileExists: true, usages: [], confirmed: false })).toEqual({
      kind: "proceed",
    });
  });

  it("refuses until the owner has been shown what uses it", () => {
    const plan = planFileDeletion({
      fileExists: true,
      usages: [usage("Quarterly review")],
      confirmed: false,
    });
    expect(plan.kind).toBe("confirm-required");
    // The usages travel in the plan so the list shown and the list decided
    // against are necessarily the same one.
    expect(plan.kind === "confirm-required" && plan.usages).toHaveLength(1);
  });

  it("proceeds once the owner has confirmed", () => {
    expect(
      planFileDeletion({ fileExists: true, usages: [usage("Notes")], confirmed: true }),
    ).toEqual({ kind: "proceed" });
  });

  it("reports a missing file rather than pretending to delete it", () => {
    expect(planFileDeletion({ fileExists: false, usages: [], confirmed: true })).toEqual({
      kind: "not-found",
    });
  });

  it("treats every usage kind as a reason to confirm", () => {
    // An embed is as much a reason as an attachment: the page shows the file
    // either way, and the owner loses the same thing.
    for (const kind of ["attachment", "embed", "hierarchy"] as const) {
      const plan = planFileDeletion({
        fileExists: true,
        usages: [usage("Somewhere", kind)],
        confirmed: false,
      });
      expect(plan.kind).toBe("confirm-required");
    }
  });
});

describe("what the confirmation says", () => {
  it("names the page rather than counting it", () => {
    const sentence = describeUsages([usage("Quarterly review")]);
    // A confirmation that says "used in 1 place" asks the owner to accept a
    // consequence they cannot see.
    expect(sentence).toContain("Quarterly review");
    expect(sentence).toContain("one place");
  });

  it("names every distinct page when there are several", () => {
    const sentence = describeUsages([usage("Alpha"), usage("Beta"), usage("Gamma")]);
    expect(sentence).toContain("Alpha");
    expect(sentence).toContain("Beta");
    expect(sentence).toContain("Gamma");
    expect(sentence).toContain("3 places");
  });

  it("counts places but does not repeat a page name", () => {
    // The same page embedding a file twice is two places and one page: both
    // numbers are true and they are not the same number.
    const twice = usage("Handbook", "embed");
    const sentence = describeUsages([twice, { ...twice, blockId: generateUuidV7() }]);
    expect(sentence).toContain("2 places");
    expect(sentence.match(/Handbook/g)).toHaveLength(1);
  });

  it("says plainly when nothing uses it", () => {
    expect(describeUsages([])).toContain("Nothing uses this file");
  });
});
