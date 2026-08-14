/**
 * Authorized device state machine (T064, US3, FR-008, FR-009).
 *
 * The states live here rather than in the repository because they are a rule,
 * not a storage detail: which transitions exist decides what an owner can do
 * about a device they no longer trust, and that answer must be the same
 * wherever it is asked.
 *
 * Four states, and the distinction that matters most is between the last two:
 *
 *   - `pending` — authorized but not yet confirmed by the device itself;
 *   - `active` — in use;
 *   - `reauthorization-required` — **still the owner's device**, but it must
 *     prove itself again before it is trusted;
 *   - `revoked` — **no longer the owner's device**, and terminal.
 *
 * Revocation being terminal is the point. A revoked device that could be
 * restored would mean an attacker who regained a session could undo the one
 * action the owner took against them. Getting the device back means
 * authorizing it afresh, which produces a new row and a new binding.
 */

export const DEVICE_STATES = ["pending", "active", "reauthorization-required", "revoked"] as const;

export type DeviceState = (typeof DEVICE_STATES)[number];

/**
 * What may follow each state.
 *
 * Note that `pending` can be revoked without ever becoming active: an
 * authorization the owner did not expect should be stoppable before the
 * device ever connects.
 */
const DEVICE_TRANSITIONS: Readonly<Record<DeviceState, readonly DeviceState[]>> = {
  pending: ["active", "revoked"],
  active: ["reauthorization-required", "revoked"],
  // Back to active once it proves itself; revocation stays available meanwhile.
  "reauthorization-required": ["active", "revoked"],
  revoked: [],
};

export function allowedDeviceTransitions(from: DeviceState): readonly DeviceState[] {
  return DEVICE_TRANSITIONS[from];
}

export function canTransitionDevice(from: DeviceState, to: DeviceState): boolean {
  return DEVICE_TRANSITIONS[from].includes(to);
}

/** A device in a state that still accepts owner administration. */
export function isDeviceOperable(state: DeviceState): boolean {
  return state !== "revoked";
}

/** A device permitted to hold synchronization key material. */
export function mayHoldSynchronizationKey(state: DeviceState): boolean {
  // Only `active`. A pending device has not confirmed itself, and one awaiting
  // reauthorization is exactly the case where the owner has doubts — handing
  // either one a key would make the state cosmetic.
  return state === "active";
}

export class DeviceTransitionError extends Error {
  readonly from: DeviceState;
  readonly to: DeviceState;

  constructor(from: DeviceState, to: DeviceState) {
    super(`illegal device transition ${from} -> ${to}`);
    this.name = "DeviceTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function transitionDevice(from: DeviceState, to: DeviceState): DeviceState {
  if (!canTransitionDevice(from, to)) {
    throw new DeviceTransitionError(from, to);
  }
  return to;
}

/**
 * Whether a proposed local storage limit is usable.
 *
 * Null means "no limit chosen", which is legal. Zero is not: a device allowed
 * to store nothing cannot hold the local projection at all, and an owner
 * setting it would be disabling the device without being told they had.
 */
export function isValidStorageLimit(limitBytes: number | null): boolean {
  return limitBytes === null || (Number.isSafeInteger(limitBytes) && limitBytes > 0);
}
