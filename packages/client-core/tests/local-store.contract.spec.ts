/**
 * Local schema and projection contract tests (T034, US6, FR-037).
 */

import type { LocalRecordCodec } from "@myownnotion/client-core";
import {
  LOCAL_SCHEMA_VERSION,
  type LocalDatabase,
  LocalDatabaseRepository,
  LocalRepository,
  META_KEYS,
  openLocalDatabase,
} from "@myownnotion/client-core";
import type { ItemDto } from "@myownnotion/contracts";
import { createInitialDatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
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

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`test-${generateUuidV7()}`);
  repository = new LocalRepository(db, codec);
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
      "databaseEntries",
      "databases",
      "items",
      "legacyOfflineBranches",
      "legacySyncRecoveries",
      "meta",
      "outbox",
      "pageAmbiguities",
      "pageOperationStates",
      "pageOperationUpdates",
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

  it("replaces all canonical structured sets atomically without clearing local work", async () => {
    const databaseId = generateUuidV7();
    const entryId = generateUuidV7();
    const targetId = generateUuidV7();
    const relationshipId = generateUuidV7();
    const definition = createInitialDatabaseDefinition({
      type: "database.create",
      id: databaseId,
      name: "Synced database",
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
      titlePropertyId: generateUuidV7(),
      initialViewId: generateUuidV7(),
      initialViewName: "Synced table",
    });
    const mutationId = generateUuidV7();
    await db.outbox.put({
      mutationId,
      commandType: "item.rename",
      payload: { itemId: entryId, name: "Local name" },
      baseRevisionIds: [],
      localRevisionIds: [],
      status: "pending",
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
      enqueueOrder: 1,
    });
    await db.conflicts.put({
      mutationId: generateUuidV7(),
      commandType: "page.document.replace",
      payload: { itemId: entryId },
      baseRevisionIds: [],
      localRevisionIds: [],
      competingRevisionIds: [],
      capturedAt: new Date().toISOString(),
      errorCode: "mutation.conflict",
    });

    await repository.replaceFromSnapshot({
      workspaceId: generateUuidV7(),
      schemaVersion: 1,
      cursor: "structured-42",
      items: [
        itemDto({ id: databaseId, name: "Synced database" }),
        itemDto({ id: entryId, name: "Synced entry" }),
        itemDto({ id: targetId, name: "Target" }),
      ],
      relationships: [
        {
          id: relationshipId,
          sourceItemId: entryId,
          targetItemId: targetId,
          relationType: "database:property",
          metadata: { databaseId, propertyId: generateUuidV7() },
          createdRevisionId: generateUuidV7(),
          removedRevisionId: null,
        },
      ],
      databases: [{ itemId: databaseId, definitionVersion: 1, definition: definition as never }],
      databaseEntries: [
        {
          entryItemId: entryId,
          databaseId,
          valueVersion: 1,
          values: {
            format: "myownnotion.database-entry-values+json",
            formatVersion: 1,
            databaseId,
            entryId,
            values: {},
            preserved: [],
          },
        },
      ],
    });

    const databases = new LocalDatabaseRepository(db, codec);
    expect((await databases.getDatabase(databaseId))?.definition).toEqual(definition);
    expect(await databases.getEntry(entryId)).toMatchObject({
      databaseId,
      availability: "present",
    });
    expect(await db.relationships.get(relationshipId)).toMatchObject({
      sourceItemId: entryId,
      targetItemId: targetId,
    });
    expect(await db.outbox.get(mutationId)).toBeDefined();
    expect(await db.conflicts.count()).toBe(1);
    expect(await repository.getLastChangeCursor()).toBe("structured-42");
  });

  it("replaces an item's outgoing relationship set and cursor in one change", async () => {
    const sourceId = generateUuidV7();
    const targetId = generateUuidV7();
    const staleRelationshipId = generateUuidV7();
    await repository.applyServerItems([
      itemDto({ id: sourceId, name: "Source" }),
      itemDto({ id: targetId, name: "Target" }),
    ]);
    await db.relationships.put({
      id: staleRelationshipId,
      sourceItemId: sourceId,
      targetItemId: targetId,
      relationType: "sync:stale",
      metadata: {},
    });

    await repository.applyServerChange({
      cursor: "43",
      items: [itemDto({ id: sourceId, name: "Source renamed" })],
      relationships: [],
      databases: [],
      databaseEntries: [],
    });

    expect(await db.relationships.get(staleRelationshipId)).toBeUndefined();
    expect((await repository.getItem(sourceId))?.name).toBe("Source renamed");
    expect(await repository.getLastChangeCursor()).toBe("43");
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
