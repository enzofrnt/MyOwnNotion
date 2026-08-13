/**
 * Device inspection and administration (T068, US3, FR-008 – FR-010).
 *
 * Sits between the repository, which knows the rows, and the routes, which
 * know the contract. It exists because those two disagree in three specific
 * places, and each disagreement has to be resolved deliberately rather than by
 * a cast:
 *
 *   - the contract requires `platform`, the column is nullable;
 *   - the contract requires a positive `localStorageLimitBytes`, the column is
 *     nullable and null means "no limit set";
 *   - the contract's `lastActivityAt`/`lastSyncAt` are required *and*
 *     nullable, which is the one place where null must survive the mapping
 *     untouched. Making them optional would make "never used" and "this field
 *     is not implemented" the same answer to the owner.
 */

import type { DeviceDto } from "@myownnotion/contracts";
import {
  type AuthorizedDevice,
  type Database,
  findDevice,
  listDevices,
  renameDevice,
  requireDeviceReauthorization,
  revokeDevice,
  setLocalStorageLimit,
  type Transaction,
} from "@myownnotion/database";

/**
 * What a device is allowed to keep locally when the owner has not chosen.
 *
 * The contract has no way to say "unset" — `localStorageLimitBytes` is a
 * required positive integer — so an unconfigured device reports this default
 * rather than a zero, which the owner would read as "this device may store
 * nothing" and act on.
 */
export const DEFAULT_LOCAL_STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

/** Shown when a device never reported one. Never invented per request. */
const UNKNOWN_PLATFORM = "unknown";

export interface DeviceServiceDeps {
  readonly db: Database;
  readonly now: () => Date;
}

type KeyProtection = NonNullable<DeviceDto["keyProtection"]>;

const KEY_PROTECTIONS: readonly KeyProtection[] = [
  "platform-secure-storage",
  "browser-non-exportable",
  "unavailable",
];

/** Guards the column, which is free text, against the contract union. */
function isKeyProtection(value: string | null): value is KeyProtection {
  return value !== null && (KEY_PROTECTIONS as readonly string[]).includes(value);
}

export function toDeviceDto(device: AuthorizedDevice): DeviceDto {
  return {
    deviceId: device.id,
    name: device.name,
    platform: device.platform ?? UNKNOWN_PLATFORM,
    clientType: "web",
    authorizedAt: device.authorizedAt.toISOString(),
    // The two fields that must carry null through. See the module comment.
    lastActivityAt: device.lastActivityAt?.toISOString() ?? null,
    lastSyncAt: device.lastSyncAt?.toISOString() ?? null,
    state: device.state,
    localStorageLimitBytes: device.localStorageLimitBytes ?? DEFAULT_LOCAL_STORAGE_LIMIT_BYTES,
    localUsageBytes: device.localStorageUsedBytes,
    // Omitted when the device never reported one. The contract makes this
    // optional precisely so silence stays distinguishable from a device
    // stating it has no secure storage — the owner should not be told a
    // device is weakly protected when it simply predates the question.
    ...(isKeyProtection(device.keyProtectionCapability)
      ? { keyProtection: device.keyProtectionCapability }
      : {}),
  };
}

export class DeviceService {
  readonly #deps: DeviceServiceDeps;

  constructor(deps: DeviceServiceDeps) {
    this.#deps = deps;
  }

  #executor(tx?: Transaction): Database | Transaction {
    return tx ?? this.#deps.db;
  }

  async inventory(ownerId: string, tx?: Transaction): Promise<DeviceDto[]> {
    const devices = await listDevices(this.#executor(tx), ownerId);
    return devices.map(toDeviceDto);
  }

  async inspect(
    input: { ownerId: string; deviceId: string },
    tx?: Transaction,
  ): Promise<DeviceDto | null> {
    const device = await findDevice(this.#executor(tx), input);
    return device === null ? null : toDeviceDto(device);
  }

  /**
   * Applies a partial update.
   *
   * The contract guarantees at least one field is present, so an update that
   * changes nothing cannot reach here. Both fields are applied in one call
   * rather than two round trips, and either one being refused refuses the
   * whole update — a rename that succeeded while the limit failed would leave
   * the owner unsure which half took effect.
   */
  async update(
    input: {
      ownerId: string;
      deviceId: string;
      name?: string | undefined;
      localStorageLimitBytes?: number | undefined;
    },
    tx?: Transaction,
  ): Promise<DeviceDto> {
    const executor = this.#executor(tx);
    let device: AuthorizedDevice | null = null;
    if (input.name !== undefined) {
      device = await renameDevice(executor, {
        ownerId: input.ownerId,
        deviceId: input.deviceId,
        name: input.name,
      });
    }
    if (input.localStorageLimitBytes !== undefined) {
      device = await setLocalStorageLimit(executor, {
        ownerId: input.ownerId,
        deviceId: input.deviceId,
        limitBytes: input.localStorageLimitBytes,
      });
    }
    if (device === null) {
      // Unreachable through the routes, which validate `minProperties: 1`.
      // Kept as a refusal rather than a silent read so a future caller that
      // bypasses the schema does not get a no-op reported as a success.
      throw new Error("a device update must change at least one field");
    }
    return toDeviceDto(device);
  }

  /**
   * Revokes a device.
   *
   * Denying it the synchronization key is not a separate step: `revoked` is
   * checked wherever a device asks for one, so revocation takes effect for the
   * next request rather than at the next key rotation.
   */
  async revoke(input: { ownerId: string; deviceId: string }, tx?: Transaction): Promise<DeviceDto> {
    const device = await revokeDevice(this.#executor(tx), {
      ...input,
      now: this.#deps.now(),
    });
    return toDeviceDto(device);
  }

  /** Requires the device to prove itself again, without cutting it off. */
  async requireReauthorization(
    input: { ownerId: string; deviceId: string },
    tx?: Transaction,
  ): Promise<DeviceDto> {
    const device = await requireDeviceReauthorization(this.#executor(tx), input);
    return toDeviceDto(device);
  }
}
