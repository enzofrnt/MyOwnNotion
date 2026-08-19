/**
 * Sealed projection rows in the real local store (T052, US4, FR-012, FR-024).
 *
 * The unit tests prove the envelope. These prove the thing that actually
 * protects the owner: that what lands in IndexedDB carries no readable
 * content, and that sealing did not disturb a single identity the projection
 * reconciles on.
 *
 * They run against fake-indexeddb, which implements real transaction and
 * structured-clone semantics, so a value that cannot survive storage fails
 * here rather than in a browser.
 */

import {
  type ConflictRecordRow,
  LocalCipher,
  type LocalDatabase,
  type LocalItemRow,
  LocalKeyManager,
  LocalRecordCodec,
  type LocalRelationshipRow,
  MemorySecureStorage,
  type OutboxMutationRow,
  openLocalDatabase,
  PRESERVED_ITEM_IDENTITY_FIELDS,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const installationId = "018f2b7c-0000-7000-8000-000000000001";
const workspaceId = generateUuidV7();

let db: LocalDatabase;
let codec: LocalRecordCodec;
let keys: LocalKeyManager;

function itemRow(overrides: Partial<LocalItemRow> = {}): LocalItemRow {
  return {
    id: generateUuidV7(),
    kind: "page",
    name: "Redundancy consultation notes",
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    trashedAt: null,
    purgeAfter: null,
    favourite: false,
    offlineIntent: false,
    localAvailability: "present",
    pageDocument: {
      format: "myownnotion.document+json",
      formatVersion: 1,
      body: { blocks: [{ type: "paragraph", text: "Headcount reduction of 12%" }] },
    },
    file: null,
    ...overrides,
  };
}

beforeEach(async () => {
  db = openLocalDatabase(`local-encryption-${generateUuidV7()}`);
  keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  codec = new LocalRecordCodec(new LocalCipher(keys), { installationId, workspaceId });
});

afterEach(async () => {
  db.close();
});

describe("what reaches IndexedDB", () => {
  it("stores no readable title or body", async () => {
    // The whole point. Someone with the browser profile — a shared laptop, a
    // stolen one, a forensic image — gets ciphertext and structure, not prose.
    const row = itemRow();
    await db.items.put(await codec.sealItem(row));

    const stored = JSON.stringify(await db.items.toArray());
    expect(stored).not.toContain("Redundancy");
    expect(stored).not.toContain("consultation");
    expect(stored).not.toContain("Headcount");
    expect(stored).not.toContain("12%");
  });

  it("keeps every identity the projection reconciles on", async () => {
    // FR-024: sealing must not fork identity. A sealed row keeps the same
    // primary key and revision pointer, or reconciliation against the server
    // silently starts creating duplicates.
    const row = itemRow();
    const sealed = await codec.sealItem(row);

    for (const field of PRESERVED_ITEM_IDENTITY_FIELDS) {
      expect(sealed[field]).toBe(row[field]);
    }
  });

  it("returns the original row when opened", async () => {
    const row = itemRow();
    await db.items.put(await codec.sealItem(row));
    const stored = (await db.items.get(row.id)) as never;

    expect(await codec.openItem(stored)).toEqual(row);
  });

  it("still lists and filters items while sealed", async () => {
    // Lifecycle and kind stay in the clear precisely so this works without
    // unlocking anything: a folder listing must not need the device key.
    const active = await codec.sealItem(itemRow());
    const trashed = await codec.sealItem(itemRow({ lifecycle: "trashed" }));
    await db.items.bulkPut([active, trashed]);

    const stillActive = await db.items.where("lifecycle").equals("active").toArray();
    expect(stillActive).toHaveLength(1);
    expect(stillActive[0]?.id).toBe(active.id);
  });
});

describe("structured database payloads", () => {
  it("seals definitions and entry values under distinct versioned bindings", async () => {
    const databaseId = generateUuidV7();
    const titlePropertyId = generateUuidV7();
    const textPropertyId = generateUuidV7();
    const viewId = generateUuidV7();
    const entryItemId = generateUuidV7();
    const definition = {
      format: "myownnotion.database-definition+json" as const,
      formatVersion: 1 as const,
      databaseId,
      properties: [
        {
          id: titlePropertyId,
          name: "Titre confidentiel",
          type: "title" as const,
          positionKey: "a",
          state: "active" as const,
          config: {},
        },
        {
          id: textPropertyId,
          name: "Décision sensible",
          type: "text" as const,
          positionKey: "b",
          state: "active" as const,
          config: {},
        },
      ],
      views: [
        {
          id: viewId,
          name: "Vue privée",
          type: "table" as const,
          positionKey: "a",
          state: "active" as const,
          properties: [],
          filter: { mode: "all" as const, criteria: [] },
          sorts: [],
          group: null,
          options: { density: "comfortable" as const, freezeTitle: true },
        },
      ],
      taskRoles: null,
    };
    const values = {
      format: "myownnotion.database-entry-values+json" as const,
      formatVersion: 1 as const,
      databaseId,
      entryId: entryItemId,
      values: { [textPropertyId]: { kind: "text" as const, value: "Plan de réorganisation" } },
      preserved: [],
    };

    const sealedDatabase = await codec.sealDatabase({
      itemId: databaseId,
      definitionVersion: 3,
      definition,
    });
    const sealedEntry = await codec.sealDatabaseEntry({
      entryItemId,
      databaseId,
      valueVersion: 7,
      availability: "present",
      values,
    });
    const stored = JSON.stringify({ sealedDatabase, sealedEntry });
    expect(stored).not.toContain("confidentiel");
    expect(stored).not.toContain("réorganisation");
    expect(await codec.openDatabase(sealedDatabase)).toEqual({
      itemId: databaseId,
      definitionVersion: 3,
      definition,
    });
    expect(await codec.openDatabaseEntry(sealedEntry)).toEqual({
      entryItemId,
      databaseId,
      valueVersion: 7,
      availability: "present",
      values,
    });
  });
});

describe("the queued work and the conflicts", () => {
  it("seals an outbox payload without disturbing its ordering fields", async () => {
    // The outbox is the least obvious leak: it holds the text of every edit
    // made offline, in the clear, until it is sent.
    const mutation: OutboxMutationRow = {
      mutationId: generateUuidV7(),
      commandType: "page.update",
      payload: { text: "Termination letter draft" },
      baseRevisionIds: [generateUuidV7()],
      localRevisionIds: [generateUuidV7()],
      status: "pending",
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
      enqueueOrder: 7,
    };

    const sealed = await codec.sealOutbox(mutation);
    await db.outbox.put(sealed as unknown as OutboxMutationRow);

    const stored = JSON.stringify(await db.outbox.toArray());
    expect(stored).not.toContain("Termination");
    // Order and status drive sending; sealing them would break the queue.
    expect(sealed.enqueueOrder).toBe(7);
    expect(sealed.status).toBe("pending");
    expect(await codec.openOutbox(sealed)).toEqual(mutation);
  });

  it("seals a conflict payload", async () => {
    const conflict: ConflictRecordRow = {
      mutationId: generateUuidV7(),
      commandType: "page.update",
      payload: { text: "Disputed severance figure" },
      baseRevisionIds: [],
      localRevisionIds: [],
      competingRevisionIds: [generateUuidV7()],
      capturedAt: new Date().toISOString(),
      errorCode: "revision.conflict",
    };

    const sealed = await codec.sealConflict(conflict);
    await db.conflicts.put(sealed as unknown as ConflictRecordRow);

    expect(JSON.stringify(await db.conflicts.toArray())).not.toContain("severance");
    expect(await codec.openConflict(sealed)).toEqual(conflict);
  });

  it("seals relationship metadata but not its endpoints", async () => {
    const relationship: LocalRelationshipRow = {
      id: generateUuidV7(),
      sourceItemId: generateUuidV7() as Uuid,
      targetItemId: generateUuidV7() as Uuid,
      relationType: "mentions",
      metadata: { note: "raised in the compensation review" },
    };

    const sealed = await codec.sealRelationship(relationship);
    await db.relationships.put(sealed as unknown as LocalRelationshipRow);

    const stored = JSON.stringify(await db.relationships.toArray());
    expect(stored).not.toContain("compensation");
    // The graph edge itself stays traversable without the key.
    expect(sealed.sourceItemId).toBe(relationship.sourceItemId);
    expect(sealed.targetItemId).toBe(relationship.targetItemId);
    expect(await codec.openRelationship(sealed)).toEqual(relationship);
  });
});

describe("when the key is not available", () => {
  it("refuses to open a stored row while locked, and leaves it intact", async () => {
    const row = itemRow();
    const sealed = await codec.sealItem(row);
    await db.items.put(sealed);

    keys.lock();
    await expect(codec.openItem(sealed)).rejects.toThrow();

    // The row is still there. Locking must never be destructive.
    expect(await db.items.get(row.id)).toBeDefined();
    await keys.establish();
    expect(await codec.openItem(sealed)).toEqual(row);
  });
});
