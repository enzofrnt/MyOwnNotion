/**
 * Atomic local-state/outbox fault-injection tests (T035, US6, FR-038,
 * SC-013): success is reported only when the optimistic state AND the
 * durable outbox entry are both persisted; failures leave no partial state.
 */

import {
  applyLocalMutation,
  type LocalDatabase,
  LocalRepository,
  newLocalRevision,
  Outbox,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: LocalDatabase;
let repository: LocalRepository;
let outbox: Outbox;

beforeEach(() => {
  db = openLocalDatabase(`test-${generateUuidV7()}`);
  repository = new LocalRepository(db);
  outbox = new Outbox(db);
});

afterEach(async () => {
  await db.delete();
});

async function snapshotCounts() {
  return {
    items: await db.items.count(),
    placements: await db.placements.count(),
    outbox: await db.outbox.count(),
    revisions: await db.revisionHeaders.count(),
  };
}

describe("atomic optimistic mutation + outbox (T040)", () => {
  it("persists projection change and outbox entry together", async () => {
    const itemId = generateUuidV7();
    const result = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: {
        id: itemId,
        kind: "folder",
        name: "Offline folder",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [],
    });
    expect(result.ok).toBe(true);
    const item = await repository.getItem(itemId as Uuid);
    expect(item?.name).toBe("Offline folder");
    const pending = await outbox.pending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.localRevisionIds.length).toBe(1);
  });

  it("an invalid command leaves zero partial writes", async () => {
    const before = await snapshotCounts();
    const result = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: { id: "not-a-uuid", kind: "folder", name: "x" },
      baseRevisionIds: [],
    });
    expect(result.ok).toBe(false);
    expect(await snapshotCounts()).toEqual(before);
  });

  it("a local validation failure mid-command aborts the whole transaction", async () => {
    const before = await snapshotCounts();
    const result = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "item.rename",
      payload: { itemId: generateUuidV7(), name: "ghost" },
      baseRevisionIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
    expect(await snapshotCounts()).toEqual(before);
  });

  it("cycle rejection offline leaves the projection untouched", async () => {
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: {
        id: parentId,
        kind: "folder",
        name: "P",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [],
    });
    await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: {
        id: childId,
        kind: "folder",
        name: "C",
        placement: { kind: "hierarchy", parentItemId: parentId, positionKey: "V" },
      },
      baseRevisionIds: [],
    });
    const parentPlacement = (await db.placements.where("itemId").equals(parentId).toArray())[0];
    const before = await snapshotCounts();
    const result = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "placement.move",
      payload: {
        placementId: parentPlacement?.id,
        parentItemId: childId,
        positionKey: "X",
      },
      baseRevisionIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.cycle-rejected");
    }
    expect(await snapshotCounts()).toEqual(before);
  });

  it("re-submitting the same mutation id is a no-op (stable identity)", async () => {
    const mutationId = generateUuidV7();
    const payload = {
      id: generateUuidV7(),
      kind: "folder" as const,
      name: "Once",
      placement: { kind: "hierarchy" as const, parentItemId: null, positionKey: "V" },
    };
    const first = await applyLocalMutation(db, {
      mutationId,
      commandType: "item.create",
      payload,
      baseRevisionIds: [],
    });
    const second = await applyLocalMutation(db, {
      mutationId,
      commandType: "item.create",
      payload,
      baseRevisionIds: [],
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.localRevisionIds).toEqual(first.value.localRevisionIds);
    }
    expect(await db.outbox.count()).toBe(1);
    expect(await db.items.count()).toBe(1);
  });

  it("storage failure surfaces visibly and never reports success (SC-013)", async () => {
    // Fault injection: make the outbox table's add reject like a quota error.
    const original = db.outbox.add.bind(db.outbox);
    const quotaError = new Error("quota");
    quotaError.name = "QuotaExceededError";
    (db.outbox as { add: unknown }).add = () => Promise.reject(quotaError);

    const before = await snapshotCounts();
    const result = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Will fail",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [],
    });
    (db.outbox as { add: unknown }).add = original;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("storage.quota-exceeded");
    }
    // The aborted transaction rolled the projection write back too.
    expect(await snapshotCounts()).toEqual(before);
  });

  it("rolls back a document, its derived link, and revision when outbox storage fails", async () => {
    const sourceId = generateUuidV7();
    const targetId = generateUuidV7();
    for (const [id, name] of [
      [sourceId, "Atomic source"],
      [targetId, "Atomic target"],
    ] as const) {
      const created = await applyLocalMutation(db, {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id,
          kind: "page",
          name,
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        },
        baseRevisionIds: [],
      });
      expect(created.ok).toBe(true);
    }
    const source = await repository.getItem(sourceId);
    if (source === null) {
      throw new Error("Atomic source was not created");
    }
    const occurrenceId = generateUuidV7();
    const before = await snapshotCounts();
    const initialDocument = source.pageDocument;
    const original = db.outbox.add.bind(db.outbox);
    const quotaError = new Error("quota");
    quotaError.name = "QuotaExceededError";
    (db.outbox as { add: unknown }).add = () => Promise.reject(quotaError);

    const result = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "page.document.replace",
      payload: {
        itemId: sourceId,
        baseRevisionId: source.currentRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Atomic target",
                    marks: [{ type: "wikiLink", attrs: { targetItemId: targetId, occurrenceId } }],
                  },
                ],
              },
            ],
          },
        },
      },
      baseRevisionIds: [source.currentRevisionId],
    });
    (db.outbox as { add: unknown }).add = original;

    expect(result.ok).toBe(false);
    expect(await snapshotCounts()).toEqual(before);
    expect((await repository.getItem(sourceId))?.pageDocument).toEqual(initialDocument);
    expect(await db.relationships.get(occurrenceId)).toBeUndefined();
  });

  it("rolls back a version 4 task document and its revision when outbox storage fails", async () => {
    const itemId = generateUuidV7();
    const created = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: {
        id: itemId,
        kind: "page",
        name: "Atomic task page",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [],
    });
    expect(created.ok).toBe(true);
    const item = await repository.getItem(itemId);
    if (item === null) {
      throw new Error("Atomic task page was not created");
    }
    const beforeCounts = await snapshotCounts();
    const beforeDocument = item.pageDocument;
    const original = db.outbox.add.bind(db.outbox);
    const quotaError = new Error("quota");
    quotaError.name = "QuotaExceededError";
    (db.outbox as { add: unknown }).add = () => Promise.reject(quotaError);

    const result = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "page.document.replace",
      payload: {
        itemId,
        baseRevisionId: item.currentRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 4,
          body: {
            type: "doc",
            content: [
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: {
                      checked: false,
                      taskId: generateUuidV7(),
                      status: "in_progress",
                      dueDate: "2026-08-08",
                      priority: "high",
                    },
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: "Atomic task" }] },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      baseRevisionIds: [item.currentRevisionId],
    });
    (db.outbox as { add: unknown }).add = original;

    expect(result.ok).toBe(false);
    expect(await snapshotCounts()).toEqual(beforeCounts);
    expect((await repository.getItem(itemId))?.pageDocument).toEqual(beforeDocument);
  });

  it("applies the complete supported offline command lifecycle", async () => {
    const fixedNow = () => new Date("2026-08-07T12:00:00.000Z");
    const parentId = generateUuidV7();
    const pageId = generateUuidV7();
    const parentPlacementId = generateUuidV7();
    const pagePlacementId = generateUuidV7();

    for (const input of [
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: parentId,
          kind: "folder",
          name: "  Parent  ",
          placement: {
            id: parentPlacementId,
            kind: "hierarchy",
            parentItemId: null,
            positionKey: "A",
          },
        },
        baseRevisionIds: [],
      },
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: pageId,
          kind: "page",
          name: "Draft",
          placement: {
            id: pagePlacementId,
            kind: "hierarchy",
            parentItemId: parentId,
            positionKey: "B",
          },
        },
        baseRevisionIds: [],
      },
      {
        mutationId: generateUuidV7(),
        commandType: "item.rename",
        payload: { itemId: pageId, name: "  Published  " },
        baseRevisionIds: [],
      },
      {
        mutationId: generateUuidV7(),
        commandType: "page.document.replace",
        payload: {
          itemId: pageId,
          baseRevisionId: generateUuidV7(),
          document: {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: { text: "offline" },
          },
        },
        baseRevisionIds: [],
      },
      {
        mutationId: generateUuidV7(),
        commandType: "placement.move",
        payload: { placementId: pagePlacementId, parentItemId: null, positionKey: "C" },
        baseRevisionIds: [],
      },
    ]) {
      const result = await applyLocalMutation(db, input, fixedNow);
      expect(result.ok).toBe(true);
    }

    expect(await repository.getItem(parentId)).toMatchObject({ name: "Parent" });
    expect(await repository.getItem(pageId)).toMatchObject({
      name: "Published",
      pageDocument: { body: { text: "offline" } },
    });
    expect(await db.placements.get(pagePlacementId)).toMatchObject({
      parentItemId: null,
      parentKey: "root",
      positionKey: "C",
    });

    const relationId = generateUuidV7();
    const createRelation = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "relationship.create",
        payload: {
          id: relationId,
          sourceItemId: parentId,
          targetItemId: pageId,
          relationType: "references",
        },
        baseRevisionIds: [],
      },
      fixedNow,
    );
    expect(createRelation.ok).toBe(true);
    expect(await db.relationships.get(relationId)).toMatchObject({ metadata: {} });

    const removeRelation = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "relationship.remove",
        payload: { relationshipId: relationId },
        baseRevisionIds: [],
      },
      fixedNow,
    );
    expect(removeRelation.ok).toBe(true);
    expect(await db.relationships.get(relationId)).toBeUndefined();

    const trash = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.trash",
        payload: { itemId: parentId },
        baseRevisionIds: [],
      },
      fixedNow,
    );
    expect(trash.ok).toBe(true);
    expect(await repository.getItem(parentId)).toMatchObject({
      lifecycle: "trashed",
      trashedAt: "2026-08-07T12:00:00.000Z",
    });

    const restore = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.restore",
        payload: { itemId: parentId },
        baseRevisionIds: [],
      },
      fixedNow,
    );
    expect(restore.ok).toBe(true);
    expect(await repository.getItem(parentId)).toMatchObject({
      lifecycle: "active",
      trashedAt: null,
      purgeAfter: null,
    });
  });

  it("rejects unavailable local targets and server-only commands atomically", async () => {
    const folderId = generateUuidV7();
    const create = await applyLocalMutation(db, {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: {
        id: folderId,
        kind: "folder",
        name: "Folder",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "A" },
      },
      baseRevisionIds: [],
    });
    expect(create.ok).toBe(true);

    const cases = [
      {
        commandType: "page.document.replace",
        payload: {
          itemId: folderId,
          baseRevisionId: generateUuidV7(),
          document: {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: {},
          },
        },
        code: "item.not-found",
      },
      {
        commandType: "placement.move",
        payload: {
          placementId: generateUuidV7(),
          parentItemId: null,
          positionKey: "A",
        },
        code: "placement.not-found",
      },
      {
        commandType: "relationship.remove",
        payload: { relationshipId: generateUuidV7() },
        code: "item.not-found",
      },
      {
        commandType: "placement.remove",
        payload: { placementId: generateUuidV7() },
        code: "validation.invalid-payload",
      },
    ];

    for (const testCase of cases) {
      const before = await snapshotCounts();
      const result = await applyLocalMutation(db, {
        mutationId: generateUuidV7(),
        commandType: testCase.commandType,
        payload: testCase.payload,
        baseRevisionIds: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(testCase.code);
      }
      expect(await snapshotCounts()).toEqual(before);
    }
  });
});

