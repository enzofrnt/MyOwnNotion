/**
 * `LocalContentService.synchronize()` must never run two passes at once.
 *
 * Regression test for the flake that made `relationships.spec.ts` and
 * `hierarchy.spec.ts` fail on their first CI attempt and pass on retry.
 *
 * `mutate()` fires `void this.synchronize()` and does not await it, so two
 * quick successive edits used to start two reconciliation passes. Every pass
 * begins with `outbox.recoverInterrupted()`, which resets each `sending` row
 * to `pending` — and it cannot distinguish "interrupted by a page reload" from
 * "in flight right now in the other pass". A row could be reset after the pass
 * that owned it had already drained past it, leaving it `pending` with nobody
 * to resubmit: the workspace then reports "1 pending" forever, which is
 * exactly what the failing traces showed.
 *
 * The two properties asserted here are what make that impossible:
 *   1. passes never overlap;
 *   2. work enqueued while a pass is running is still drained afterwards.
 */

import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentApi } from "../src/services/content-api.ts";
import { LocalContentService } from "../src/services/local-content.ts";

/** Resolves when told to, so a pass can be held open deliberately. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Recorder {
  /** Number of `listChanges` calls, one per reconciliation pass. */
  passes: number;
  /** Highest number of passes observed inside the transport at once. */
  peakConcurrency: number;
}

/**
 * A transport that counts passes and lets the test hold one open.
 * `reconcile()` always reaches `listChanges`, so it is the reliable marker of
 * a pass being in progress.
 */
function makeApi(recorder: Recorder, gate?: Promise<void>): ContentApi {
  let active = 0;
  return {
    submitMutationBatch: async () => ({
      ok: true as const,
      value: { results: [] },
    }),
    listChanges: async () => {
      active += 1;
      recorder.passes += 1;
      recorder.peakConcurrency = Math.max(recorder.peakConcurrency, active);
      if (gate !== undefined && recorder.passes === 1) {
        await gate;
      }
      active -= 1;
      return {
        ok: true as const,
        value: { changes: [], cursor: "0", hasMore: false },
      };
    },
    currentSnapshot: async () => ({
      ok: true as const,
      value: { workspaceId: crypto.randomUUID(), schemaVersion: 1, cursor: "0", items: [] },
    }),
  } as unknown as ContentApi;
}

let service: LocalContentService | undefined;

afterEach(async () => {
  await service?.db.delete();
  service = undefined;
});

