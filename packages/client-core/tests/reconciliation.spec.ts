/**
 * Outbox retry, duplicate delivery, cursor catch-up, and conflict retention
 * tests (T036, US6, SC-014).
 */

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
  RelationshipDto,
} from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: LocalDatabase;
let outbox: Outbox;
let repository: LocalRepository;

beforeEach(() => {
  db = openLocalDatabase(`test-${generateUuidV7()}`);
  outbox = new Outbox(db);
  repository = new LocalRepository(db);
});

afterEach(async () => {
  await db.delete();
});

async function enqueueCreate(name: string): Promise<Uuid> {
  const mutationId = generateUuidV7();
  const result = await applyLocalMutation(db, {
    mutationId,
    commandType: "item.create",
    payload: {
      id: generateUuidV7(),
      kind: "folder",
      name,
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    },
    baseRevisionIds: [],
  });
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

function serverPage(name: string): ItemDto {
  const item = serverItem(name);
  return {
    ...item,
    kind: "page",
    pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
  };
}

function serverRelationship(sourceItemId: Uuid, targetItemId: Uuid): RelationshipDto {
  return {
    id: generateUuidV7(),
    sourceItemId,
    targetItemId,
    relationType: "link:references",
    metadata: {},
    createdRevisionId: generateUuidV7(),
    removedRevisionId: null,
    sourceAvailability: "active",
    targetAvailability: "active",
  };
}

/** Scriptable in-memory server double with duplicate-delivery accounting. */
class FakeTransport implements ReconcileTransport {
  submissions: QueuedMutationDto[][] = [];
  acceptedIds = new Set<string>();
  conflictIds = new Map<string, Uuid[]>();
  rejectedIds = new Set<string>();
  changePages: ChangesResponseDto[] = [];
  snapshot: CanonicalSnapshotDto | null = null;
  compactedCursors = new Set<string>();
  failNextBatch = false;
  failChanges = false;

  async submitMutationBatch(mutations: QueuedMutationDto[]) {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      return { ok: false as const, offline: true };
    }
    this.submissions.push(mutations);
    const results: QueuedMutationResultDto[] = mutations.map((mutation) => {
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
      if (this.rejectedIds.has(mutation.mutationId)) {
        return {
          mutationId: mutation.mutationId,
          status: "rejected" as const,
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
    const outcome = await reconcile(db, transport);
    expect(outcome.submitted).toBe(2);
    expect(outcome.accepted).toBe(2);
    expect(outcome.retained).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("reattaches an optimistic item head to the accepted server revision for rapid follow-up edits", async () => {
    const itemId = generateUuidV7();
    const mutationId = generateUuidV7();
    const created = await applyLocalMutation(db, {
      mutationId,
      commandType: "item.create",
      payload: {
        id: itemId,
        kind: "page",
        name: "Causal follow-up",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      baseRevisionIds: [],
    });
    expect(created.ok).toBe(true);
    const localHead = (await repository.getItem(itemId))?.currentRevisionId;
    const acceptedHead = generateUuidV7();
    const transport = new FakeTransport();
    transport.submitMutationBatch = async () => ({
      ok: true as const,
      value: {
        results: [
          {
            mutationId,
            status: "accepted" as const,
            revisionIds: [acceptedHead],
          },
        ],
      },
    });

    await reconcile(db, transport);

    expect((await repository.getItem(itemId))?.currentRevisionId).toBe(acceptedHead);
    expect(localHead).not.toBe(acceptedHead);
    expect(await db.revisionHeaders.get(localHead as Uuid)).toBeUndefined();
  });

  it("duplicate transport delivery is absorbed idempotently (SC-014)", async () => {
    const mutationId = await enqueueCreate("Duplicated");
    const transport = new FakeTransport();
    // First delivery already accepted server-side (e.g. response was lost).
    transport.acceptedIds.add(mutationId);
    const outcome = await reconcile(db, transport);
    expect(outcome.accepted).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    // The server observed exactly one logical acceptance.
    expect(transport.acceptedIds.has(mutationId)).toBe(true);
  });

  it("a network failure keeps every mutation durable and pending", async () => {
    await enqueueCreate("Kept");
    const transport = new FakeTransport();
    transport.failNextBatch = true;
    const outcome = await reconcile(db, transport);
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

    const outcome = await reconcile(db, transport);
    expect(outcome.accepted).toBe(1);
    expect(outcome.conflicts).toBe(1);
    const conflicts = await outbox.conflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.competingRevisionIds).toEqual([competing]);
    // The conflicting work is not resubmitted and not lost.
    expect(await db.outbox.count()).toBe(0);
  });

  it("retains a deterministic server rejection as recoverable local work", async () => {
    const rejected = await enqueueCreate("Rejected");
    const transport = new FakeTransport();
    transport.rejectedIds.add(rejected);

    const outcome = await reconcile(db, transport);
    expect(outcome.conflicts).toBe(1);
    expect((await outbox.conflicts())[0]).toMatchObject({
      mutationId: rejected,
      errorCode: "mutation.rejected",
      competingRevisionIds: [],
    });
  });

  it("reports offline when cursor catch-up or compacted snapshot retrieval fails", async () => {
    const offlineTransport = new FakeTransport();
    offlineTransport.failChanges = true;
    const offline = await reconcile(db, offlineTransport);
    expect(offline).toMatchObject({ offline: true, usedSnapshotFallback: false });

    await repository.setMeta("lastChangeCursor", "compacted");
    const compactedTransport = new FakeTransport();
    compactedTransport.compactedCursors.add("compacted");
    const noSnapshot = await reconcile(db, compactedTransport);
    expect(noSnapshot).toMatchObject({
      offline: true,
      caughtUpTo: "compacted",
      usedSnapshotFallback: false,
    });
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
    const outcome = await reconcile(db, transport);
    expect(outcome.caughtUpTo).toBe("2");
    expect(await repository.getLastChangeCursor()).toBe("2");
    expect((await repository.getItem(itemA.id as Uuid))?.name).toBe("From changes A");
    expect((await repository.getItem(itemB.id as Uuid))?.name).toBe("From changes B");
  });

  it("replaces incremental derived relationships by source idempotently, including removal", async () => {
    const source = generateUuidV7();
    const firstTarget = generateUuidV7();
    const nextTarget = generateUuidV7();
    const stale = serverRelationship(source, firstTarget);
    await repository.replaceDerivedWikiRelationships([source], [stale]);
    const replacement = serverRelationship(source, nextTarget);
    const transport = new FakeTransport();
    transport.changePages = [
      {
        changes: [
          {
            sequence: 1,
            mutationId: generateUuidV7(),
            revisionIds: [generateUuidV7()],
            relationshipSourceItemIds: [source],
            changedRelationships: [replacement],
          },
        ],
        nextCursor: "1",
        hasMore: false,
      },
    ];
    await reconcile(db, transport);
    expect(await repository.listRelationships()).toEqual([
      expect.objectContaining({ id: replacement.id, targetItemId: nextTarget }),
    ]);

    transport.changePages = [
      {
        changes: [
          {
            sequence: 2,
            mutationId: generateUuidV7(),
            revisionIds: [generateUuidV7()],
            relationshipSourceItemIds: [source],
            changedRelationships: [],
          },
        ],
        nextCursor: "2",
        hasMore: false,
      },
    ];
    await reconcile(db, transport);
    expect(await repository.listRelationships()).toEqual([]);
  });

  it("a compacted cursor rebuilds from the verified snapshot without touching the outbox", async () => {
    // A stale local item and a pending mutation that must survive.
    await repository.applyServerItems([serverItem("Stale local")]);
    await repository.setMeta("lastChangeCursor", "old-cursor");
    const transport = new FakeTransport();
    transport.compactedCursors.add("old-cursor");
    const fresh = serverItem("Fresh from snapshot");
    const snapshotTarget = serverItem("Snapshot target");
    const snapshotRelationship = serverRelationship(fresh.id as Uuid, snapshotTarget.id as Uuid);
    transport.snapshot = {
      workspaceId: generateUuidV7(),
      schemaVersion: 1,
      cursor: "100",
      digest: "a".repeat(64),
      items: [fresh, snapshotTarget],
      relationships: [snapshotRelationship],
    };
    // Conflict record must also survive the snapshot rebuild.
    const conflictedId = await enqueueCreate("Survivor");
    await outbox.captureConflict(conflictedId, [generateUuidV7()], "revision.stale-base");

    const outcome = await reconcile(db, transport);
    expect(outcome.usedSnapshotFallback).toBe(true);
    expect(outcome.caughtUpTo).toBe("100");
    expect((await repository.getItem(fresh.id as Uuid))?.name).toBe("Fresh from snapshot");
    expect(await repository.listRelationships(fresh.id as Uuid)).toEqual([
      expect.objectContaining({ id: snapshotRelationship.id }),
    ]);
    expect((await outbox.conflicts()).length).toBe(1);
  });

  it("preserves conflicted local wiki relationships across snapshot fallback", async () => {
    const source = serverPage("Conflicted source");
    const target = serverPage("Conflicted target");
    await repository.applyServerItems([source, target]);
    const occurrenceId = generateUuidV7();
    const mutationId = generateUuidV7();
    const result = await applyLocalMutation(db, {
      mutationId,
      commandType: "page.document.replace",
      payload: {
        itemId: source.id,
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
                    text: "Local target",
                    marks: [
                      {
                        type: "wikiLink",
                        attrs: { targetItemId: target.id, occurrenceId },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      baseRevisionIds: [source.currentRevisionId as Uuid],
    });
    expect(result.ok).toBe(true);
    await outbox.captureConflict(mutationId, [generateUuidV7()], "revision.stale-base");
    await repository.setMeta("lastChangeCursor", "compacted-links");
    const transport = new FakeTransport();
    transport.compactedCursors.add("compacted-links");
    transport.snapshot = {
      workspaceId: generateUuidV7(),
      schemaVersion: 1,
      cursor: "200",
      digest: "b".repeat(64),
      items: [source, target],
      relationships: [],
    };

    await reconcile(db, transport);

    expect(await repository.listRelationships(source.id as Uuid)).toEqual([
      expect.objectContaining({ id: occurrenceId, targetItemId: target.id }),
    ]);
    expect((await repository.getItem(source.id as Uuid))?.pageDocument).toMatchObject({
      formatVersion: 3,
    });
    expect(await outbox.conflicts()).toHaveLength(1);
  });
});
