/**
 * What a history entry calls a change (T037, FR-022).
 *
 * Short, and the interesting assertion is the last one. A history is read by the
 * person who wrote the change, not by somebody debugging a protocol, so an
 * unrecognised command must come out as words rather than as an identifier — and
 * a command added later must not be able to leak its internal name into a screen
 * an owner reads and exports.
 */

import { describe, expect, it } from "vitest";
import { COMMAND_TYPES, describeChangeNature } from "../src/index.ts";

describe("naming a change", () => {
  it("says what happened rather than how the server was asked", () => {
    expect(describeChangeNature("item.create")).toBe("created");
    expect(describeChangeNature("page.document.replace")).toBe("edited");
    expect(describeChangeNature("item.trash")).toBe("moved to trash");
  });

  it("names a resolution as itself", () => {
    // The one entry an owner goes looking for: the place two lines of work
    // rejoined. Calling it "edited" would hide it among ordinary edits.
    expect(describeChangeNature("document.resolve-conflict")).toBe("resolved a conflict");
  });

  it("gives every command this repository owns a phrase of its own", () => {
    for (const commandType of COMMAND_TYPES) {
      // Not the fallback: a command that reaches the history without a phrase is
      // a command whose entries all read "changed", which tells the owner
      // nothing about their own work.
      expect(describeChangeNature(commandType), commandType).not.toBe("changed");
    }
  });

  it("falls back to words, never to the identifier", () => {
    // Vague is the failure worth having. The alternative puts `workspace.explode`
    // in front of somebody with no way to interpret it.
    expect(describeChangeNature("workspace.explode")).toBe("changed");
    expect(describeChangeNature("")).toBe("changed");
  });
});
