/**
 * Outbox retry, duplicate delivery, cursor catch-up, and conflict retention
 * tests (T036, US6, SC-014).
 */

import type { LocalRecordCodec } from "@myownnotion/client-core";
import {
  applyLocalMutation,
  type LocalDatabase,
  LocalRepository,
  Outbox,
  openLocalDatabase,
  type ReconcileTransport,
  reconcile,
} from "@myownnotion/client-core";
import type {
  CanonicalSnapshotDto,
  ChangesResponseDto,
  ItemDto,
  QueuedMutationDto,
  QueuedMutationResultDto,
} from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let outbox: Outbox;
let repository: LocalRepository;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`test-${generateUuidV7()}`);
  outbox = new Outbox(db);
  repository = new LocalRepository(db, codec);
});

afterEach(async () => {
  await db.delete();
});

async function enqueueCreate(name: string): Promise<Uuid> {
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

function serverItem(name: string): ItemDto {
  const id = generateUuidV7();
  return {
    id,
    kind: "folder",
    name,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    placements: [
      { id: generateUuidV7(), itemId: id, kind: "hierarchy", parentItemId: null, positionKey: "V" },
    ],
  } as ItemDto;
}

/** Scriptable in-memory server double with duplicate-delivery accounting. */
class FakeTransport implements ReconcileTransport {
  submissions: QueuedMutationDto[][] = [];
  acceptedIds = new Set<string>();
  conflictIds = new Map<string, Uuid[]>();
  changePages: ChangesResponseDto[] = [];
  snapshot: CanonicalSnapshotDto | null = null;
  compactedCursors = new Set<string>();
  failNextBatch = false;
  /** Mutations the server rejects deterministically (not a conflict). */
  rejectIds = new Set<string>();
  /** Drops the problem detail so the client must supply a default code. */
  omitProblemDetail = false;
  /** Makes ordered catch-up fail as a plain transport loss. */
  failChanges = false;

  async submitMutationBatch(mutations: QueuedMutationDto[]) {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      return { ok: false as const, offline: true };
    }
    this.submissions.push(mutations);
    const results: QueuedMutationResultDto[] = mutations.map((mutation) => {
      if (this.rejectIds.has(mutation.mutationId)) {
        return {
          mutationId: mutation.mutationId,
          status: "rejected" as const,
          ...(this.omitProblemDetail
            ? {}
            : {
                problem: {
                  type: "about:blank",
                  title: "rejected",
                  status: 422,
                  code: "validation.invalid-payload",
                },
              }),
        };
      }
      const conflict = this.conflictIds.get(mutation.mutationId);
      if (conflict !== undefined) {
        return {
          mutationId: mutation.mutationId,
          status: "conflict" as const,
          competingRevisionIds: conflict,
          problem: {
            type: "about:blank",
            title: "conflict",
            status: 409,
            code: "revision.stale-base",
          },
        };
      }
      // Idempotent server: a re-delivered id replays already-accepted.
      const already = this.acceptedIds.has(mutation.mutationId);
      this.acceptedIds.add(mutation.mutationId);
      return {
        mutationId: mutation.mutationId,
        status: already ? ("already-accepted" as const) : ("accepted" as const),
        revisionIds: [generateUuidV7()],
      };
    });
    return { ok: true as const, value: { results } };
  }

  async listChanges(after: string) {
    if (this.failChanges) {
      return { ok: false as const, offline: true };
    }
    if (this.compactedCursors.has(after)) {
      return { ok: false as const, offline: false, compacted: true };
    }
    const page = this.changePages.shift();
    if (page === undefined) {
      return {
        ok: true as const,
        value: { changes: [], nextCursor: after, hasMore: false },
      };
    }
    return { ok: true as const, value: page };
  }

  async currentSnapshot() {
    if (this.snapshot === null) {
      return { ok: false as const, offline: true };
    }
    return { ok: true as const, value: this.snapshot };
  }
}

