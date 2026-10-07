/**
 * Outbox retry, duplicate delivery, cursor catch-up, and conflict retention
 * tests (T036, US6, SC-014).
 */

import type { LocalRecordCodec } from "@myownnotion/client-core";
import {
  applyLocalMutation,
  type LocalDatabase,
  LocalDatabaseRepository,
  LocalRepository,
  META_KEYS,
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
import { createInitialDatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let outbox: Outbox;
let repository: LocalRepository;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`test-${generateUuidV7()}`);
  outbox = new Outbox(db, codec);
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

function changeOf(
  sequence: number,
  changedItems?: ItemDto[],
): ChangesResponseDto["changes"][number] {
  return {
    sequence,
    mutationId: generateUuidV7(),
    revisionIds: [],
    ...(changedItems === undefined ? {} : { changedItems }),
  };
}

/** Scriptable in-memory server double with duplicate-delivery accounting. */
class FakeTransport implements ReconcileTransport {
  submissions: QueuedMutationDto[][] = [];
  acceptedIds = new Set<string>();
  conflictIds = new Map<string, Uuid[]>();
  terminalConflictIds = new Set<string>();
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
  /** Local work injected while the change-feed request is in flight. */
  beforeNextChangePage: (() => Promise<void>) | null = null;
  acceptedRevisions = new Map<string, Uuid>();

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
      if (
        conflict !== undefined &&
        (this.terminalConflictIds.has(mutation.mutationId) || !rebasedOntoHead)
      ) {
        this.terminalConflictIds.add(mutation.mutationId);
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
      const revisionId = this.acceptedRevisions.get(mutation.mutationId) ?? generateUuidV7();
      this.acceptedRevisions.set(mutation.mutationId, revisionId);
      return {
        mutationId: mutation.mutationId,
        status: already ? ("already-accepted" as const) : ("accepted" as const),
        revisionIds: [revisionId],
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
    const beforeNextChangePage = this.beforeNextChangePage;
    this.beforeNextChangePage = null;
    await beforeNextChangePage?.();
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
  // Creating and reconciling 101 encrypted writes can exceed the default CI
  // deadline under coverage. This case checks batching, not a performance budget.
  it("limits independent offline writes to causal batches of one hundred", async () => {
    const mutationIds: Uuid[] = [];
    for (let index = 0; index < 101; index += 1) {
      mutationIds.push(await enqueueCreate(`Offline item ${index}`));
    }
    const transport = new FakeTransport();
    const outcome = await reconcile(db, transport, codec);
    expect(transport.submissions.map((batch) => batch.length)).toEqual([100, 1]);
    expect(transport.submissions.flat().map(({ mutationId }) => mutationId)).toEqual(mutationIds);
    expect(outcome).toMatchObject({ submitted: 101, accepted: 101, retained: 0 });
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(true);
  }, 15_000);

  it.each(["write_blocked", "rotation.write-blocked"])(
    "retains a write refused by %s as blocked rather than a conflict",
    async (code) => {
      const mutationId = await enqueueCreate("Preserved during rotation");
      const transport = new FakeTransport();
      transport.submitMutationBatch = async () => ({
        ok: true,
        value: {
          results: [
            {
              mutationId,
              status: "rejected",
              problem: { type: "about:blank", status: 503, code, title: "Rotation in progress" },
            },
          ],
        },
      });
      const outcome = await reconcile(db, transport, codec);
      expect(outcome).toMatchObject({ accepted: 0, blocked: 1, conflicts: 0 });
      expect((await outbox.all()).find((row) => row.mutationId === mutationId)).toMatchObject({
        status: "blocked",
        blockedReason: "Rotation in progress",
      });
      expect(await db.conflicts.count()).toBe(0);
    },
  );

  it("acknowledges older acceptance responses without revision identities", async () => {
    const mutationId = await enqueueCreate("Accepted on an older server");
    const transport = new FakeTransport();
    transport.submitMutationBatch = async () => ({
      ok: true,
      value: { results: [{ mutationId, status: "accepted" }] },
    });
    await expect(reconcile(db, transport, codec)).resolves.toMatchObject({ accepted: 1 });
    expect(await db.outbox.get(mutationId)).toBeUndefined();
    expect(await repository.listItems()).toHaveLength(1);
  });

  it("publishes a rebuilt snapshot only after its durable replacement and keeps catch-up ordered", async () => {
    await repository.setMeta(META_KEYS.lastChangeCursor, "compacted");
    const old = serverItem("Old local projection");
    await repository.applyServerItems([old]);
    const fresh = serverItem("Current snapshot");
    const final = serverItem("After snapshot");
    const transport = new FakeTransport();
    transport.compactedCursors.add("compacted");
    transport.snapshot = {
      workspaceId: generateUuidV7(),
      schemaVersion: 1,
      cursor: "100",
      digest: "a".repeat(64),
      items: [fresh],
      relationships: [],
      databases: [],
      databaseEntries: [],
    };
    transport.changePages = [
      { changes: [changeOf(101, [final])], nextCursor: "101", hasMore: false },
    ];
    const commits: Array<{ cursor: string; rebuilt: boolean; complete: boolean }> = [];
    const outcome = await reconcile(db, transport, codec, {
      onProjectionCommitted: async (commit) => {
        commits.push({
          cursor: await repository.getLastChangeCursor(),
          rebuilt: commit.rebuilt,
          complete: commit.complete,
        });
        expect(await repository.getItem(fresh.id as Uuid)).toMatchObject({ name: fresh.name });
        expect(await repository.getItem(old.id as Uuid)).toBeNull();
        if (commit.rebuilt) expect(commit.itemIds).toEqual([fresh.id]);
      },
    });
    expect(commits).toEqual([
      { cursor: "100", rebuilt: true, complete: true },
      { cursor: "101", rebuilt: false, complete: true },
    ]);
    expect(outcome).toMatchObject({ caughtUpTo: "101", usedSnapshotFallback: true });
    expect(await repository.getItem(final.id as Uuid)).toMatchObject({ name: final.name });
  });

  it("yields a compacted snapshot to an edit made during its request without advancing coverage", async () => {
    await repository.setMeta(META_KEYS.lastChangeCursor, "compacted");
    const fresh = serverItem("Remote snapshot must wait");
    const transport = new FakeTransport();
    transport.compactedCursors.add("compacted");
    let localMutationId: Uuid | undefined;
    transport.currentSnapshot = async () => {
      localMutationId = await enqueueCreate("Created while snapshot was downloading");
      return {
        ok: true,
        value: {
          workspaceId: generateUuidV7(),
          schemaVersion: 1,
          cursor: "100",
          digest: "a".repeat(64),
          items: [fresh],
          relationships: [],
          databases: [],
          databaseEntries: [],
        },
      };
    };
    const commits: unknown[] = [];
    await expect(
      reconcile(db, transport, codec, {
        onProjectionCommitted: (commit) => void commits.push(commit),
      }),
    ).resolves.toMatchObject({ retained: 1, caughtUpTo: "compacted", usedSnapshotFallback: false });
    expect(commits).toEqual([]);
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    expect(await repository.getItem(fresh.id as Uuid)).toBeNull();
    expect(await db.outbox.get(localMutationId as Uuid)).toMatchObject({ status: "pending" });
    expect((await repository.listItems()).map(({ name }) => name)).toEqual([
      "Created while snapshot was downloading",
    ]);
  });

  it("resumes after a publication failure from the committed cursor rather than replaying its page", async () => {
    const first = serverItem("Already durable");
    const second = serverItem("Remaining discovery");
    const transport = new FakeTransport();
    transport.changePages = [
      { changes: [changeOf(1, [first])], nextCursor: "1", hasMore: true },
      { changes: [changeOf(2, [second])], nextCursor: "2", hasMore: false },
    ];
    await expect(
      reconcile(db, transport, codec, {
        onProjectionCommitted: async () => {
          throw new Error("surface was disposed");
        },
      }),
    ).rejects.toThrow("surface was disposed");
    expect(await repository.getLastChangeCursor()).toBe("1");
    expect(await repository.getItem(first.id as Uuid)).toMatchObject({ name: first.name });
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    const publishedIds: string[] = [];
    await reconcile(db, transport, codec, {
      onProjectionCommitted: ({ itemIds }) => void publishedIds.push(...itemIds),
    });
    expect(publishedIds).toEqual([second.id]);
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(true);
  });

  it("allows a projection listener to persist local work before the next page can replace it", async () => {
    const first = serverItem("First durable page");
    const stale = serverItem("Second page predates the new write");
    const transport = new FakeTransport();
    transport.changePages = [
      { changes: [changeOf(1, [first])], nextCursor: "1", hasMore: true },
      { changes: [changeOf(2, [stale])], nextCursor: "2", hasMore: false },
    ];
    const publishedIds: string[] = [];
    const outcome = await reconcile(db, transport, codec, {
      onProjectionCommitted: async ({ itemIds }) => {
        publishedIds.push(...itemIds);
        await enqueueCreate("Local edit from an already available surface");
      },
    });
    expect(publishedIds).toEqual([first.id]);
    expect(outcome).toMatchObject({ retained: 1, caughtUpTo: "1" });
    expect(await repository.getItem(stale.id as Uuid)).toBeNull();
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    expect(await outbox.pending()).toHaveLength(1);
  });

  it("preserves completed discovery through a nonfinal confirmation with no changed items", async () => {
    await repository.setMeta(META_KEYS.projectionComplete, true);
    const transport = new FakeTransport();
    transport.changePages = [
      {
        changes: [changeOf(1)],
        nextCursor: "1",
        hasMore: true,
      },
    ];
    const commits: unknown[] = [];
    await reconcile(db, transport, codec, {
      onProjectionCommitted: (commit) => void commits.push(commit),
    });
    expect(commits).toEqual([
      { itemIds: [], rebuilt: false, complete: true },
      { itemIds: [], rebuilt: false, complete: true },
    ]);
    expect(await repository.getLastChangeCursor()).toBe("1");
  });

  it("keeps a markerless legacy cursor incomplete until catch-up finishes", async () => {
    await repository.setMeta(META_KEYS.lastChangeCursor, "127");
    const transport = new FakeTransport();
    transport.failChanges = true;
    await reconcile(db, transport, codec);
    expect(await repository.getLastChangeCursor()).toBe("127");
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    transport.failChanges = false;
    await reconcile(db, transport, codec);
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(true);
  });
  it("publishes each page only after its rows and cursor are durable", async () => {
    const first = serverItem("First batch");
    const second = serverItem("Second batch");
    const transport = new FakeTransport();
    transport.changePages = [first, second].map((item, index) => ({
      changes: [
        {
          sequence: index + 1,
          mutationId: generateUuidV7(),
          revisionIds: [],
          changedItems: [item],
        },
      ],
      nextCursor: String(index + 1),
      hasMore: index === 0,
    }));
    const published: Array<{ ids: readonly Uuid[]; cursor: string; complete: boolean }> = [];
    await reconcile(db, transport, codec, {
      onProjectionCommitted: async (commit) => {
        for (const itemId of commit.itemIds)
          expect(await repository.getItem(itemId)).not.toBeNull();
        published.push({
          ids: commit.itemIds,
          cursor: await repository.getLastChangeCursor(),
          complete: (await repository.getMeta<boolean>(META_KEYS.projectionComplete)) === true,
        });
      },
    });
    expect(published).toEqual([
      { ids: [first.id], cursor: "1", complete: false },
      { ids: [second.id], cursor: "2", complete: true },
    ]);
  });

  it("keeps interrupted discovery incomplete and resumes from the committed cursor", async () => {
    const item = serverItem("Received before interruption");
    const transport = new FakeTransport();
    transport.changePages = [
      {
        changes: [
          { sequence: 1, mutationId: generateUuidV7(), revisionIds: [], changedItems: [item] },
        ],
        nextCursor: "1",
        hasMore: true,
      },
    ];
    const outcome = await reconcile(db, transport, codec, {
      onProjectionCommitted: () => {
        transport.failChanges = true;
      },
    });
    expect(outcome.offline).toBe(true);
    expect(await repository.getLastChangeCursor()).toBe("1");
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    expect(await repository.getItem(item.id as Uuid)).not.toBeNull();
    transport.failChanges = false;
    await reconcile(db, transport, codec);
    expect(await repository.getLastChangeCursor()).toBe("1");
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(true);
  });

  it("does not publish or complete a response superseded by a local mutation", async () => {
    const transport = new FakeTransport();
    const item = serverItem("Remote response");
    transport.changePages = [
      {
        changes: [
          { sequence: 1, mutationId: generateUuidV7(), revisionIds: [], changedItems: [item] },
        ],
        nextCursor: "1",
        hasMore: false,
      },
    ];
    transport.beforeNextChangePage = async () => {
      await enqueueCreate("Local intent");
    };
    const published: string[] = [];
    await reconcile(db, transport, codec, {
      onProjectionCommitted: (commit) => {
        published.push(...commit.itemIds);
      },
    });
    expect(published).toEqual([]);
    expect(await repository.getItem(item.id as Uuid)).toBeNull();
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    expect(await repository.getLastChangeCursor()).toBe("");
    expect(await outbox.pending()).toHaveLength(1);
  });

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

  it("accepts a create before submitting an immediate dependent edit", async () => {
    const createMutationId = await enqueueCreate("Draft");
    const create = await outbox.get(createMutationId);
    const localCreateRevisionId = create?.localRevisionIds[0] as Uuid;
    const itemId = create?.payload["id"] as Uuid;
    const editMutationId = generateUuidV7();
    const edit = await applyLocalMutation(
      db,
      {
        mutationId: editMutationId,
        commandType: "item.rename",
        payload: { itemId, name: "Edited before reconnect" },
        baseRevisionIds: [localCreateRevisionId],
      },
      () => new Date(),
      codec,
    );
    expect(edit.ok).toBe(true);
    const transport = new FakeTransport();

    const outcome = await reconcile(db, transport, codec);

    expect(outcome).toMatchObject({ accepted: 2, conflicts: 0, retained: 0 });
    expect(transport.submissions).toHaveLength(2);
    expect(transport.submissions[0]?.map(({ mutationId }) => mutationId)).toEqual([
      createMutationId,
    ]);
    expect(transport.submissions[1]?.[0]).toMatchObject({
      mutationId: editMutationId,
      baseRevisionIds: [transport.acceptedRevisions.get(createMutationId)],
    });
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

  it("applies items, structured payloads and relationships at the same cursor", async () => {
    const transport = new FakeTransport();
    const databaseItem = { ...serverItem("Structured database"), kind: "database" as const };
    const initialEntryItem = serverItem("Structured entry");
    const entryItem = {
      ...initialEntryItem,
      kind: "page" as const,
      placements: initialEntryItem.placements.map((placement) => ({
        ...placement,
        parentItemId: databaseItem.id,
      })),
    };
    const targetItem = serverItem("Structured target");
    const definition = createInitialDatabaseDefinition({
      type: "database.create",
      id: databaseItem.id as Uuid,
      name: databaseItem.name,
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
      titlePropertyId: generateUuidV7(),
      initialViewId: generateUuidV7(),
      initialViewName: "Table",
    });
    const relationshipId = generateUuidV7();
    transport.changePages = [
      {
        changes: [
          {
            sequence: 9,
            mutationId: generateUuidV7(),
            revisionIds: [generateUuidV7()],
            changedItems: [databaseItem, entryItem, targetItem],
            relationships: [
              {
                id: relationshipId,
                sourceItemId: entryItem.id,
                targetItemId: targetItem.id,
                relationType: "database:property",
                metadata: { databaseId: databaseItem.id, propertyId: generateUuidV7() },
                createdRevisionId: generateUuidV7(),
                removedRevisionId: null,
              },
            ],
            databases: [
              {
                itemId: databaseItem.id,
                definitionVersion: 1,
                definition: definition as never,
              },
            ],
            databaseEntries: [
              {
                entryItemId: entryItem.id,
                databaseId: databaseItem.id,
                valueVersion: 1,
                values: {
                  format: "myownnotion.database-entry-values+json",
                  formatVersion: 1,
                  databaseId: databaseItem.id,
                  entryId: entryItem.id,
                  values: {},
                  preserved: [],
                },
              },
            ],
          },
        ],
        nextCursor: "9",
        hasMore: false,
      },
    ];

    const outcome = await reconcile(db, transport, codec);
    const structured = new LocalDatabaseRepository(db, codec);

    expect(outcome.caughtUpTo).toBe("9");
    expect((await structured.getDatabase(databaseItem.id as Uuid))?.definition).toEqual(definition);
    expect(await structured.getEntry(entryItem.id as Uuid)).toMatchObject({
      databaseId: databaseItem.id,
      availability: "present",
    });
    expect(await db.relationships.get(relationshipId)).toMatchObject({
      sourceItemId: entryItem.id,
      targetItemId: targetItem.id,
    });
    expect(await repository.getLastChangeCursor()).toBe("9");
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
    expect(await repository.getMeta(META_KEYS.projectionComplete)).toBe(true);
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

  it("never lets an in-flight change page overwrite a newly durable local mutation", async () => {
    const canonical = serverItem("Before local edit");
    await repository.applyServerItems([canonical]);
    await repository.setMeta("lastChangeCursor", "10");
    const transport = new FakeTransport();
    transport.changePages = [
      {
        changes: [
          {
            sequence: 11,
            mutationId: generateUuidV7(),
            revisionIds: [canonical.currentRevisionId],
            changedItems: [{ ...canonical, name: "Stale response" }],
          },
        ],
        nextCursor: "11",
        hasMore: false,
      },
    ];
    transport.beforeNextChangePage = async () => {
      const result = await applyLocalMutation(
        db,
        {
          mutationId: generateUuidV7(),
          commandType: "item.rename",
          payload: {
            itemId: canonical.id,
            name: "Durable local edit",
            baseRevisionId: canonical.currentRevisionId,
          },
          baseRevisionIds: [canonical.currentRevisionId as Uuid],
        },
        () => new Date(),
        codec,
      );
      expect(result.ok).toBe(true);
    };

    const outcome = await reconcile(db, transport, codec);

    expect(outcome).toMatchObject({ retained: 1, caughtUpTo: "10", offline: false });
    expect((await repository.getItem(canonical.id as Uuid))?.name).toBe("Durable local edit");
    expect(await repository.getLastChangeCursor()).toBe("10");
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

  it.each(["no revision reader", "no competing head", "multiple competing heads"])(
    "preserves the original edit for owner review with %s",
    async (caseName) => {
      const ancestorId = generateUuidV7();
      const remoteId = generateUuidV7();
      const itemId = await pageWithBody([{ id: BLOCK_A, text: "original" }]);
      const mutationId = await enqueueEdit(itemId, ancestorId, [{ id: BLOCK_A, text: "local" }]);
      const transport = new FakeTransport();
      const competing =
        caseName === "no competing head"
          ? []
          : caseName === "multiple competing heads"
            ? [remoteId, generateUuidV7()]
            : [remoteId];
      transport.conflictIds.set(mutationId, competing);
      const transportWithoutRevisionReader: ReconcileTransport = {
        submitMutationBatch: transport.submitMutationBatch.bind(transport),
        listChanges: transport.listChanges.bind(transport),
        currentSnapshot: transport.currentSnapshot.bind(transport),
      };
      const outcome = await reconcile(
        db,
        caseName === "no revision reader" ? transportWithoutRevisionReader : transport,
        codec,
      );
      expect(outcome.conflicts).toBe(1);
      const conflict = (await outbox.conflicts()).find((row) => row.mutationId === mutationId);
      expect(conflict).toMatchObject({ competingRevisionIds: competing });
      expect(JSON.stringify(conflict?.payload)).toContain("local");
      expect(
        transport.submissions.flat().filter((row) => row.mutationId === mutationId),
      ).toHaveLength(1);
    },
  );

  it.each(["null", "missing body", "legacy body", "remote unavailable"])(
    "does not guess a page merge when retained state has %s",
    async (caseName) => {
      const ancestorId = generateUuidV7();
      const remoteId = generateUuidV7();
      const itemId = await pageWithBody([{ id: BLOCK_A, text: "original" }]);
      const mutationId = await enqueueEdit(itemId, ancestorId, [{ id: BLOCK_A, text: "local" }]);
      const transport = new FakeTransport();
      transport.conflictIds.set(mutationId, [remoteId]);
      transport.revisions.set(
        ancestorId,
        caseName === "null"
          ? null
          : caseName === "missing body"
            ? {}
            : caseName === "legacy body"
              ? { pageDocument: { body: { text: "legacy original" } } }
              : { pageDocument: { body: body([{ id: BLOCK_A, text: "original" }]) } },
      );
      if (caseName !== "remote unavailable") {
        transport.revisions.set(remoteId, {
          pageDocument: { body: body([{ id: BLOCK_A, text: "remote" }]) },
        });
      }
      await expect(reconcile(db, transport, codec)).resolves.toMatchObject({ conflicts: 1 });
      expect(
        (await outbox.conflicts()).find((row) => row.mutationId === mutationId)?.payload,
      ).toMatchObject({
        document: { body: body([{ id: BLOCK_A, text: "local" }]) },
      });
      expect((await repository.getItem(itemId))?.pageDocument?.body).toEqual(
        body([{ id: BLOCK_A, text: "local" }]),
      );
    },
  );

  it("bounds automatic rebasing when another device advances again during submission", async () => {
    const ancestorId = generateUuidV7();
    const remoteId = generateUuidV7();
    const itemId = await pageWithBody([{ id: BLOCK_A, text: "original" }]);
    const mutationId = await enqueueEdit(itemId, ancestorId, [
      { id: BLOCK_A, text: "original" },
      { id: BLOCK_B, text: "local addition" },
    ]);
    await db.outbox.where("mutationId").notEqual(mutationId).delete();
    const transport = new FakeTransport();
    transport.revisions.set(ancestorId, {
      pageDocument: { body: body([{ id: BLOCK_A, text: "original" }]) },
    });
    transport.revisions.set(remoteId, {
      pageDocument: { body: body([{ id: BLOCK_A, text: "remote" }]) },
    });
    transport.submitMutationBatch = async (mutations) => {
      transport.submissions.push(mutations);
      return {
        ok: true,
        value: {
          results: mutations.map((mutation) => ({
            mutationId: mutation.mutationId,
            status: "conflict",
            competingRevisionIds: [remoteId],
          })),
        },
      };
    };
    await expect(reconcile(db, transport, codec)).resolves.toMatchObject({
      conflicts: 1,
      retained: 0,
    });
    expect(transport.submissions).toHaveLength(2);
    const replacementId = transport.submissions[1]?.[0]?.mutationId;
    expect(replacementId).not.toBe(mutationId);
    expect(
      (await outbox.conflicts()).find((row) => row.mutationId === replacementId),
    ).toMatchObject({
      errorCode: "mutation.conflict",
    });
    expect(await outbox.pending()).toEqual([]);
  });

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
    const submitted = transport.submissions
      .flat()
      .filter(({ commandType }) => commandType === "page.document.replace");
    expect(submitted).toHaveLength(2);
    expect(submitted[0]?.mutationId).toBe(mutationId);
    const last = submitted[1];
    expect(last?.mutationId).not.toBe(mutationId);
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
