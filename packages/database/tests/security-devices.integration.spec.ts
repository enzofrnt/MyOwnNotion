/**
 * Authorized device inventory (T065, US3, FR-008, FR-010).
 *
 * The inventory is what makes "someone else has access" actionable. A stolen
 * laptop is invisible without it, and there is nothing to revoke. So these
 * tests are less about CRUD than about the inventory telling the truth:
 *
 *   - a device that has never been used says so, rather than borrowing its
 *     authorization time and appearing recently active;
 *   - a revoked device stays visible, because "did I revoke that?" is the
 *     question an owner asks immediately afterwards;
 *   - nothing acts on a revoked device, so a stale tab cannot resurrect it.
 */

import { randomUUID } from "node:crypto";
import {
  type AuthorizedDevice,
  createInstallation,
  DeviceRepositoryError,
  findDevice,
  listDevices,
  recordDeviceActivity,
  renameDevice,
  requireDeviceReauthorization,
  revokeDevice,
  schema,
  setLocalStorageLimit,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSecurityIntegrationContext,
  type SecurityIntegrationContext,
} from "./helpers/security-db.ts";

let context: SecurityIntegrationContext;
const ownerId = generateUuidV7();

beforeAll(async () => {
  context = await createSecurityIntegrationContext();
  // The helper deliberately leaves the installation absent so a security trial
  // can observe an empty one; the owner row needs it to exist.
  await createInstallation(context.handle.db, {
    id: context.installation.installationId,
    sourceLineageId: context.installation.installationId,
    schemaVersion: 1,
  });
}, 180_000);

afterAll(async () => {
  await context?.close();
});

beforeEach(async () => {
  await context.handle.db.delete(schema.authorizedDevices);
  await context.handle.db
    .insert(schema.owners)
    .values({
      id: ownerId,
      installationId: context.installation.installationId,
      createdAt: context.clock.now(),
    })
    .onConflictDoNothing();
});

async function authorize(
  overrides: Partial<{ name: string; platform: string; state: string }> = {},
): Promise<string> {
  const id = generateUuidV7();
  await context.handle.db.insert(schema.authorizedDevices).values({
    id,
    ownerId,
    deviceBindingId: randomUUID(),
    name: overrides.name ?? "Laptop",
    platform: overrides.platform ?? "macOS",
    clientType: "web",
    state: overrides.state ?? "active",
    authorizedAt: context.clock.now(),
    // Exactly as the bootstrap promotion writes them: null until something
    // real happens.
    lastActivityAt: null,
    lastSyncAt: null,
  });
  return id;
}

describe("what the inventory shows", () => {
  it("lists two devices in authorization order", async () => {
    const first = await authorize({ name: "Laptop" });
    context.clock.advanceMs(60_000);
    const second = await authorize({ name: "Phone" });

    const devices = await listDevices(context.handle.db, ownerId);
    expect(devices.map((device) => device.id)).toEqual([first, second]);
    expect(devices.map((device) => device.name)).toEqual(["Laptop", "Phone"]);
  });

  it("reports a never-used device as never used", async () => {
    // The property FR-010 depends on. Defaulting these to the authorization
    // time would show a device authorized months ago and never touched since
    // as recently active — hiding the one row worth noticing.
    await authorize();
    const [device] = await listDevices(context.handle.db, ownerId);
    expect(device?.lastActivityAt).toBeNull();
    expect(device?.lastSyncAt).toBeNull();
  });

  it("keeps a revoked device visible", async () => {
    const id = await authorize();
    await revokeDevice(context.handle.db, { ownerId, deviceId: id, now: context.clock.now() });

    const devices = await listDevices(context.handle.db, ownerId);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.state).toBe("revoked");
    expect(devices[0]?.revokedAt).not.toBeNull();
  });

  it("shows one owner nothing of another's", async () => {
    await authorize();
    expect(await listDevices(context.handle.db, generateUuidV7())).toHaveLength(0);
  });
});

describe("recording real events", () => {
  it("sets lastActivityAt only when activity happens", async () => {
    const id = await authorize();
    const at = context.clock.now();
    await recordDeviceActivity(context.handle.db, { deviceId: id, now: at, kind: "activity" });

    const device = (await findDevice(context.handle.db, {
      ownerId,
      deviceId: id,
    })) as AuthorizedDevice;
    expect(device.lastActivityAt?.getTime()).toBe(at.getTime());
    // A device that was active has not necessarily synchronized.
    expect(device.lastSyncAt).toBeNull();
  });

  it("counts a synchronization as activity too", async () => {
    // A device that synced was reachable and in use. Leaving lastActivityAt
    // behind would show it as dormant in the very inventory meant to surface
    // dormant devices.
    const id = await authorize();
    const at = context.clock.now();
    await recordDeviceActivity(context.handle.db, { deviceId: id, now: at, kind: "sync" });

    const device = (await findDevice(context.handle.db, {
      ownerId,
      deviceId: id,
    })) as AuthorizedDevice;
    expect(device.lastSyncAt?.getTime()).toBe(at.getTime());
    expect(device.lastActivityAt?.getTime()).toBe(at.getTime());
  });

  it("does not touch the timestamps when the owner edits a name", async () => {
    // Renaming is not use. If editing the inventory updated activity, the
    // inventory would report on itself rather than on the devices.
    const id = await authorize();
    await renameDevice(context.handle.db, { ownerId, deviceId: id, name: "Work laptop" });

    const device = (await findDevice(context.handle.db, {
      ownerId,
      deviceId: id,
    })) as AuthorizedDevice;
    expect(device.name).toBe("Work laptop");
    expect(device.lastActivityAt).toBeNull();
  });
});

