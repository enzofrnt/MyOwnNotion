/**
 * Authorized device inventory (T067, US3, feature 002).
 *
 * The owner's list of devices is what makes "someone else has my account"
 * actionable: without it, a stolen laptop is invisible and there is nothing to
 * revoke. So the inventory has to be honest about two things that are easy to
 * fake, and this module refuses to fake either.
 *
 *   - **`lastActivityAt` and `lastSyncAt` stay null until something happens.**
 *     They are nullable on purpose. Defaulting them to the authorization time
 *     would show every device as recently active — including one authorized
 *     months ago and never used again, which is exactly the row an owner needs
 *     to notice.
 *   - **Revocation is a write, not a delete.** A revoked device stays in the
 *     table as the durable record of a decision the owner made. Deleting it
 *     would make "did I revoke that, or did it never exist?" unanswerable, and
 *     the audit trail refers to the row.
 *
 * `reauthorization-required` is a third state rather than a flag on `revoked`
 * because the two mean different things to the person deciding: a device that
 * must prove itself again is still theirs, and one they revoked is not.
 */

import {
  canTransitionDevice,
  type DeviceState,
  isDeviceOperable,
  isValidStorageLimit,
} from "@myownnotion/domain";
import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { authorizedDevices } from "../../schema/security/index.ts";

export interface AuthorizedDevice {
  readonly id: string;
  readonly ownerId: string;
  readonly deviceBindingId: string;
  readonly name: string;
  readonly platform: string | null;
  readonly state: DeviceState;
  readonly authorizedAt: Date;
  /** Null until the device has actually been used. Never synthesized. */
  readonly lastActivityAt: Date | null;
  /** Null until the device has actually synchronized. Never synthesized. */
  readonly lastSyncAt: Date | null;
  readonly localStorageLimitBytes: number | null;
  readonly localStorageUsedBytes: number;
  /**
   * How this device protects its local key material, as it reported.
   *
   * Null when the device never said. That is not the same as `unavailable`,
   * which is the device stating it has no secure storage — and the difference
   * decides whether the owner is looking at an old client or a weakly
   * protected one.
   */
  readonly keyProtectionCapability: string | null;
  /**
   * Which generation of device key this device holds.
   *
   * Persisted so a rotation can tell which devices still carry the old one
   * without asking them.
   */
  readonly deviceKeyVersion: number;
  readonly revokedAt: Date | null;
}

export interface AuthenticationDeviceClaim {
  readonly device: AuthorizedDevice;
  readonly disposition: "created" | "existing" | "reauthorized";
}

export class DeviceRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeviceRepositoryError";
    this.code = code;
  }
}

type Executor = Database | Transaction;

function toDevice(row: typeof authorizedDevices.$inferSelect): AuthorizedDevice {
  return {
    id: row.id,
    ownerId: row.ownerId,
    deviceBindingId: row.deviceBindingId,
    name: row.name,
    platform: row.platform ?? null,
    state: row.state as DeviceState,
    authorizedAt: row.authorizedAt,
    lastActivityAt: row.lastActivityAt ?? null,
    lastSyncAt: row.lastSyncAt ?? null,
    localStorageLimitBytes: row.localStorageLimitBytes ?? null,
    localStorageUsedBytes: row.localStorageUsedBytes,
    keyProtectionCapability: row.keyProtectionCapability ?? null,
    deviceKeyVersion: row.deviceKeyVersion,
    revokedAt: row.revokedAt ?? null,
  };
}

/**
 * The owner's devices, oldest authorization first.
 *
 * Revoked devices are included. An inventory that hid them would answer "which
 * devices did I revoke?" with silence, and that is a question owners ask right
 * after they revoke something.
 */
export async function listDevices(
  executor: Executor,
  ownerId: string,
): Promise<AuthorizedDevice[]> {
  const rows = await executor
    .select()
    .from(authorizedDevices)
    .where(eq(authorizedDevices.ownerId, ownerId))
    .orderBy(authorizedDevices.authorizedAt);
  return rows.map(toDevice);
}

