/**
 * Local schema and projection contract tests (T034, US6, FR-037).
 */

import {
  LOCAL_SCHEMA_VERSION,
  type LocalDatabase,
  LocalRepository,
  META_KEYS,
  openLocalDatabase,
} from "@myownnotion/client-core";
import type { ItemDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: LocalDatabase;
let repository: LocalRepository;

function itemDto(overrides: Partial<ItemDto> & { id: string; name: string }): ItemDto {
  return {
    kind: "page",
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
    placements: [
      {
        id: generateUuidV7(),
        itemId: overrides.id,
        kind: "hierarchy",
        parentItemId: null,
        positionKey: "V",
      },
    ],
    ...overrides,
  } as ItemDto;
}

beforeEach(() => {
  db = openLocalDatabase(`test-${generateUuidV7()}`);
  repository = new LocalRepository(db);
});

afterEach(async () => {
  await db.delete();
});

describe("versioned local schema (T020)", () => {
  it("opens with the declared schema version", async () => {
    await db.open();
    expect(db.verno).toBe(LOCAL_SCHEMA_VERSION);
    const tables = db.tables.map((table) => table.name).sort();
    expect(tables).toEqual([
      "conflicts",
      "items",
      "meta",
      "outbox",
      "placements",
      "relationships",
      "revisionHeaders",
    ]);
  });
});

describe("projection reads and writes (T039)", () => {
  it("applies server items transactionally and reads them back", async () => {
    const id = generateUuidV7();
    await repository.applyServerItems([itemDto({ id, name: "Page A" })]);
    const item = await repository.getItem(id);
    expect(item?.name).toBe("Page A");
    expect(item?.placements.length).toBe(1);
  });

  it("re-applying an item replaces its placements without duplication", async () => {
    const id = generateUuidV7();
    await repository.applyServerItems([itemDto({ id, name: "First" })]);
    await repository.applyServerItems([itemDto({ id, name: "Renamed" })]);
    const item = await repository.getItem(id);
    expect(item?.name).toBe("Renamed");
    expect(item?.placements.length).toBe(1);
  });

  it("lists children in explicit position-key order", async () => {
    const parent = generateUuidV7();
    await repository.applyServerItems([
      itemDto({ id: parent, name: "Parent", kind: "folder", pageDocument: null }),
    ]);
    const childA = generateUuidV7();
    const childB = generateUuidV7();
    await repository.applyServerItems([
      itemDto({
        id: childB,
        name: "Second",
        placements: [
          {
            id: generateUuidV7(),
            itemId: childB,
            kind: "hierarchy",
            parentItemId: parent,
            positionKey: "W",
          },
        ],
      }),
      itemDto({
        id: childA,
        name: "First",
        placements: [
          {
            id: generateUuidV7(),
            itemId: childA,
            kind: "hierarchy",
            parentItemId: parent,
            positionKey: "M",
          },
        ],
      }),
    ]);
    const children = await repository.listChildren(parent as Uuid);
    expect(children.map((child) => child.name)).toEqual(["First", "Second"]);
  });

  it("replaces the projection from a verified snapshot and persists the cursor", async () => {
    const stale = generateUuidV7();
    await repository.applyServerItems([itemDto({ id: stale, name: "Stale" })]);
    const fresh = generateUuidV7();
    await repository.replaceFromSnapshot({
      workspaceId: generateUuidV7(),
      schemaVersion: 1,
      cursor: "42",
      items: [itemDto({ id: fresh, name: "Fresh" })],
    });
    expect(await repository.getItem(stale as Uuid)).toBeNull();
    expect((await repository.getItem(fresh as Uuid))?.name).toBe("Fresh");
    expect(await repository.getLastChangeCursor()).toBe("42");
    expect(await repository.getMeta(META_KEYS.schemaVersion)).toBe(1);
  });

  it("keeps stable identities across projection updates (FR-037)", async () => {
    const id = generateUuidV7();
    const first = itemDto({ id, name: "Identity" });
    await repository.applyServerItems([first]);
    await repository.applyServerItems([
      itemDto({ id, name: "Identity Renamed", currentRevisionId: generateUuidV7() }),
    ]);
    const item = await repository.getItem(id as Uuid);
    expect(item?.id).toBe(id);
  });
});
