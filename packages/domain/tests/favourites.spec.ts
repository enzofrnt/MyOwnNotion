/**
 * Favourites as a rule rather than a button (feature 003, FR-012).
 *
 * Two things are worth pinning down at this level, because both are cheap to
 * get wrong in the interface and expensive to notice there: that the command
 * names a state instead of toggling one, and that the trash is not somewhere a
 * shortcut may point.
 */

import { describe, expect, it } from "vitest";
import {
  type CanonicalItem,
  generateUuidV7,
  parseMutationCommand,
  validateFavouriteItem,
} from "../src/index.ts";

function itemWith(lifecycle: CanonicalItem["lifecycle"]): CanonicalItem {
  return {
    id: generateUuidV7(),
    kind: "page",
    name: "Consultation notes",
    lifecycle,
    currentRevisionId: generateUuidV7(),
  } as CanonicalItem;
}

function viewOf(item: CanonicalItem) {
  return {
    getItem: (id: string) => (id === item.id ? item : null),
    getActivePlacements: () => [],
    getActiveChildren: () => [],
  } as Parameters<typeof validateFavouriteItem>[0];
}

describe("the favourite command", () => {
  it("carries the state being asked for, so a replay is idempotent", () => {
    const itemId = generateUuidV7();
    const parsed = parseMutationCommand("item.favourite", { itemId, favourite: true });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toEqual({ type: "item.favourite", itemId, favourite: true });
  });

  it("refuses a missing or non-boolean state rather than guessing one", () => {
    const itemId = generateUuidV7();
    // Not defaulted to `true`: a caller that omits the field has said nothing,
    // and inventing an answer is how an item becomes a favourite without anyone
    // asking for it.
    expect(parseMutationCommand("item.favourite", { itemId }).ok).toBe(false);
    expect(parseMutationCommand("item.favourite", { itemId, favourite: "yes" }).ok).toBe(false);
  });
});

describe("what may be favourited", () => {
  it("marks and unmarks an active item", () => {
    const item = itemWith("active");
    for (const favourite of [true, false]) {
      const result = validateFavouriteItem(viewOf(item), { itemId: item.id, favourite });
      expect(result.ok).toBe(true);
      expect(result.ok && result.value.favourite).toBe(favourite);
    }
  });

  it("refuses a trashed item in both directions", () => {
    const item = itemWith("trashed");
    // Unmarking is refused too, and deliberately: a trashed item is already out
    // of every shortcut list, so there is nothing for an unmark to achieve, and
    // allowing it would mean a favourites list that can point into the trash.
    for (const favourite of [true, false]) {
      const result = validateFavouriteItem(viewOf(item), { itemId: item.id, favourite });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe("item.not-active");
    }
  });

  it("reports a missing item rather than succeeding silently", () => {
    const result = validateFavouriteItem(viewOf(itemWith("active")), {
      itemId: generateUuidV7(),
      favourite: true,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("item.not-found");
  });
});
