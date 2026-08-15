/**
 * Atomic local-state/outbox fault-injection tests (T035, US6, FR-038,
 * SC-013): success is reported only when the optimistic state AND the
 * durable outbox entry are both persisted; failures leave no partial state.
 */

import type { LocalRecordCodec } from "@myownnotion/client-core";
import {
  applyLocalMutation,
  type LocalDatabase,
  LocalRepository,
  Outbox,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let repository: LocalRepository;
let outbox: Outbox;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`test-${generateUuidV7()}`);
  repository = new LocalRepository(db, codec);
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
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: itemId,
          kind: "folder",
          name: "Offline folder",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    expect(result.ok).toBe(true);
    const item = await repository.getItem(itemId as Uuid);
    expect(item?.name).toBe("Offline folder");
    const pending = await outbox.pending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.localRevisionIds.length).toBe(1);
  });

  it("an invalid command leaves zero partial writes", async () => {
    const before = await snapshotCounts();
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: { id: "not-a-uuid", kind: "folder", name: "x" },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    expect(result.ok).toBe(false);
    expect(await snapshotCounts()).toEqual(before);
  });

  it("a local validation failure mid-command aborts the whole transaction", async () => {
    const before = await snapshotCounts();
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.rename",
        payload: { itemId: generateUuidV7(), name: "ghost" },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
    expect(await snapshotCounts()).toEqual(before);
  });

  it("cycle rejection offline leaves the projection untouched", async () => {
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: parentId,
          kind: "folder",
          name: "P",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: childId,
          kind: "folder",
          name: "C",
          placement: { kind: "hierarchy", parentItemId: parentId, positionKey: "V" },
        },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    const parentPlacement = (await db.placements.where("itemId").equals(parentId).toArray())[0];
    const before = await snapshotCounts();
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "placement.move",
        payload: {
          placementId: parentPlacement?.id,
          parentItemId: childId,
          positionKey: "X",
        },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
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
    const first = await applyLocalMutation(
      db,
      {
        mutationId,
        commandType: "item.create",
        payload,
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    const second = await applyLocalMutation(
      db,
      {
        mutationId,
        commandType: "item.create",
        payload,
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
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
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: generateUuidV7(),
          kind: "folder",
          name: "Will fail",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    (db.outbox as { add: unknown }).add = original;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("storage.quota-exceeded");
    }
    // The aborted transaction rolled the projection write back too.
    expect(await snapshotCounts()).toEqual(before);
  });
});

describe("durable retry states (T041)", () => {
  it("recovers interrupted sending rows to pending after restart", async () => {
    const mutationId = generateUuidV7();
    await applyLocalMutation(
      db,
      {
        mutationId,
        commandType: "item.create",
        payload: {
          id: generateUuidV7(),
          kind: "folder",
          name: "Interrupted",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
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
    await applyLocalMutation(
      db,
      {
        mutationId,
        commandType: "item.create",
        payload: {
          id: generateUuidV7(),
          kind: "folder",
          name: "Conflicted",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        },
        baseRevisionIds: [base],
      },
      () => new Date(),
      codec,
    );
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
});
