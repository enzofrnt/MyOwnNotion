/**
 * Device state invariants (T064, US3, FR-008, FR-009).
 *
 * Randomized rather than enumerated, because the property that matters is not
 * "these four transitions work" but "no sequence of legal steps ever reaches
 * a state the owner did not intend". A table of examples proves the first; it
 * cannot prove the second.
 *
 * The invariant worth stating plainly: **revocation is a one-way door.** An
 * attacker who regains a session must not be able to undo the one action the
 * owner took against them.
 */

import {
  allowedDeviceTransitions,
  canTransitionDevice,
  DEVICE_STATES,
  type DeviceState,
  DeviceTransitionError,
  isDeviceOperable,
  isValidStorageLimit,
  mayHoldSynchronizationKey,
  transitionDevice,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const anyState = fc.constantFrom<DeviceState>(...DEVICE_STATES);

describe("revocation is a one-way door", () => {
  it("leaves no legal transition out of revoked", () => {
    expect(allowedDeviceTransitions("revoked")).toEqual([]);
  });

  it("refuses every attempt to leave it, from any state", () => {
    fc.assert(
      fc.property(anyState, (target) => {
        expect(canTransitionDevice("revoked", target)).toBe(false);
      }),
    );
  });

  it("cannot be escaped by any sequence of legal steps", () => {
    // The property an enumerated test cannot express: once a walk reaches
    // revoked, no continuation leaves it, however long.
    fc.assert(
      fc.property(anyState, fc.array(anyState, { maxLength: 20 }), (start, walk) => {
        let state = start;
        let everRevoked = state === "revoked";
        for (const step of walk) {
          if (canTransitionDevice(state, step)) {
            state = step;
          }
          everRevoked ||= state === "revoked";
        }
        // Reaching revoked at any point means ending there.
        if (everRevoked) {
          expect(state).toBe("revoked");
        }
      }),
    );
  });
});

describe("every state is reachable from authorization, and none by accident", () => {
  it("never allows a transition to itself", () => {
    // A no-op transition would let a caller report having changed something
    // when nothing happened.
    fc.assert(
      fc.property(anyState, (state) => {
        expect(canTransitionDevice(state, state)).toBe(false);
      }),
    );
  });

  it("allows revocation from every non-revoked state", () => {
    // Including `pending`: an authorization the owner did not expect must be
    // stoppable before the device ever connects.
    fc.assert(
      fc.property(
        anyState.filter((state) => state !== "revoked"),
        (state) => {
          expect(canTransitionDevice(state, "revoked")).toBe(true);
        },
      ),
    );
  });

  it("raises rather than silently returning the old state", () => {
    fc.assert(
      fc.property(anyState, anyState, (from, to) => {
        if (canTransitionDevice(from, to)) {
          expect(transitionDevice(from, to)).toBe(to);
        } else {
          expect(() => transitionDevice(from, to)).toThrow(DeviceTransitionError);
        }
      }),
    );
  });
});

describe("what a state permits", () => {
  it("lets the owner administer anything but a revoked device", () => {
    fc.assert(
      fc.property(anyState, (state) => {
        expect(isDeviceOperable(state)).toBe(state !== "revoked");
      }),
    );
  });

  it("grants synchronization keys to active devices alone", () => {
    // A pending device has not confirmed itself, and one awaiting
    // reauthorization is precisely the case where the owner has doubts.
    // Handing either a key would make the state cosmetic.
    fc.assert(
      fc.property(anyState, (state) => {
        expect(mayHoldSynchronizationKey(state)).toBe(state === "active");
      }),
    );
  });

  it("never grants a key to a device it will not let the owner administer", () => {
    // The two rules must not disagree: a device the owner cannot act on must
    // not be holding key material either.
    fc.assert(
      fc.property(anyState, (state) => {
        if (mayHoldSynchronizationKey(state)) {
          expect(isDeviceOperable(state)).toBe(true);
        }
      }),
    );
  });
});

describe("storage limits", () => {
  it("accepts any positive integer and no limit at all", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (limit) => {
        expect(isValidStorageLimit(limit)).toBe(true);
      }),
    );
    expect(isValidStorageLimit(null)).toBe(true);
  });

  it("refuses zero and anything below it", () => {
    // A device allowed to store nothing cannot hold the local projection at
    // all. An owner setting it would be disabling the device without being
    // told they had.
    fc.assert(
      fc.property(fc.integer({ min: Number.MIN_SAFE_INTEGER, max: 0 }), (limit) => {
        expect(isValidStorageLimit(limit)).toBe(false);
      }),
    );
  });

  it("refuses a fractional limit", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 1000, noNaN: true }).filter((value) => !Number.isInteger(value)),
        (limit) => {
          expect(isValidStorageLimit(limit)).toBe(false);
        },
      ),
    );
  });
});
