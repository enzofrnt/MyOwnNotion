/**
 * What the shortcut lists select and how they order it (T053, US3, FR-012).
 *
 * The interesting claim is the one about recents: that ordering items by their
 * current revision identifier orders them by when they last changed. That holds
 * only because revision ids are UUIDv7, whose leading bits are a millisecond
 * timestamp — so it is worth a test that would fail loudly if that ever stopped
 * being true, rather than a comment asserting it.
 */

import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { favouritesOf, recentsOf } from "../src/features/navigation/sidebar.tsx";

function item(name: string, favourite: boolean, revisionId = generateUuidV7()): ProjectedItem {
  return {
    id: generateUuidV7(),
    kind: "page",
    name,
    lifecycle: "active",
    currentRevisionId: revisionId,
    trashedAt: null,
    purgeAfter: null,
    favourite,
    pageDocument: null,
    file: null,
    placements: [],
  } as ProjectedItem;
}

describe("favourites", () => {
  it("selects only marked items, ordered by name", () => {
    const items = [item("Zebra", true), item("Apple", true), item("Middle", false)];
    expect(favouritesOf(items).map((entry) => entry.name)).toEqual(["Apple", "Zebra"]);
  });

  it("is empty rather than absent when nothing is marked", () => {
    expect(favouritesOf([item("Apple", false)])).toEqual([]);
  });
});

describe("recents", () => {
  it("puts the most recently changed item first", async () => {
    // Generated in order with a real gap between them, because the claim under
    // test is that the identifiers themselves carry the ordering.
    const first = generateUuidV7();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = generateUuidV7();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const third = generateUuidV7();

    const ordered = recentsOf([
      item("oldest", false, first),
      item("newest", false, third),
      item("middle", false, second),
    ]);
    expect(ordered.map((entry) => entry.name)).toEqual(["newest", "middle", "oldest"]);
  });

  it("stops at five, so a shortcut list stays a shortcut", () => {
    const items = Array.from({ length: 9 }, (_, index) => item(`page ${index}`, false));
    expect(recentsOf(items)).toHaveLength(5);
  });

  it("does not depend on whether anything is a favourite", () => {
    // The two lists answer different questions. A page can be in both, and
    // starring something must not move it in the recents order.
    const items = [item("starred", true), item("plain", false)];
    expect(recentsOf(items)).toHaveLength(2);
  });
});
