/**
 * What the interface may claim about a document's safety (T038, US2).
 *
 * The rule these tests protect is FR-008: the interface must never say "saved"
 * before the server has confirmed. That is a property of *where the answer
 * comes from* — the outbox rows the reconciler acts on — rather than of any
 * particular wording, so it is tested here, at the level where being wrong
 * matters, and not through a screen.
 */

import type { OutboxMutationRow, OutboxStatus } from "@myownnotion/client-core";
import { deriveSaveState, rowsForItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

function row(status: OutboxStatus, extra: Partial<OutboxMutationRow> = {}): OutboxMutationRow {
  return {
    mutationId: generateUuidV7(),
    commandType: "page.document.replace",
    payload: { itemId: "item-1" },
    baseRevisionIds: [],
    localRevisionIds: [],
    status,
    createdAt: new Date().toISOString(),
    lastAttemptAt: null,
    enqueueOrder: 1,
    ...extra,
  };
}

describe("the four states", () => {
  it("reports saved only when nothing is queued", () => {
    // The absence of pending work, never a hopeful assumption. This is FR-008
    // in one assertion.
    expect(deriveSaveState([], true)).toEqual({ kind: "saved" });
  });

  it("reports unsaved while a change is pending", () => {
    expect(deriveSaveState([row("pending")], true)).toEqual({ kind: "unsaved", offline: false });
  });

  it("reports sending while a change is in flight", () => {
    expect(deriveSaveState([row("sending")], true)).toEqual({ kind: "sending" });
  });

  it("reports blocked with the server's reason", () => {
    const state = deriveSaveState(
      [row("blocked", { blockedReason: "Writes are paused during key rotation." })],
      true,
    );
    expect(state.kind).toBe("blocked");
    if (state.kind === "blocked") {
      expect(state.reason).toContain("key rotation");
      // And what to do about it, which is the half an owner cannot infer.
      expect(state.resolution).toContain("still readable");
    }
  });
});

describe("offline", () => {
  it("is a presentation of unsaved rather than a state of its own", () => {
    // The row is `pending` either way. Making offline its own state would put
    // connectivity and durability in one field, so "is my work safe" would
    // depend on "is there a network".
    const state = deriveSaveState([row("pending")], false);
    expect(state).toEqual({ kind: "unsaved", offline: true });
  });

  it("does not change a blocked state", () => {
    // Being offline does not make a refusal go away.
    expect(deriveSaveState([row("blocked")], false).kind).toBe("blocked");
  });
});

describe("precedence", () => {
  it("reports the worst of several rows", () => {
    // A document with one blocked write and three pending ones is blocked.
    // Reporting the cheerier of two true facts is the same failure as
    // reporting a false one.
    const state = deriveSaveState([row("pending"), row("sending"), row("blocked")], true);
    expect(state.kind).toBe("blocked");
  });

  it("prefers sending over pending", () => {
    expect(deriveSaveState([row("pending"), row("sending")], true).kind).toBe("sending");
  });

  it("never reports saved while anything is queued", () => {
    for (const status of ["pending", "sending", "blocked"] as const) {
      expect(deriveSaveState([row(status)], true).kind).not.toBe("saved");
    }
  });
});

describe("conflicts", () => {
  it("are not a save state", () => {
    // A conflict is a question for the owner, not a stage of saving, and it
    // has its own affordance under FR-011. Treating it as a save state would
    // make the indicator the place an owner is asked to choose between
    // versions, which it is not.
    expect(deriveSaveState([row("conflict")], true)).toEqual({ kind: "saved" });
  });
});

describe("rowsForItem", () => {
  it("selects only the rows belonging to one document", () => {
    const mine = row("pending");
    const other = row("pending", { payload: { itemId: "item-2" } });
    expect(rowsForItem([mine, other], "item-1")).toEqual([mine]);
  });
});
