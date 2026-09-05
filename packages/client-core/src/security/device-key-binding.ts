/**
 * Binding the local key to the device's trust grant (T070, US3, FR-009, FR-012).
 *
 * The browser holds a sealed copy of the workspace under a device key it never
 * exposes. That key must be usable only while the server still trusts this
 * device — otherwise revoking a device would stop it *synchronizing* while
 * leaving everything it already holds readable on the machine.
 *
 * So the local store follows the trust grant:
 *
 *   - `active` — unlocked;
 *   - `pending`, `reauthorization-required` — **locked, not erased**;
 *   - `revoked` — locked, and the owner is told this copy is no longer trusted.
 *
 * Locking rather than erasing is the whole design. A device awaiting
 * reauthorization is still the owner's, and destroying its queued mutations
 * would lose work the server has not seen yet — the offline edits are exactly
 * what has not been synchronized. FR-024 requires the projection and mutation
 * identities to survive, and they only survive if nothing is deleted.
 */

import type { DeviceState } from "@myownnotion/domain";
import type { LocalKeyManager, LocalKeyState } from "./local-key-state.ts";
import type { SecureKeyStorage } from "./secure-key-storage.ts";

export type LocalAccess = "unlocked" | "locked";

/** Desktop and browser share this contract; Electron stays out of this package. */
export type { SecureKeyStorage };

export interface TrustBindingOutcome {
  readonly access: LocalAccess;
  readonly keyState: LocalKeyState;
  /**
   * Why the store is locked, when it is.
   *
   * Distinguished so the client can say something true: a device the owner
   * revoked is a different situation from one that has simply not confirmed
   * itself yet, and one message for both would be wrong for at least one.
   */
  readonly reason?: "revoked" | "reauthorization-required" | "pending";
}

/** Whether a trust grant permits reading the local sealed store. */
export function trustPermitsLocalAccess(state: DeviceState): boolean {
  return state === "active";
}

/**
 * Aligns the local key with the trust the server reports.
 *
 * Called after every status read, not only on state changes: a client that
 * only reacted to transitions it saw would stay unlocked through the one it
 * missed while offline.
 */
export async function applyTrustGrant(
  keys: LocalKeyManager,
  state: DeviceState,
): Promise<TrustBindingOutcome> {
  if (trustPermitsLocalAccess(state)) {
    // `establish` reopens the stored key. It does not mint a replacement here
    // unless none was ever stored, so an unlock cannot silently orphan the
    // records sealed under the previous one.
    const keyState = await keys.establish();
    return { access: "unlocked", keyState };
  }
  keys.lock();
  return {
    access: "locked",
    keyState: keys.state,
    reason:
      state === "revoked"
        ? "revoked"
        : state === "pending"
          ? "pending"
          : "reauthorization-required",
  };
}
