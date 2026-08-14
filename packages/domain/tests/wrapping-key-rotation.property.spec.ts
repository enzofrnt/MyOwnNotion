/**
 * Wrapping-key rotation invariants (T083, US5, FR-017, FR-018).
 *
 * A rotation that loses data does so quietly: the operation reports success,
 * the policy resets its due date, and nothing is discovered until a record is
 * read months later under a key version that no longer exists. So these tests
 * are about the ways a rotation can appear to succeed while having failed.
 *
 * Three of them matter more than the rest:
 *
 *   - a rotation must **advance** the version, because one that does not is a
 *     no-op that still resets the clock;
 *   - a resumed rotation must never **skip** a workspace, because the skipped
 *     one becomes unreadable when the old version retires;
 *   - writes must not use the new version until **every** workspace is
 *     rewrapped, for the same reason.
 */

import {
  isRotationComplete,
  planWrappingKeyRotation,
  readsAllowedDuringWrappingRotation,
  recordRewrapped,
  remainingUnits,
  type WrappingKeyRewrapUnit,
  type WrappingKeyRotationCheckpoint,
  WrappingKeyRotationError,
  writesMayUseNewVersion,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const workspaceId = fc.uuid();

const units = fc
  .uniqueArray(workspaceId, { minLength: 1, maxLength: 12 })
  .map((ids): WrappingKeyRewrapUnit[] =>
    ids.map((id) => ({ workspaceId: id, rootKeyId: `root-${id}` })),
  );

function plan(unitList: readonly WrappingKeyRewrapUnit[], operationId = "op-1") {
  return planWrappingKeyRotation({
    operationId,
    fromVersion: 1,
    toVersion: 2,
    units: unitList,
  });
}

describe("a rotation must actually rotate", () => {
  it("refuses a version that does not advance", () => {
    // The dangerous case: it would complete, reset the due date, and change
    // no key — success that is indistinguishable from the real thing.
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 1 }), (toVersion) => {
        expect(() =>
          planWrappingKeyRotation({
            operationId: "op",
            fromVersion: 1,
            toVersion,
            units: [{ workspaceId: "w", rootKeyId: "r" }],
          }),
        ).toThrow(WrappingKeyRotationError);
      }),
    );
  });

  it("refuses a rotation with nothing to rewrap", () => {
    expect(() =>
      planWrappingKeyRotation({ operationId: "op", fromVersion: 1, toVersion: 2, units: [] }),
    ).toThrow(WrappingKeyRotationError);
  });

  it("refuses a workspace listed twice", () => {
    // One root key row per workspace is the whole economy of this design. Two
    // units for one workspace means a second root key exists, which is a
    // corruption rather than a rotation.
    expect(() =>
      planWrappingKeyRotation({
        operationId: "op",
        fromVersion: 1,
        toVersion: 2,
        units: [
          { workspaceId: "w", rootKeyId: "r1" },
          { workspaceId: "w", rootKeyId: "r2" },
        ],
      }),
    ).toThrow(WrappingKeyRotationError);
  });
});

describe("resuming never skips a workspace", () => {
  it("returns exactly the workspaces not yet rewrapped", () => {
    fc.assert(
      fc.property(units, (unitList) => {
        const rotation = plan(unitList);
        const done = unitList.slice(0, Math.floor(unitList.length / 2));
        const empty: WrappingKeyRotationCheckpoint = {
          operationId: rotation.operationId,
          completedWorkspaceIds: [],
        };
        const checkpoint = done.reduce<WrappingKeyRotationCheckpoint>(
          (acc, unit) => recordRewrapped(acc, unit.workspaceId),
          empty,
        );

        const remaining = remainingUnits(rotation, checkpoint);
        expect(remaining).toHaveLength(unitList.length - done.length);
        // And nothing already done reappears, so no workspace is rewrapped
        // twice under a version that has since moved on.
        for (const unit of remaining) {
          expect(done.map((entry) => entry.workspaceId)).not.toContain(unit.workspaceId);
        }
      }),
    );
  });

  it("refuses a checkpoint from a different operation", () => {
    // Treating it as progress would mark workspaces done that this rotation
    // never touched — the exact way a resume loses data.
    const rotation = plan([{ workspaceId: "w", rootKeyId: "r" }]);
    expect(() =>
      remainingUnits(rotation, { operationId: "another", completedWorkspaceIds: ["w"] }),
    ).toThrow(WrappingKeyRotationError);
  });

  it("treats an absent checkpoint as no progress at all", () => {
    fc.assert(
      fc.property(units, (unitList) => {
        expect(remainingUnits(plan(unitList), null)).toHaveLength(unitList.length);
      }),
    );
  });

  it("is idempotent: recording the same workspace twice changes nothing", () => {
    fc.assert(
      fc.property(workspaceId, (id) => {
        const once = recordRewrapped({ operationId: "op", completedWorkspaceIds: [] }, id);
        const twice = recordRewrapped(once, id);
        expect(twice.completedWorkspaceIds).toEqual(once.completedWorkspaceIds);
      }),
    );
  });
});

describe("when the new version may be used", () => {
  it("only once every workspace is rewrapped", () => {
    // A write under the new version while one workspace still has its root key
    // under the old one produces a record nothing can open after the old
    // version retires.
    fc.assert(
      fc.property(units, (unitList) => {
        const rotation = plan(unitList);
        let checkpoint: WrappingKeyRotationCheckpoint = {
          operationId: rotation.operationId,
          completedWorkspaceIds: [],
        };

        for (const unit of unitList.slice(0, -1)) {
          checkpoint = recordRewrapped(checkpoint, unit.workspaceId);
          expect(writesMayUseNewVersion(rotation, checkpoint)).toBe(false);
        }

        const last = unitList[unitList.length - 1] as WrappingKeyRewrapUnit;
        checkpoint = recordRewrapped(checkpoint, last.workspaceId);
        expect(writesMayUseNewVersion(rotation, checkpoint)).toBe(true);
        expect(isRotationComplete(rotation, checkpoint)).toBe(true);
      }),
    );
  });
});

describe("reads never stop", () => {
  it("is allowed in every policy state", () => {
    // The records are untouched by a wrapping-key rotation, and the previous
    // version can still unwrap what it wrapped. Blocking reads here would be
    // an outage caused by housekeeping.
    for (const state of [
      "pre-due",
      "due",
      "overdue-within-grace",
      "emergency",
      "write-block",
      "in-progress",
      "complete",
      "failed",
    ] as const) {
      expect(readsAllowedDuringWrappingRotation(state)).toBe(true);
    }
  });
});