describe("durable retry states (T041)", () => {
  it("recovers interrupted sending rows to pending after restart", async () => {
    const mutationId = generateUuidV7();
    await applyLocalMutation(db, {
      mutationId,
      commandType: "item.create",
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Interrupted",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [],
    });
    await outbox.markSending([mutationId]);
    expect((await outbox.pending()).length).toBe(0);

    const recovered = await outbox.recoverInterrupted();
    expect(recovered).toBe(1);
    const pending = await outbox.pending();
    expect(pending.length).toBe(1);
    // The identity never changes across retries (FR-040).
    expect(pending[0]?.mutationId).toBe(mutationId);
  });

  it("conflict capture retains payload, bases, and competing revisions (FR-042)", async () => {
    const mutationId = generateUuidV7();
    const base = generateUuidV7();
    await applyLocalMutation(db, {
      mutationId,
      commandType: "item.create",
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Conflicted",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [base],
    });
    const competing = generateUuidV7();
    await outbox.captureConflict(mutationId, [competing], "revision.stale-base");

    expect((await outbox.pending()).length).toBe(0);
    const conflicts = await outbox.conflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.mutationId).toBe(mutationId);
    expect(conflicts[0]?.baseRevisionIds).toEqual([base]);
    expect(conflicts[0]?.competingRevisionIds).toEqual([competing]);
    expect(conflicts[0]?.errorCode).toBe("revision.stale-base");
    expect(conflicts[0]?.payload["name"]).toBe("Conflicted");
  });

  it("exposes stable outbox lookup and the local revision helper", async () => {
    const mutationId = generateUuidV7();
    await applyLocalMutation(db, {
      mutationId,
      commandType: "item.create",
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Lookup",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [],
    });
    expect((await outbox.get(mutationId))?.mutationId).toBe(mutationId);
    expect((await outbox.all()).map((row) => row.mutationId)).toEqual([mutationId]);
    expect(await outbox.get(generateUuidV7())).toBeNull();

    const local = newLocalRevision(db, generateUuidV7(), [], () => new Date(0));
    await local.write();
    expect(await db.revisionHeaders.get(local.id)).toMatchObject({
      acceptedAt: "1970-01-01T00:00:00.000Z",
      local: 1,
    });
  });
});