describe("editing a device", () => {
  it("trims a rename and refuses an empty one", async () => {
    const id = await authorize();
    const renamed = await renameDevice(context.handle.db, {
      ownerId,
      deviceId: id,
      name: "  Studio iMac  ",
    });
    expect(renamed.name).toBe("Studio iMac");

    await expect(
      renameDevice(context.handle.db, { ownerId, deviceId: id, name: "   " }),
    ).rejects.toBeInstanceOf(DeviceRepositoryError);
  });

  it("sets and clears a local storage limit", async () => {
    const id = await authorize();
    const limited = await setLocalStorageLimit(context.handle.db, {
      ownerId,
      deviceId: id,
      limitBytes: 5_000_000,
    });
    expect(limited.localStorageLimitBytes).toBe(5_000_000);

    const unlimited = await setLocalStorageLimit(context.handle.db, {
      ownerId,
      deviceId: id,
      limitBytes: null,
    });
    expect(unlimited.localStorageLimitBytes).toBeNull();
  });

  it("refuses a negative storage limit", async () => {
    const id = await authorize();
    await expect(
      setLocalStorageLimit(context.handle.db, { ownerId, deviceId: id, limitBytes: -1 }),
    ).rejects.toBeInstanceOf(DeviceRepositoryError);
  });
});

describe("a revoked device is finished", () => {
  it("refuses every further action on it", async () => {
    // A stale tab must not be able to rename, re-limit, or re-revoke something
    // the owner has already shut down.
    const id = await authorize();
    await revokeDevice(context.handle.db, { ownerId, deviceId: id, now: context.clock.now() });

    await expect(
      renameDevice(context.handle.db, { ownerId, deviceId: id, name: "Nice try" }),
    ).rejects.toMatchObject({ code: "device_revoked" });
    await expect(
      setLocalStorageLimit(context.handle.db, { ownerId, deviceId: id, limitBytes: 1 }),
    ).rejects.toMatchObject({ code: "device_revoked" });
    await expect(
      revokeDevice(context.handle.db, { ownerId, deviceId: id, now: context.clock.now() }),
    ).rejects.toMatchObject({ code: "device_revoked" });
  });

  it("keeps the instant of the original revocation", async () => {
    const id = await authorize();
    const revokedAt = context.clock.now();
    await revokeDevice(context.handle.db, { ownerId, deviceId: id, now: revokedAt });
    context.clock.advanceMs(3_600_000);

    const device = (await findDevice(context.handle.db, {
      ownerId,
      deviceId: id,
    })) as AuthorizedDevice;
    expect(device.revokedAt?.getTime()).toBe(revokedAt.getTime());
  });
});

describe("reauthorization is not revocation", () => {
  it("is a separate state the device can leave", async () => {
    // The distinction matters to the person deciding: a device that must prove
    // itself again is still theirs; one they revoked is not.
    const id = await authorize();
    const flagged = await requireDeviceReauthorization(context.handle.db, {
      ownerId,
      deviceId: id,
    });
    expect(flagged.state).toBe("reauthorization-required");
    expect(flagged.revokedAt).toBeNull();

    // Asking twice is refused rather than silently repeated: the second call
    // did nothing, and reporting it as success would tell the owner an action
    // took place that did not.
    await expect(
      requireDeviceReauthorization(context.handle.db, { ownerId, deviceId: id }),
    ).rejects.toMatchObject({ code: "device_transition_invalid" });

    // And unlike revocation, it does not close the device off.
    const renamed = await renameDevice(context.handle.db, {
      ownerId,
      deviceId: id,
      name: "Still mine",
    });
    expect(renamed.name).toBe("Still mine");
  });
});

describe("a device that does not exist", () => {
  it("is refused rather than silently ignored", async () => {
    await expect(
      renameDevice(context.handle.db, {
        ownerId,
        deviceId: generateUuidV7(),
        name: "Ghost",
      }),
    ).rejects.toMatchObject({ code: "device_not_found" });
  });

  it("is refused when it belongs to another owner", async () => {
    const id = await authorize();
    await expect(
      revokeDevice(context.handle.db, {
        ownerId: generateUuidV7(),
        deviceId: id,
        now: context.clock.now(),
      }),
    ).rejects.toMatchObject({ code: "device_not_found" });
  });
});
