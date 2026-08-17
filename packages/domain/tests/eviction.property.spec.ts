/**
 * What an eviction may never release (T033, US4, FR-015, FR-017).
 *
 * Written as properties because the requirement is universal — *no* workspace,
 * at *no* limit, ever releases unsynchronized work — and an example-based test
 * proves it for the examples someone thought of. The failure this guards
 * against is silent and permanent: an owner's offline edit released to make
 * room, with nothing left to recover it from.
 *
 * The generator deliberately produces hostile shapes: unsynchronized changes
 * that are the largest and oldest things present, which is exactly what a naive
 * "evict the biggest" or "evict the oldest" rule would take first.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EvictionCandidate, isProtected, planEviction } from "../src/index.ts";

const candidate = fc.record({
  itemId: fc.uuid(),
  byteLength: fc.integer({ min: 0, max: 5_000_000 }),
  lastAccessedAt: fc.integer({ min: 0, max: 2_000_000_000 }),
  recoverable: fc.boolean(),
  offlineIntent: fc.boolean(),
  kind: fc.constantFrom(
    "file-content" as const,
    "attachment-content" as const,
    "page-content" as const,
    "metadata" as const,
  ),
});

describe("what eviction never touches", () => {
  it("never releases anything the server cannot return", () => {
    fc.assert(
      fc.property(
        fc.array(candidate, { maxLength: 40 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (candidates, usedBytes, limitBytes) => {
          const plan = planEviction({ candidates, usedBytes, limitBytes });
          // The one that matters. Unsynchronized work released to make room is
          // gone: there is nowhere to fetch it back from.
          expect(plan.release.every((entry) => entry.recoverable)).toBe(true);
        },
      ),
    );
  });

  it("never releases what the owner asked to keep offline", () => {
    fc.assert(
      fc.property(
        fc.array(candidate, { maxLength: 40 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (candidates, usedBytes, limitBytes) => {
          const plan = planEviction({ candidates, usedBytes, limitBytes });
          expect(plan.release.every((entry) => !entry.offlineIntent)).toBe(true);
        },
      ),
    );
  });

  it("never releases metadata, whatever the pressure", () => {
    fc.assert(
      fc.property(fc.array(candidate, { maxLength: 40 }), (candidates) => {
        // Titles and navigation are what let an owner see that something exists
        // and is retrievable. Released, the workspace looks empty rather than
        // offloaded.
        const plan = planEviction({ candidates, usedBytes: 10_000_000, limitBytes: 0 });
        expect(plan.release.every((entry) => entry.kind !== "metadata")).toBe(true);
      }),
    );
  });

  it("releases nothing at all when the limit is unlimited", () => {
    fc.assert(
      fc.property(fc.array(candidate, { maxLength: 40 }), (candidates) => {
        const plan = planEviction({ candidates, usedBytes: 999_999_999, limitBytes: null });
        expect(plan.release).toEqual([]);
      }),
    );
  });

  it("releases nothing when usage is within the limit", () => {
    fc.assert(
      fc.property(fc.array(candidate, { maxLength: 20 }), (candidates) => {
        const plan = planEviction({ candidates, usedBytes: 100, limitBytes: 100 });
        expect(plan.release).toEqual([]);
      }),
    );
  });

  it("agrees with `isProtected` about every single candidate", () => {
    fc.assert(
      fc.property(fc.array(candidate, { maxLength: 40 }), (candidates) => {
        const plan = planEviction({ candidates, usedBytes: 50_000_000, limitBytes: 0 });
        // One definition of "protected", not one per caller: the interface
        // explains why something was kept using the same rule that kept it.
        expect(plan.release.some(isProtected)).toBe(false);
      }),
    );
  });
});

describe("the hostile shape", () => {
  it("keeps an unsynchronized change that is the largest and oldest thing present", () => {
    // Exactly what "evict the biggest" and "evict the oldest" would take first.
    const precious: EvictionCandidate = {
      itemId: "unsynchronized",
      byteLength: 4_000_000,
      lastAccessedAt: 0,
      recoverable: false,
      offlineIntent: false,
      kind: "page-content",
    };
    const ordinary: EvictionCandidate = {
      itemId: "ordinary",
      byteLength: 10,
      lastAccessedAt: 2_000_000_000,
      recoverable: true,
      offlineIntent: false,
      kind: "file-content",
    };

    const plan = planEviction({
      candidates: [precious, ordinary],
      usedBytes: 4_000_010,
      limitBytes: 100,
    });

    expect(plan.release.map((entry) => entry.itemId)).toEqual(["ordinary"]);
    // And it says so rather than pretending the limit was honoured: an owner
    // whose device is genuinely too full needs to know that.
    expect(plan.stillOverLimit).toBe(true);
  });

  it("stops as soon as the limit is met rather than emptying the device", () => {
    const candidates: EvictionCandidate[] = Array.from({ length: 10 }, (_, index) => ({
      itemId: `file-${index}`,
      byteLength: 100,
      lastAccessedAt: index,
      recoverable: true,
      offlineIntent: false,
      kind: "file-content",
    }));

    const plan = planEviction({ candidates, usedBytes: 1000, limitBytes: 700 });
    // Three releases reach the limit; releasing more would cost the owner
    // downloads they never asked to repeat.
    expect(plan.release).toHaveLength(3);
    expect(plan.stillOverLimit).toBe(false);
  });

  it("releases file content before pages, and older before newer", () => {
    const candidates: EvictionCandidate[] = [
      {
        itemId: "recent-file",
        byteLength: 100,
        lastAccessedAt: 900,
        recoverable: true,
        offlineIntent: false,
        kind: "file-content",
      },
      {
        itemId: "old-file",
        byteLength: 100,
        lastAccessedAt: 1,
        recoverable: true,
        offlineIntent: false,
        kind: "file-content",
      },
      {
        itemId: "old-page",
        byteLength: 100,
        lastAccessedAt: 0,
        recoverable: true,
        offlineIntent: false,
        kind: "page-content",
      },
    ];

    const plan = planEviction({ candidates, usedBytes: 300, limitBytes: 100 });
    // Group first, then age within it: a page is cheaper to refetch than an
    // owner expects and far more likely to be wanted again.
    expect(plan.release.map((entry) => entry.itemId)).toEqual(["old-file", "recent-file"]);
  });
});
