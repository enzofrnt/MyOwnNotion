/**
 * Durable outbox accessors and retry states (T041, US6, FR-039/FR-042).
 *
 * The queue survives interruption without ever regenerating a mutation ID, so
 * server-side replay stays idempotent. `all()` backs the visible pending list
 * in the UI and must expose in-flight rows too, not only pending ones.
 */

import type { LocalRecordCodec } from "@myownnotion/client-core";
import {
  applyLocalMutation,
  type LocalDatabase,
  Outbox,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let outbox: Outbox;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`test-${generateUuidV7()}`);
  outbox = new Outbox(db, codec);
});

afterEach(async () => {
  await db.delete();
});

async function enqueue(name: string): Promise<Uuid> {
  const mutationId = generateUuidV7();
  const result = await applyLocalMutation(
    db,
    {
      mutationId,
      commandType: "item.create",
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name,
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [],
    },
    () => new Date(),
    codec,
  );
  expect(result.ok).toBe(true);
  return mutationId;
}

describe("all()", () => {
  it("returns every row in stable enqueue order", async () => {
    const first = await enqueue("First");
    const second = await enqueue("Second");
    const third = await enqueue("Third");

    expect((await outbox.all()).map((row) => row.mutationId)).toEqual([first, second, third]);
  });

  it("includes in-flight rows so the UI can show them as synchronizing", async () => {
    const mutationId = await enqueue("In flight");
    await outbox.markSending([mutationId]);

    expect(await outbox.pending()).toEqual([]);
    const all = await outbox.all();
    expect(all.length).toBe(1);
    expect(all[0]?.status).toBe("sending");
  });

  it("is empty for a fresh database", async () => {
    expect(await outbox.all()).toEqual([]);
  });
});

describe("get()", () => {
  it("returns the durable row for a queued mutation", async () => {
    const mutationId = await enqueue("Queued");
    const row = await outbox.get(mutationId);
    expect(row?.mutationId).toBe(mutationId);
    expect(row?.commandType).toBe("item.create");
    expect(row?.status).toBe("pending");
  });

  it("returns null for an unknown mutation", async () => {
    expect(await outbox.get(generateUuidV7())).toBeNull();
  });
});