export async function findDevice(
  executor: Executor,
  input: { ownerId: string; deviceId: string },
): Promise<AuthorizedDevice | null> {
  const rows = await executor
    .select()
    .from(authorizedDevices)
    .where(
      and(eq(authorizedDevices.id, input.deviceId), eq(authorizedDevices.ownerId, input.ownerId)),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toDevice(row);
}

async function findDeviceForUpdate(
  executor: Executor,
  input: { ownerId: string; deviceId: string },
): Promise<AuthorizedDevice | null> {
  const rows = await executor
    .select()
    .from(authorizedDevices)
    .where(
      and(eq(authorizedDevices.id, input.deviceId), eq(authorizedDevices.ownerId, input.ownerId)),
    )
    .for("update")
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toDevice(row);
}

async function findDeviceByBindingForUpdate(
  executor: Executor,
  input: { ownerId: string; deviceBindingId: string },
): Promise<AuthorizedDevice | null> {
  const rows = await executor
    .select()
    .from(authorizedDevices)
    .where(
      and(
        eq(authorizedDevices.ownerId, input.ownerId),
        eq(authorizedDevices.deviceBindingId, input.deviceBindingId),
      ),
    )
    .for("update")
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toDevice(row);
}

/**
 * Resolves the exact browser binding after an owner credential was verified.
 *
 * The proposed UUID is used only for a genuinely new binding. An existing row
 * always wins, a reauthorization request is completed by this fresh proof,
 * and revocation is terminal. In particular, this function never chooses some
 * other active device merely because it belongs to the same owner.
 */
export async function claimDeviceForAuthentication(
  executor: Executor,
  input: {
    ownerId: string;
    proposedDeviceId: string;
    deviceBindingId: string;
    name: string;
    platform: string;
    now: Date;
  },
): Promise<AuthenticationDeviceClaim> {
  const resolveExisting = async (
    existing: AuthorizedDevice,
  ): Promise<AuthenticationDeviceClaim> => {
    if (existing.state === "revoked") {
      throw new DeviceRepositoryError("device_revoked", "this device has been revoked");
    }
    if (existing.state === "active") {
      return { device: existing, disposition: "existing" };
    }
    requireTransition(existing.state, "active");
    const rows = await executor
      .update(authorizedDevices)
      .set({ state: "active", revokedAt: null })
      .where(eq(authorizedDevices.id, existing.id))
      .returning();
    return {
      device: toDevice(rows[0] as typeof authorizedDevices.$inferSelect),
      disposition: "reauthorized",
    };
  };

  const existing = await findDeviceByBindingForUpdate(executor, input);
  if (existing !== null) return await resolveExisting(existing);

  const rows = await executor
    .insert(authorizedDevices)
    .values({
      id: input.proposedDeviceId,
      ownerId: input.ownerId,
      deviceBindingId: input.deviceBindingId,
      name: input.name,
      platform: input.platform,
      clientType: "web",
      state: "active",
      authorizedAt: input.now,
      lastActivityAt: null,
      lastSyncAt: null,
    })
    .onConflictDoNothing({
      target: [authorizedDevices.ownerId, authorizedDevices.deviceBindingId],
    })
    .returning();
  const inserted = rows[0];
  if (inserted !== undefined) {
    return { device: toDevice(inserted), disposition: "created" };
  }

  // A concurrent login inserted the same profile binding. Resolve that row
  // under the same rules rather than manufacturing a second identity.
  const raced = await findDeviceByBindingForUpdate(executor, input);
  if (raced === null) {
    throw new DeviceRepositoryError(
      "device_not_found",
      "concurrent device authorization did not leave a resolvable row",
    );
  }
  return await resolveExisting(raced);
}

/**
 * Serializes page writes with revocation on the same durable device row.
 * Callers must keep this lock until their synchronization transaction commits.
 */
export async function lockDeviceForSynchronization(
  tx: Transaction,
  input: { ownerId: string; deviceId: string },
): Promise<AuthorizedDevice | null> {
  return await findDeviceForUpdate(tx, input);
}

/**
 * Loads a device that must be operable, or refuses.
 *
 * Used by every mutation below. A revoked device is not renamed, not given a
 * new storage limit, and not revoked twice: acting on it would let a stale UI
 * quietly resurrect something the owner shut down.
 */
async function requireOperable(
  executor: Executor,
  input: { ownerId: string; deviceId: string },
  lock = false,
): Promise<AuthorizedDevice> {
  const device = lock
    ? await findDeviceForUpdate(executor, input)
    : await findDevice(executor, input);
  if (device === null) {
    throw new DeviceRepositoryError("device_not_found", "no such device for this owner");
  }
  // The rule comes from the domain, so the repository and any other caller
  // cannot end up with two ideas of what a revoked device may still do.
  if (!isDeviceOperable(device.state)) {
    throw new DeviceRepositoryError("device_revoked", "this device has been revoked");
  }
  return device;
}

/**
 * Refuses a transition the domain does not allow.
 *
 * Separate from `requireOperable` because the two answer different questions:
 * one asks whether the owner may act on the device at all, the other whether
 * this particular change is a legal step. Asking a device already awaiting
 * reauthorization to reauthorize is refused here, not silently repeated.
 */
function requireTransition(from: DeviceState, to: DeviceState): void {
  if (!canTransitionDevice(from, to)) {
    throw new DeviceRepositoryError(
      "device_transition_invalid",
      `a device cannot go from ${from} to ${to}`,
    );
  }
}

export async function renameDevice(
  executor: Executor,
  input: { ownerId: string; deviceId: string; name: string },
): Promise<AuthorizedDevice> {
  await requireOperable(executor, input);
  const name = input.name.trim();
  if (name.length === 0) {
    throw new DeviceRepositoryError("device_name_invalid", "a device name cannot be empty");
  }
  const rows = await executor
    .update(authorizedDevices)
    .set({ name })
    .where(eq(authorizedDevices.id, input.deviceId))
    .returning();
  return toDevice(rows[0] as typeof authorizedDevices.$inferSelect);
}

export async function setLocalStorageLimit(
  executor: Executor,
  input: { ownerId: string; deviceId: string; limitBytes: number | null },
): Promise<AuthorizedDevice> {
  await requireOperable(executor, input);
  if (!isValidStorageLimit(input.limitBytes)) {
    throw new DeviceRepositoryError(
      "device_storage_limit_invalid",
      "a storage limit must be a positive integer, or null for no limit",
    );
  }
  const rows = await executor
    .update(authorizedDevices)
    .set({ localStorageLimitBytes: input.limitBytes })
    .where(eq(authorizedDevices.id, input.deviceId))
    .returning();
  return toDevice(rows[0] as typeof authorizedDevices.$inferSelect);
}

/**
 * Revokes a device.
 *
 * Idempotent by refusal rather than by silence: revoking an already-revoked
 * device raises, so a caller cannot report a second revocation as if it had
 * done something. `revokedAt` keeps its original instant.
 */
export async function revokeDevice(
  executor: Executor,
  input: { ownerId: string; deviceId: string; now: Date },
): Promise<AuthorizedDevice> {
  const current = await requireOperable(executor, input, true);
  requireTransition(current.state, "revoked");
  const rows = await executor
    .update(authorizedDevices)
    .set({ state: "revoked", revokedAt: input.now })
    .where(eq(authorizedDevices.id, input.deviceId))
    .returning();
  return toDevice(rows[0] as typeof authorizedDevices.$inferSelect);
}

/**
 * Marks a device as needing to prove itself again.
 *
 * Distinct from revocation: the device is still the owner's, and the next
 * successful authentication returns it to `active`.
 */
export async function requireDeviceReauthorization(
  executor: Executor,
  input: { ownerId: string; deviceId: string },
): Promise<AuthorizedDevice> {
  const current = await requireOperable(executor, input, true);
  requireTransition(current.state, "reauthorization-required");
  const rows = await executor
    .update(authorizedDevices)
    .set({ state: "reauthorization-required" })
    .where(eq(authorizedDevices.id, input.deviceId))
    .returning();
  return toDevice(rows[0] as typeof authorizedDevices.$inferSelect);
}