describe("synchronize serialization", () => {
  it("does not reset another tab's live page send at the boot boundary", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `initialize-${Date.now()}`);
    const recover = vi
      .spyOn(service.pageOperationLog, "recoverInterruptedSending")
      .mockResolvedValue(0);

    await Promise.all([service.initialize(), service.initialize(), service.initialize()]);

    // Recovery now belongs to the per-page reconciler after it acquires the
    // origin-wide transport lock. Boot cannot know whether another tab still
    // owns a `sending` row and must leave it untouched here.
    expect(recover).not.toHaveBeenCalled();
    expect(recorder.passes).toBe(1);
  });

  it("resumes a durable page queue on boot without opening that page", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `closed-page-${Date.now()}`);
    const pageId = generateUuidV7();
    const synchronizePage = vi.fn().mockResolvedValue({
      kind: "synced" as const,
      exchanges: 1,
      latestPageSequence: 1,
      fileRequirements: [],
    });
    vi.spyOn(service.pageOperationLog, "listPageIdsWithUpdates").mockResolvedValue([pageId]);
    vi.spyOn(service, "pageReconciler").mockReturnValue({
      synchronize: synchronizePage,
    } as unknown as ReturnType<LocalContentService["pageReconciler"]>);

    await service.initialize();

    expect(synchronizePage).toHaveBeenCalledTimes(1);
  });

  it("does not exchange idle cached reconcilers that have no queued work", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `idle-reconciler-${Date.now()}`);
    const idleId = generateUuidV7();
    const queuedId = generateUuidV7();
    service.pageReconciler(idleId);
    vi.spyOn(service.pageOperationLog, "listPageIdsWithUpdates").mockResolvedValue([queuedId]);
    vi.spyOn(service.pageOperationLog, "listPageIdsWithLegacyBranches").mockResolvedValue([]);
    const seen: string[] = [];
    const synchronizePage = vi.fn().mockResolvedValue({
      kind: "synced" as const,
      exchanges: 1,
      latestPageSequence: 1,
      fileRequirements: [],
    });
    vi.spyOn(service, "pageReconciler").mockImplementation((pageId) => {
      seen.push(pageId);
      return { synchronize: synchronizePage } as unknown as ReturnType<
        LocalContentService["pageReconciler"]
      >;
    });

    await service.initialize();

    expect(seen).toEqual([queuedId]);
    expect(synchronizePage).toHaveBeenCalledTimes(1);
  });

  it("converts a durable legacy branch after its editor has closed", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `closed-legacy-${Date.now()}`);
    const pageId = generateUuidV7();
    vi.spyOn(service.pageOperationLog, "listPageIdsWithUpdates").mockResolvedValue([]);
    vi.spyOn(service.pageOperationLog, "listPageIdsWithLegacyBranches")
      .mockResolvedValueOnce([pageId])
      .mockResolvedValueOnce([]);
    vi.spyOn(service.pageOperationLog, "getLegacyBranch").mockResolvedValue({
      pageId,
      status: "editing",
    } as never);
    const convertLegacyBranch = vi.fn().mockResolvedValue({
      kind: "synced" as const,
      exchanges: 1,
      latestPageSequence: 1,
      fileRequirements: [],
    });
    vi.spyOn(service, "pageReconciler").mockReturnValue({
      convertLegacyBranch,
    } as unknown as ReturnType<LocalContentService["pageReconciler"]>);

    await service.initialize();

    expect(convertLegacyBranch).toHaveBeenCalledTimes(1);
  });

  it("keeps the global status pending while an unopened page queue remains", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `page-status-${Date.now()}`);
    vi.spyOn(service.pageOperationLog, "listPageIdsWithUpdates").mockResolvedValue([]);
    vi.spyOn(service.pageOperationLog, "countUpdates").mockResolvedValue(1);

    await service.initialize();

    expect(service.getSnapshot()).toMatchObject({
      syncState: "pending",
      pendingCount: 1,
    });
  });

  it("bounds a large reconnect backlog to four page exchanges", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `bounded-pages-${Date.now()}`);
    const pageIds = Array.from({ length: 10 }, () => generateUuidV7());
    vi.spyOn(service.pageOperationLog, "listPageIdsWithUpdates").mockResolvedValue(pageIds);
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const synchronizePage = vi.fn(
      async () =>
        await new Promise<{
          kind: "synced";
          exchanges: number;
          latestPageSequence: number;
          fileRequirements: never[];
        }>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          releases.push(() => {
            active -= 1;
            resolve({
              kind: "synced",
              exchanges: 1,
              latestPageSequence: 1,
              fileRequirements: [],
            });
          });
        }),
    );
    vi.spyOn(service, "pageReconciler").mockReturnValue({
      synchronize: synchronizePage,
    } as unknown as ReturnType<LocalContentService["pageReconciler"]>);

    const synchronization = service.synchronizeOperationalPages();
    for (const expectedCalls of [4, 8, 10]) {
      await vi.waitFor(() => expect(synchronizePage).toHaveBeenCalledTimes(expectedCalls));
      expect(active).toBe(expectedCalls === 10 ? 2 : 4);
      const batch = releases.splice(0);
      for (const release of batch) release();
    }
    await synchronization;

    expect(peak).toBe(4);
  });

  it("runs one pass when several callers arrive at once", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    const gate = deferred<void>();
    service = new LocalContentService(makeApi(recorder, gate.promise), `serial-${Date.now()}`);
    await service.db.open();

    // Three callers, mirroring three quick edits each firing their own pass.
    const first = service.synchronize();
    const second = service.synchronize();
    const third = service.synchronize();

    // Hold the first pass open long enough for any unserialized pass to reach
    // the transport. Releasing immediately would let pass one finish first and
    // the test would pass even without serialization.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recorder.peakConcurrency, "a second pass entered the transport").toBe(1);

    gate.resolve();
    await Promise.all([first, second, third]);

    // Never two at once — the property the stranded-row bug violated.
    expect(recorder.peakConcurrency).toBe(1);
    // One held pass, plus a single coalesced follow-up for the late arrivals.
    expect(recorder.passes).toBe(2);
  });

  it("still drains work enqueued while a pass was running", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    const gate = deferred<void>();
    service = new LocalContentService(makeApi(recorder, gate.promise), `drain-${Date.now()}`);
    await service.db.open();

    const held = service.synchronize();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Arrives mid-pass: coalescing must not swallow it, or a mutation
    // enqueued now would sit `pending` with nobody to resubmit it.
    const late = service.synchronize();
    // Give the late caller time to reach the transport if it were unserialized.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recorder.peakConcurrency, "the late caller started its own pass").toBe(1);

    gate.resolve();
    await Promise.all([held, late]);

    expect(recorder.passes).toBe(2);
    expect(recorder.peakConcurrency).toBe(1);
  });

  it("keeps every joined caller pending until its requested follow-up pass finishes", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    const firstGate = deferred<void>();
    const followUpGate = deferred<void>();
    const api = makeApi(recorder);
    vi.spyOn(api, "listChanges").mockImplementation(async () => {
      recorder.passes += 1;
      await (recorder.passes === 1 ? firstGate.promise : followUpGate.promise);
      return {
        ok: true as const,
        value: { changes: [], cursor: String(recorder.passes), hasMore: false },
      };
    });
    service = new LocalContentService(api, `joined-drain-${Date.now()}`);
    await service.db.open();

    const owner = service.synchronize();
    await vi.waitFor(() => expect(recorder.passes).toBe(1));
    let joinedResolved = false;
    const joined = service.synchronize().then((state) => {
      joinedResolved = true;
      return state;
    });

    firstGate.resolve();
    await vi.waitFor(() => expect(recorder.passes).toBe(2));
    await Promise.resolve();
    expect(joinedResolved).toBe(false);

    followUpGate.resolve();
    await expect(Promise.all([owner, joined])).resolves.toEqual(["synced", "synced"]);
    expect(joinedResolved).toBe(true);
  });

  it("never reports synchronized while a workspace mutation is still sending", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    const submitGate = deferred<void>();
    const api = makeApi(recorder);
    vi.spyOn(api, "submitMutationBatch").mockImplementation(async (mutations) => {
      await submitGate.promise;
      return {
        ok: true,
        value: {
          results: mutations.map(({ mutationId }) => ({
            mutationId,
            status: "accepted" as const,
            revisionIds: [generateUuidV7()],
          })),
        },
      };
    });
    service = new LocalContentService(api, `sending-status-${Date.now()}`);
    await service.initialize();

    const created = await service.mutate("item.create", {
      id: generateUuidV7(),
      kind: "page",
      name: "Still sending",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    });
    expect(created).toEqual({ ok: true });
    await vi.waitFor(async () => {
      expect((await service?.outbox.all())?.[0]?.status).toBe("sending");
    });

    // A page exchange on another queue can finish while this workspace batch is
    // in flight. Its notification may refresh the aggregate, but must not turn
    // the still-owned `sending` row into a false all-devices confirmation.
    const announcedPageId = generateUuidV7();
    vi.spyOn(service.pageOperationLog, "getState").mockResolvedValue({
      pageId: announcedPageId,
      latestServerPageSequence: 0,
    } as never);
    vi.spyOn(service, "pageReconciler").mockReturnValue({
      synchronize: vi.fn().mockResolvedValue({
        kind: "synced",
        exchanges: 1,
        latestPageSequence: 1,
        fileRequirements: [],
      }),
    } as never);

    await service.reconcileRealtimePageAdvance({
      pageId: announcedPageId,
      latestPageSequence: 1,
    });

    expect(service.getSnapshot()).toMatchObject({
      syncState: "pending",
      pendingCount: 1,
    });

    const completed = service.synchronize();
    submitGate.resolve();
    await completed;
    expect(service.getSnapshot()).toMatchObject({ syncState: "synced", pendingCount: 0 });
  });

  it("runs exactly one pass when callers do not overlap", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `sequential-${Date.now()}`);
    await service.db.open();

    await service.synchronize();
    expect(recorder.passes).toBe(1);

    await service.synchronize();
    expect(recorder.passes).toBe(2);
    expect(recorder.peakConcurrency).toBe(1);
  });

  it("clears the in-flight pass so a later caller is not blocked forever", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `reset-${Date.now()}`);
    await service.db.open();

    await service.synchronize();
    // A second, independent call must actually run rather than join a stale
    // promise held by the previous pass.
    const state = await service.synchronize();
    expect(state).toBe("synced");
    expect(recorder.passes).toBe(2);
  });
});