describe("retry lifecycle", () => {
  it("records an attempt timestamp without changing the mutation ID", async () => {
    const mutationId = await enqueue("Retried");
    const attemptedAt = new Date("2026-08-09T12:00:00.000Z");
    await outbox.markSending([mutationId], () => attemptedAt);

    const row = await outbox.get(mutationId);
    expect(row?.mutationId).toBe(mutationId);
    expect(row?.lastAttemptAt).toBe(attemptedAt.toISOString());
  });

  it("recovers interrupted in-flight rows to pending after a restart", async () => {
    const first = await enqueue("One");
    const second = await enqueue("Two");
    await outbox.markSending([first, second]);

    const recovered = await outbox.recoverInterrupted();
    expect(recovered).toBe(2);
    // Same identities, still in order: replay stays idempotent (FR-040).
    expect((await outbox.pending()).map((row) => row.mutationId)).toEqual([first, second]);
  });

  it("recovers nothing when no attempt was interrupted", async () => {
    await enqueue("Untouched");
    expect(await outbox.recoverInterrupted()).toBe(0);
  });

  it("returns a failed attempt to pending while keeping it durable", async () => {
    const mutationId = await enqueue("Failed once");
    await outbox.markSending([mutationId]);
    await outbox.markPendingAgain(mutationId);

    const pending = await outbox.pending();
    expect(pending.map((row) => row.mutationId)).toEqual([mutationId]);
    expect(pending[0]?.status).toBe("pending");
  });

  it("atomically replaces a terminally refused command with a fresh rebased identity", async () => {
    const refusedMutationId = await enqueue("Needs a merge");
    const replacementMutationId = generateUuidV7();
    const newBaseRevisionId = generateUuidV7();
    const refused = await outbox.get(refusedMutationId);
    const localRevisionId = refused?.localRevisionIds[0] as Uuid;
    await outbox.markSending([refusedMutationId]);

    await outbox.requeueMerged(
      refusedMutationId,
      replacementMutationId,
      { ...refused?.payload, name: "Merged" },
      [newBaseRevisionId],
    );

    expect(await outbox.get(refusedMutationId)).toBeNull();
    expect(await outbox.get(replacementMutationId)).toMatchObject({
      mutationId: replacementMutationId,
      status: "pending",
      lastAttemptAt: null,
      baseRevisionIds: [newBaseRevisionId],
      localRevisionIds: refused?.localRevisionIds,
    });
    expect((await db.revisionHeaders.get(localRevisionId))?.mutationId).toBe(replacementMutationId);
  });

  it("drops the optimistic local revision headers on acknowledgement", async () => {
    const mutationId = await enqueue("Accepted");
    const row = await outbox.get(mutationId);
    const localRevisionId = row?.localRevisionIds[0] as Uuid;
    expect(await db.revisionHeaders.get(localRevisionId)).toBeDefined();

    await outbox.acknowledge(mutationId);

    expect(await outbox.get(mutationId)).toBeNull();
    // Server state supersedes the optimistic header.
    expect(await db.revisionHeaders.get(localRevisionId)).toBeUndefined();
  });

  it("atomically rebases queued dependants onto the acknowledged server revision", async () => {
    const createMutationId = await enqueue("Created then edited");
    const create = await outbox.get(createMutationId);
    const localCreateRevisionId = create?.localRevisionIds[0] as Uuid;
    const itemId = create?.payload["id"] as Uuid;
    const editMutationId = generateUuidV7();
    const edit = await applyLocalMutation(
      db,
      {
        mutationId: editMutationId,
        commandType: "item.rename",
        payload: {
          itemId,
          name: "Edited immediately",
          baseRevisionId: localCreateRevisionId,
        },
        baseRevisionIds: [localCreateRevisionId],
      },
      () => new Date(),
      codec,
    );
    expect(edit.ok).toBe(true);
    const localEditRevisionId = edit.ok ? edit.value.localRevisionIds[0] : undefined;
    const serverRevisionId = generateUuidV7();

    await outbox.acknowledge(createMutationId, [serverRevisionId]);

    expect(await outbox.get(editMutationId)).toMatchObject({
      baseRevisionIds: [serverRevisionId],
      payload: { baseRevisionId: serverRevisionId },
    });
    expect(
      localEditRevisionId === undefined
        ? undefined
        : (await db.revisionHeaders.get(localEditRevisionId))?.parentRevisionIds,
    ).toEqual([serverRevisionId]);
    expect(await db.revisionHeaders.get(localCreateRevisionId)).toMatchObject({
      local: 0,
      canonicalRevisionId: serverRevisionId,
    });
    expect((await db.items.get(itemId))?.currentRevisionId).toBe(localEditRevisionId);
  });

  it("rebases a stale in-memory caller that starts just after acknowledgement", async () => {
    const createMutationId = await enqueue("Created before acknowledgement");
    const create = await outbox.get(createMutationId);
    const localCreateRevisionId = create?.localRevisionIds[0] as Uuid;
    const itemId = create?.payload["id"] as Uuid;
    const serverRevisionId = generateUuidV7();

    await outbox.acknowledge(createMutationId, [serverRevisionId]);

    const editMutationId = generateUuidV7();
    const edit = await applyLocalMutation(
      db,
      {
        mutationId: editMutationId,
        commandType: "item.rename",
        // A mounted editor can still hold the optimistic revision for one
        // render after the acknowledgement advances the projection.
        payload: {
          itemId,
          name: "Edited from the stale render",
          baseRevisionId: localCreateRevisionId,
        },
        baseRevisionIds: [localCreateRevisionId],
      },
      () => new Date(),
      codec,
    );

    expect(edit.ok).toBe(true);
    expect(await outbox.get(editMutationId)).toMatchObject({
      baseRevisionIds: [serverRevisionId],
      payload: { baseRevisionId: serverRevisionId },
    });
  });

  it("acknowledging an unknown mutation is a no-op", async () => {
    await outbox.acknowledge(generateUuidV7());
    expect(await outbox.all()).toEqual([]);
  });
});

describe("captureConflict()", () => {
  it("preserves the command, payload, and causal bases in the conflict record", async () => {
    const mutationId = await enqueue("Conflicted");
    const competing = generateUuidV7();
    const capturedAt = new Date("2026-08-09T12:00:00.000Z");

    await outbox.captureConflict(mutationId, [competing], "revision.stale-base", () => capturedAt);

    const conflicts = await outbox.conflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]).toMatchObject({
      mutationId,
      commandType: "item.create",
      competingRevisionIds: [competing],
      errorCode: "revision.stale-base",
      capturedAt: capturedAt.toISOString(),
    });
    // Removed from the submission queue but not lost (FR-042).
    expect(await outbox.get(mutationId)).toBeNull();
  });

  it("capturing a conflict for an unknown mutation records nothing", async () => {
    await outbox.captureConflict(generateUuidV7(), [], "mutation.conflict");
    expect(await outbox.conflicts()).toEqual([]);
  });
});

describe("resolveConflict()", () => {
  it("drops the record the owner has decided about, and only that one", async () => {
    const mine = await enqueue("Mine");
    const other = await enqueue("Other");
    await outbox.captureConflict(mine, [generateUuidV7()], "revision.stale-base");
    await outbox.captureConflict(other, [generateUuidV7()], "revision.stale-base");

    await outbox.resolveConflict(mine);

    const remaining = await outbox.conflicts();
    expect(remaining.map((row) => row.mutationId)).toEqual([other]);
  });

  it("is silent about a conflict that is not there", async () => {
    // Two tabs can reach the same decision, and the second one arriving must
    // not raise. What must never happen is the opposite — a record removed by
    // anything other than a decision — and that is why nothing here expires or
    // tidies up in the background.
    await expect(outbox.resolveConflict(generateUuidV7())).resolves.toBeUndefined();
  });
});
