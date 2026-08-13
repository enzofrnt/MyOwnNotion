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

import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { authorizedDevices } from "../../schema/security/index.ts";

export type DeviceState = "pending" | "active" | "revoked" | "reauthorization-required";

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
  readonly revokedAt: Date | null;
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
): Promise<AuthorizedDevice> {
  const device = await findDevice(executor, input);
  if (device === null) {
    throw new DeviceRepositoryError("device_not_found", "no such device for this owner");
  }
  if (device.state === "revoked") {
    throw new DeviceRepositoryError("device_revoked", "this device has been revoked");
  }
  return device;
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
  if (input.limitBytes !== null && (!Number.isInteger(input.limitBytes) || input.limitBytes < 0)) {
    throw new DeviceRepositoryError(
      "device_storage_limit_invalid",
      "a storage limit must be a non-negative integer, or null for unlimited",
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
  await requireOperable(executor, input);
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
  await requireOperable(executor, input);
  const rows = await executor
    .update(authorizedDevices)
    .set({ state: "reauthorization-required" })
    .where(eq(authorizedDevices.id, input.deviceId))
    .returning();
  return toDevice(rows[0] as typeof authorizedDevices.$inferSelect);
}
