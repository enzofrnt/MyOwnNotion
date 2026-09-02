import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  navigationIdentityKey,
  replaceProjectedItem,
} from "../src/features/hierarchy/navigation-item-signature.ts";

function item(id: Uuid, overrides: Partial<ProjectedItem> = {}): ProjectedItem {
  return {
    id,
    kind: "page",
    name: "Notes",
    icon: null,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    trashedAt: null,
    purgeAfter: null,
    favourite: false,
    offlineIntent: false,
    localAvailability: "present",
    pageDocument: { format: "myownnotion.document+json", formatVersion: 3, body: { blocks: [] } },
    file: null,
    placements: [
      {
        id: generateUuidV7(),
        itemId: id,
        kind: "hierarchy",
        parentItemId: null,
        parentKey: "root",
        positionKey: "a0",
      },
    ],
    ...overrides,
  } as ProjectedItem;
}

describe("navigationIdentityKey", () => {
  it("ignores page body and revision changes that should not rebuild the tree", () => {
    const id = generateUuidV7();
    const first = item(id);
    const typed = item(id, {
      currentRevisionId: generateUuidV7(),
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: 3,
        body: { blocks: [{ type: "paragraph", content: "hello" }] },
      },
      placements: first.placements,
    });
    expect(navigationIdentityKey(first)).toBe(navigationIdentityKey(typed));
  });

  it("changes when the owner renames, moves or stars an item", () => {
    const id = generateUuidV7();
    const first = item(id);
    expect(navigationIdentityKey(first)).not.toBe(
      navigationIdentityKey(item(id, { name: "Renamed" })),
    );
    expect(navigationIdentityKey(first)).not.toBe(
      navigationIdentityKey(item(id, { favourite: true })),
    );
  });
});

describe("replaceProjectedItem", () => {
  it("does not report a catalog change for a body-only upsert", () => {
    const id = generateUuidV7();
    const current = item(id);
    const typed = item(id, {
      currentRevisionId: generateUuidV7(),
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: 3,
        body: { text: "later" },
      },
      placements: current.placements,
    });
    const result = replaceProjectedItem([current], [], id, typed);
    expect(result.catalogChanged).toBe(false);
  });

  it("moves a trashed item into the trash catalog", () => {
    const id = generateUuidV7();
    const current = item(id);
    const trashed = item(id, { lifecycle: "trashed", trashedAt: "2026-01-01T00:00:00.000Z" });
    const result = replaceProjectedItem([current], [], id, trashed);
    expect(result.catalogChanged).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.trashed).toHaveLength(1);
  });
});
