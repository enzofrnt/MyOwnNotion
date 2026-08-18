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
      // A stale base, and only while it *is* stale. The real server accepts a
      // resubmission once its base names the current head, which is exactly what
      // the automatic merge does before requeuing — a double that refused
      // regardless of base would make a correct merge look like a failed one.
      const rebasedOntoHead =
        conflict !== undefined &&
        conflict.length > 0 &&
        conflict.every((revisionId) => mutation.baseRevisionIds.includes(revisionId));
      if (conflict !== undefined && !rebasedOntoHead) {
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

  /**
   * Revision snapshots the automatic merge reads (feature 006).
   *
   * Absent by default, and that absence is itself behaviour worth having: a
   * transport without this method attempts no merge and records a conflict, which
   * is what every test written before the merge existed relies on.
   */
  revisions = new Map<string, Record<string, unknown> | null>();

  async getRevision(revisionId: Uuid) {
    if (!this.revisions.has(revisionId)) {
      return { ok: false as const, offline: false };
    }
    return {
      ok: true as const,
      value: { snapshot: this.revisions.get(revisionId) } as never,
    };
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

/**
 * Merging instead of asking (T025, FR-013).
 *
 * The point of these two is the difference between them. Both are refusals from
 * the server for the same reason — the base is no longer the head — and only one
 * of them is a question for the owner. Getting that wrong in either direction has
 * a cost: asking about every reconnection teaches somebody that the question is
 * noise, and merging a genuine divergence decides on their behalf.
 */
describe("the automatic merge (feature 006)", () => {
  const BLOCK_A = "01a10000-0000-7000-8000-0000000b100a";
  const BLOCK_B = "01a10000-0000-7000-8000-0000000b100b";

  function body(blocks: Array<{ id: string; text: string }>) {
    return {
      blocks: blocks.map((block) => ({
        id: block.id,
        type: "paragraph",
        content: [{ text: block.text }],
      })),
    };
  }

  /** Queues an edit whose base the server will report as stale. */
  async function enqueueEdit(
    itemId: Uuid,
    baseRevisionId: Uuid,
    blocks: Array<{ id: string; text: string }>,
  ): Promise<Uuid> {
    const mutationId = generateUuidV7();
    const result = await applyLocalMutation(
      db,
      {
        mutationId,
        commandType: "page.document.replace",
        payload: {
          itemId,
          baseRevisionId,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: body(blocks),
          },
          pageLinkTargetIds: [],
        },
        baseRevisionIds: [baseRevisionId],
      },
      () => new Date(),
      codec,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return mutationId;
  }

  async function pageWithBody(blocks: Array<{ id: string; text: string }>): Promise<Uuid> {
    const itemId = generateUuidV7();
    const created = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: itemId,
          kind: "page",
          name: "Merged",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
          pageDocument: {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: body(blocks),
          },
        },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    expect(created.ok).toBe(true);
    return itemId;
  }

  it("requeues the merged edit when the two sides touched different blocks", async () => {
    const ancestorId = generateUuidV7();
    const remoteId = generateUuidV7();
    const itemId = await pageWithBody([{ id: BLOCK_A, text: "one" }]);
    // Local added B; remote edited A. Nothing is contested.
    const mutationId = await enqueueEdit(itemId, ancestorId, [
      { id: BLOCK_A, text: "one" },
      { id: BLOCK_B, text: "added locally" },
    ]);

    const transport = new FakeTransport();
    transport.conflictIds.set(mutationId, [remoteId]);
    transport.revisions.set(ancestorId, {
      pageDocument: { body: body([{ id: BLOCK_A, text: "one" }]) },
    });
    transport.revisions.set(remoteId, {
      pageDocument: { body: body([{ id: BLOCK_A, text: "edited remotely" }]) },
    });

    const outcome = await reconcile(db, transport, codec);

    // Nothing to ask about, and nothing left queued: the merged edit was rebased
    // onto the head that refused it and accepted on the next submission within
    // the same pass.
    expect(outcome.conflicts).toBe(0);
    expect(await db.conflicts.count()).toBe(0);
    expect(await db.outbox.get(mutationId)).toBeUndefined();

    // And what reached the server carried both sides. Asserting the outcome
    // alone would pass for a merge that quietly dropped one of them, which is
    // the failure worth catching.
    const resubmitted = transport.submissions
      .flat()
      .filter((submitted) => submitted.mutationId === mutationId);
    const last = resubmitted[resubmitted.length - 1];
    expect(last?.baseRevisionIds).toEqual([remoteId]);
    expect(JSON.stringify(last?.payload)).toContain("edited remotely");
    expect(JSON.stringify(last?.payload)).toContain("added locally");
  });

  it("records a conflict when both sides changed the same block", async () => {
    const ancestorId = generateUuidV7();
    const remoteId = generateUuidV7();
    const itemId = await pageWithBody([{ id: BLOCK_A, text: "original" }]);
    const mutationId = await enqueueEdit(itemId, ancestorId, [
      { id: BLOCK_A, text: "written here" },
    ]);

    const transport = new FakeTransport();
    transport.conflictIds.set(mutationId, [remoteId]);
    transport.revisions.set(ancestorId, {
      pageDocument: { body: body([{ id: BLOCK_A, text: "original" }]) },
    });
    transport.revisions.set(remoteId, {
      pageDocument: { body: body([{ id: BLOCK_A, text: "written there" }]) },
    });

    const outcome = await reconcile(db, transport, codec);

    // The owner decides. A merge here would pick a winner between two people's
    // words, which no rule can do without being wrong half the time.
    expect(outcome.conflicts).toBe(1);
    expect(await db.conflicts.count()).toBe(1);
  });

  it("records a conflict when the common ancestor is no longer retained", async () => {
    const ancestorId = generateUuidV7();
    const remoteId = generateUuidV7();
    const itemId = await pageWithBody([{ id: BLOCK_A, text: "original" }]);
    const mutationId = await enqueueEdit(itemId, ancestorId, [
      { id: BLOCK_A, text: "written here" },
    ]);

    const transport = new FakeTransport();
    transport.conflictIds.set(mutationId, [remoteId]);
    // The ancestor's snapshot passed its retention window: only the remote is
    // readable. Without the common state there is no three-way comparison, and
    // guessing would be guessing about somebody's words.
    transport.revisions.set(remoteId, {
      pageDocument: { body: body([{ id: BLOCK_A, text: "written there" }]) },
    });

    const outcome = await reconcile(db, transport, codec);
    expect(outcome.conflicts).toBe(1);
  });
});