describe("reconciliation (T044)", () => {
  it("submits pending mutations once logically and acknowledges them", async () => {
    await enqueueCreate("One");
    await enqueueCreate("Two");
    const transport = new FakeTransport();
    const outcome = await reconcile(db, transport, codec);
    expect(outcome.submitted).toBe(2);
    expect(outcome.accepted).toBe(2);
    expect(outcome.retained).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("duplicate transport delivery is absorbed idempotently (SC-014)", async () => {
    const mutationId = await enqueueCreate("Duplicated");
    const transport = new FakeTransport();
    // First delivery already accepted server-side (e.g. response was lost).
    transport.acceptedIds.add(mutationId);
    const outcome = await reconcile(db, transport, codec);
    expect(outcome.accepted).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    // The server observed exactly one logical acceptance.
    expect(transport.acceptedIds.has(mutationId)).toBe(true);
  });

  it("a network failure keeps every mutation durable and pending", async () => {
    await enqueueCreate("Kept");
    const transport = new FakeTransport();
    transport.failNextBatch = true;
    const outcome = await reconcile(db, transport, codec);
    expect(outcome.offline).toBe(true);
    expect(outcome.retained).toBe(1);
    const pending = await outbox.pending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.status).toBe("pending");
  });

  it("a competing revision produces a durable conflict record (FR-042)", async () => {
    const conflicted = await enqueueCreate("Conflicted");
    await enqueueCreate("Fine");
    const transport = new FakeTransport();
    const competing = generateUuidV7();
    transport.conflictIds.set(conflicted, [competing]);

    const outcome = await reconcile(db, transport, codec);
    expect(outcome.accepted).toBe(1);
    expect(outcome.conflicts).toBe(1);
    const conflicts = await outbox.conflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.competingRevisionIds).toEqual([competing]);
    // The conflicting work is not resubmitted and not lost.
    expect(await db.outbox.count()).toBe(0);
  });

  it("catches up through ordered change pages and persists the cursor", async () => {
    const transport = new FakeTransport();
    const itemA = serverItem("From changes A");
    const itemB = serverItem("From changes B");
    transport.changePages = [
      {
        changes: [
          {
            sequence: 1,
            mutationId: generateUuidV7(),
            revisionIds: [generateUuidV7()],
            changedItems: [itemA],
          },
        ],
        nextCursor: "1",
        hasMore: true,
      },
      {
        changes: [
          {
            sequence: 2,
            mutationId: generateUuidV7(),
            revisionIds: [generateUuidV7()],
            changedItems: [itemB],
          },
        ],
        nextCursor: "2",
        hasMore: false,
      },
    ];
    const outcome = await reconcile(db, transport, codec);
    expect(outcome.caughtUpTo).toBe("2");
    expect(await repository.getLastChangeCursor()).toBe("2");
    expect((await repository.getItem(itemA.id as Uuid))?.name).toBe("From changes A");
    expect((await repository.getItem(itemB.id as Uuid))?.name).toBe("From changes B");
  });

  it("a compacted cursor rebuilds from the verified snapshot without touching the outbox", async () => {
    // A stale local item and a pending mutation that must survive.
    await repository.applyServerItems([serverItem("Stale local")]);
    await repository.setMeta("lastChangeCursor", "old-cursor");
    const transport = new FakeTransport();
    transport.compactedCursors.add("old-cursor");
    const fresh = serverItem("Fresh from snapshot");
    transport.snapshot = {
      workspaceId: generateUuidV7(),
      schemaVersion: 1,
      cursor: "100",
      digest: "a".repeat(64),
      items: [fresh],
      relationships: [],
    };
    // Conflict record must also survive the snapshot rebuild.
    const conflictedId = await enqueueCreate("Survivor");
    await outbox.captureConflict(conflictedId, [generateUuidV7()], "revision.stale-base");

    const outcome = await reconcile(db, transport, codec);
    expect(outcome.usedSnapshotFallback).toBe(true);
    expect(outcome.caughtUpTo).toBe("100");
    expect((await repository.getItem(fresh.id as Uuid))?.name).toBe("Fresh from snapshot");
    expect((await outbox.conflicts()).length).toBe(1);
  });

  it("a deterministic rejection is retained durably instead of being dropped", async () => {
    const rejected = await enqueueCreate("Rejected");
    const transport = new FakeTransport();
    transport.rejectIds.add(rejected);

    const outcome = await reconcile(db, transport, codec);
    expect(outcome.conflicts).toBe(1);
    expect(outcome.accepted).toBe(0);
    const conflicts = await outbox.conflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.errorCode).toBe("validation.invalid-payload");
    // The local work is recoverable, never silently discarded (FR-042).
    expect(await db.outbox.count()).toBe(0);
  });

  it("defaults the failure code when a rejection carries no problem detail", async () => {
    const rejected = await enqueueCreate("Bare rejection");
    const transport = new FakeTransport();
    transport.rejectIds.add(rejected);
    transport.omitProblemDetail = true;

    await reconcile(db, transport, codec);
    expect((await outbox.conflicts())[0]?.errorCode).toBe("mutation.rejected");
  });

  it("stays offline and keeps the cursor when catch-up cannot reach the server", async () => {
    await repository.setMeta("lastChangeCursor", "42");
    const transport = new FakeTransport();
    transport.failChanges = true;

    const outcome = await reconcile(db, transport, codec);
    expect(outcome.offline).toBe(true);
    expect(outcome.usedSnapshotFallback).toBe(false);
    // The durable cursor is preserved so the next attempt resumes in place.
    expect(outcome.caughtUpTo).toBe("42");
    expect(await repository.getLastChangeCursor()).toBe("42");
  });

  it("reports offline when the compacted-cursor snapshot is also unreachable", async () => {
    await repository.setMeta("lastChangeCursor", "old-cursor");
    const pending = await enqueueCreate("Must survive");
    const transport = new FakeTransport();
    transport.compactedCursors.add("old-cursor");
    transport.snapshot = null; // snapshot request fails too

    const outcome = await reconcile(db, transport, codec);
    expect(outcome.offline).toBe(true);
    expect(outcome.usedSnapshotFallback).toBe(false);
    expect(outcome.caughtUpTo).toBe("old-cursor");
    // The mutation was accepted before catch-up, so it is no longer queued,
    // but nothing was lost: it is acknowledged, not dropped.
    expect(transport.acceptedIds.has(pending)).toBe(true);
  });
});
