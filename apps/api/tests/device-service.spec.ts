/**
 * Mapping devices from rows to the contract (T068, US3, FR-008 – FR-010).
 *
 * The repository and the contract disagree in three places, and each one is a
 * decision rather than a cast. These tests pin the decisions, because getting
 * any of them wrong is invisible in a round trip and very visible to the owner
 * reading their device list.
 */

import type { AuthorizedDevice } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_STORAGE_LIMIT_BYTES, toDeviceDto } from "../src/security/device-service.ts";

function device(overrides: Partial<AuthorizedDevice> = {}): AuthorizedDevice {
  return {
    id: generateUuidV7(),
    ownerId: generateUuidV7(),
    deviceBindingId: "binding",
    name: "Laptop",
    platform: "macOS",
    state: "active",
    authorizedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastActivityAt: null,
    lastSyncAt: null,
    localStorageLimitBytes: null,
    localStorageUsedBytes: 0,
    keyProtectionCapability: null,
    deviceKeyVersion: 1,
    revokedAt: null,
    ...overrides,
  };
}

describe("the three places the row and the contract disagree", () => {
  it("carries a never-used device through as null", () => {
    // The one field where null must survive untouched. The contract makes
    // these required *and* nullable on purpose: optional would make "never
    // used" and "not implemented" the same answer.
    const dto = toDeviceDto(device());
    expect(dto.lastActivityAt).toBeNull();
    expect(dto.lastSyncAt).toBeNull();
  });

  it("substitutes a default limit rather than reporting zero", () => {
    // The contract has no way to say "unset" — the field is a required
    // positive integer. A zero would read as "this device may store nothing"
    // and the owner would act on it.
    const dto = toDeviceDto(device({ localStorageLimitBytes: null }));
    expect(dto.localStorageLimitBytes).toBe(DEFAULT_LOCAL_STORAGE_LIMIT_BYTES);
    expect(dto.localStorageLimitBytes).toBeGreaterThan(0);
  });

  it("keeps an explicit limit exactly as set", () => {
    const dto = toDeviceDto(device({ localStorageLimitBytes: 512 }));
    expect(dto.localStorageLimitBytes).toBe(512);
  });

  it("names an unknown platform rather than omitting it", () => {
    const dto = toDeviceDto(device({ platform: null }));
    expect(dto.platform).toBe("unknown");
  });
});

describe("how a device says it protects its key", () => {
  it("omits the field when the device never said", () => {
    // Silence is not "unavailable". A device that predates the question is
    // not a weakly protected one, and telling the owner otherwise would send
    // them revoking something that is fine.
    const dto = toDeviceDto(device({ keyProtectionCapability: null }));
    expect(dto.keyProtection).toBeUndefined();
  });

  it("reports what the device actually claimed", () => {
    const dto = toDeviceDto(device({ keyProtectionCapability: "platform-secure-storage" }));
    expect(dto.keyProtection).toBe("platform-secure-storage");
  });

  it("drops a value the contract does not define", () => {
    // The column is free text. Passing an unknown value straight through would
    // fail response serialization and turn a stale client into a 500.
    const dto = toDeviceDto(device({ keyProtectionCapability: "something-invented" }));
    expect(dto.keyProtection).toBeUndefined();
  });
});

describe("what the owner sees", () => {
  it("reports real timestamps as ISO instants", () => {
    const at = new Date("2026-03-04T05:06:07.000Z");
    const dto = toDeviceDto(device({ lastActivityAt: at, lastSyncAt: at }));
    expect(dto.lastActivityAt).toBe("2026-03-04T05:06:07.000Z");
    expect(dto.lastSyncAt).toBe("2026-03-04T05:06:07.000Z");
  });

  it("shows a revoked device as revoked", () => {
    const dto = toDeviceDto(device({ state: "revoked", revokedAt: new Date() }));
    expect(dto.state).toBe("revoked");
  });

  it("distinguishes reauthorization from revocation", () => {
    const dto = toDeviceDto(device({ state: "reauthorization-required" }));
    expect(dto.state).toBe("reauthorization-required");
  });

  it("exposes no binding identifier or owner id", () => {
    // The device binding is how a device proves it is itself. It has no reason
    // to travel to the browser, and an inventory response is the easiest place
    // for it to leak.
    const dto = toDeviceDto(device({ deviceBindingId: "secret-binding" }));
    expect(JSON.stringify(dto)).not.toContain("secret-binding");
    expect(Object.keys(dto)).not.toContain("ownerId");
  });
});
