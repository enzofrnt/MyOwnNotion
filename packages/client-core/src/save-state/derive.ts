/**
 * What the interface may say about a document's safety (T037, US2, FR-007 to FR-011).
 *
 * Derived from the outbox rather than tracked beside it, and that choice is the
 * requirement rather than a preference. A second source of truth for "is this
 * saved" is exactly how an interface comes to claim success it has not had —
 * the failure FR-008 forbids. Reading the same rows the reconciler acts on
 * means the statement and the reality cannot disagree.
 *
 * Pure, synchronous and total, so the rule can be tested without a browser, at
 * the level where being wrong actually matters.
 */

import type { OutboxMutationRow } from "../local-store/schema.ts";

export type SaveState =
  | { readonly kind: "saved" }
  /** Kept on this device. `offline` changes the wording, not the state. */
  | { readonly kind: "unsaved"; readonly offline: boolean }
  | { readonly kind: "sending" }
  | { readonly kind: "blocked"; readonly reason: string; readonly resolution: string };

/**
 * What the owner is told when the server refuses without saying why.
 *
 * Never blank: a refusal with no explanation is worse than one with a generic
 * explanation, because the owner cannot tell whether to wait, retry, or act.
 */
const DEFAULT_BLOCKED_REASON = "The server refused this change.";
const DEFAULT_RESOLUTION =
  "Your existing content is still readable. Check the server's status, or try again once it accepts changes.";

export function deriveSaveState(rows: readonly OutboxMutationRow[], online: boolean): SaveState {
  // Worst-first. A document with one blocked write and three pending ones is
  // blocked: reporting the cheerier of two true facts is the same failure as
  // reporting a false one.
  const blocked = rows.find((row) => row.status === "blocked");
  if (blocked !== undefined) {
    return {
      kind: "blocked",
      reason: blocked.blockedReason ?? DEFAULT_BLOCKED_REASON,
      resolution: DEFAULT_RESOLUTION,
    };
  }

  if (rows.some((row) => row.status === "sending")) {
    return { kind: "sending" };
  }

  if (rows.some((row) => row.status === "pending")) {
    // Offline is a presentation of `unsaved`, not a fifth state: the row is
    // `pending` either way, and putting connectivity and durability in one
    // field would make "is it safe" depend on "is there a network".
    return { kind: "unsaved", offline: !online };
  }

  // No rows for this item. `saved` is the absence of pending work, never a
  // hopeful assumption: the row is removed when the server confirms, and this
  // follows from the removal rather than from anything the client decided.
  //
  // A `conflict` row is deliberately not consulted. A conflict is a question
  // for the owner, not a stage of saving, and it surfaces through its own
  // affordance under FR-011.
  return { kind: "saved" };
}

/** The rows belonging to one item, for callers holding the whole queue. */
export function rowsForItem(
  rows: readonly OutboxMutationRow[],
  itemId: string,
): OutboxMutationRow[] {
  return rows.filter((row) => {
    const payload = row.payload as { itemId?: unknown };
    return payload.itemId === itemId;
  });
}
