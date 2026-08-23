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
  it("recovers interrupted page sends exactly once at the boot boundary", async () => {
    const recorder: Recorder = { passes: 0, peakConcurrency: 0 };
    service = new LocalContentService(makeApi(recorder), `initialize-${Date.now()}`);
    const recover = vi
      .spyOn(service.pageOperationLog, "recoverInterruptedSending")
      .mockResolvedValue(0);

    await Promise.all([service.initialize(), service.initialize(), service.initialize()]);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(recorder.passes).toBe(1);
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
