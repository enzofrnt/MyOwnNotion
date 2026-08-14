/**
 * Whether a device may receive synchronization material (T070, US3, FR-009).
 *
 * Revoking a device has to mean something within one request, not at the next
 * key rotation. So the decision is made here, on every delivery, against the
 * device's current state rather than against whatever it was granted when it
 * first connected.
 *
 * The rule itself comes from `@myownnotion/domain`: only an `active` device may
 * hold synchronization key material. A pending device has not confirmed itself,
 * and one awaiting reauthorization is precisely the case where the owner has
 * doubts — handing either one a key would make the state cosmetic.
 *
 * **Refusal is not erasure.** A device denied synchronization keeps the local
 * copy it already holds, sealed under its own device key. Feature 002 cannot
 * reach into a browser and delete anything, and pretending otherwise is what
 * FR-010 forbids the interface from implying.
 */

import { type Database, findDevice, type Transaction } from "@myownnotion/database";
import { type DeviceState, mayHoldSynchronizationKey } from "@myownnotion/domain";

export type SynchronizationRefusal =
  | "device_unknown"
  | "device_revoked"
  | "device_reauthorization_required"
  | "device_pending";

export interface SynchronizationDecision {
  readonly allowed: boolean;
  /** Set only when refused. Safe to log; carries no key material. */
  readonly refusal?: SynchronizationRefusal;
  readonly deviceState?: DeviceState;
}

const REFUSALS: Readonly<Record<Exclude<DeviceState, "active">, SynchronizationRefusal>> = {
  revoked: "device_revoked",
  "reauthorization-required": "device_reauthorization_required",
  pending: "device_pending",
};

/**
 * Decides for one delivery.
 *
 * Takes the owner as well as the device: a device id alone would let a caller
 * ask about someone else's device, and in a single-owner installation that is
 * a distinction the code should still make rather than rely on there being
 * only one owner.
 */
export interface SynchronizationAuthorizationOptions {
  /**
   * Records a refused delivery.
   *
   * Optional, and given only the device id, its state, and the reason — never
   * key material. A refusal that leaves no trace means an owner can see that
   * they revoked a device but never that the device kept trying, which is the
   * part worth knowing.
   */
  readonly reportRefusal?: (refusal: {
    deviceId: string;
    reason: SynchronizationRefusal;
    deviceState?: DeviceState;
  }) => Promise<void>;
}

export async function authorizeSynchronization(
  executor: Database | Transaction,
  input: { ownerId: string; deviceId: string },
  options: SynchronizationAuthorizationOptions = {},
): Promise<SynchronizationDecision> {
  const device = await findDevice(executor, input);
  if (device === null) {
    // Unknown and revoked are reported separately in the log but both refuse.
    // The caller must not vary its response between them: doing so would tell
    // an attacker which device ids exist.
    await options.reportRefusal?.({ deviceId: input.deviceId, reason: "device_unknown" });
    return { allowed: false, refusal: "device_unknown" };
  }
  if (!mayHoldSynchronizationKey(device.state)) {
    const reason = REFUSALS[device.state as Exclude<DeviceState, "active">];
    await options.reportRefusal?.({
      deviceId: input.deviceId,
      reason,
      deviceState: device.state,
    });
    return { allowed: false, refusal: reason, deviceState: device.state };
  }
  return { allowed: true, deviceState: device.state };
}
