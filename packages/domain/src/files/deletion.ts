/**
 * What deleting a file would cost (T019, US2, FR-004).
 *
 * Pure, because the decision is the dangerous part and the dangerous part
 * should be testable without a browser. The interface asks this function what
 * would happen and reports the answer; it never decides for itself, so there is
 * one rule rather than one per screen.
 *
 * The rule is deliberately asymmetric. Deleting an unused file is ordinary and
 * proceeds like any other item going to the trash. Deleting a file something
 * still points at is refused until the owner has *seen what*, because the cost
 * of being wrong is not symmetrical either: a refused deletion wastes a few
 * seconds, and an unseen one leaves pages referring to something that is gone.
 */

import type { Uuid } from "../ids/uuid.ts";

/** One place that refers to the file, named so the owner can recognise it. */
export interface NamedUsage {
  readonly usedByItemId: Uuid;
  readonly usedByName: string;
  readonly usageKind: "attachment" | "embed" | "hierarchy";
  readonly blockId: Uuid | null;
}

export type DeletionPlan =
  /** Nothing points at it: delete it the way any item is deleted. */
  | { readonly kind: "proceed" }
  /**
   * Something still points at it. The owner must see these and say so.
   *
   * `usages` is carried in the plan rather than fetched again by the caller:
   * the list shown and the list the decision was made against are then
   * necessarily the same one.
   */
  | { readonly kind: "confirm-required"; readonly usages: readonly NamedUsage[] }
  /** Already gone, or never existed. */
  | { readonly kind: "not-found" };

export function planFileDeletion(input: {
  readonly fileExists: boolean;
  readonly usages: readonly NamedUsage[];
  /** True only when the owner has been shown the usages and accepted. */
  readonly confirmed: boolean;
}): DeletionPlan {
  if (!input.fileExists) {
    return { kind: "not-found" };
  }
  if (input.usages.length === 0) {
    return { kind: "proceed" };
  }
  // Confirmation is checked *after* usages are known, never instead of them.
  // A caller that could pass `confirmed: true` without ever fetching the list
  // would satisfy the letter of FR-004 while showing the owner nothing.
  return input.confirmed ? { kind: "proceed" } : { kind: "confirm-required", usages: input.usages };
}

/**
 * A sentence naming what would break, for the confirmation itself.
 *
 * Built here rather than in the component so the wording is covered by the same
 * tests as the rule. A confirmation that says "this file is used in 3 places"
 * without naming them asks the owner to accept a consequence they cannot see.
 */
export function describeUsages(usages: readonly NamedUsage[]): string {
  if (usages.length === 0) {
    return "Nothing uses this file.";
  }
  const names = [...new Set(usages.map((usage) => usage.usedByName))];
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const places = usages.length === 1 ? "one place" : `${usages.length} places`;
  return `This file is used in ${places}: ${listed}. Deleting it removes it from ${
    names.length === 1 ? "that page" : "those pages"
  }.`;
}
