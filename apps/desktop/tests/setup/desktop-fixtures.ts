import type { DesktopServerProfile } from "../../src/ipc-contract.ts";

export function sampleProfile(overrides: Partial<DesktopServerProfile> = {}): DesktopServerProfile {
  return {
    profileId: "00000000-0000-4000-8000-000000000001",
    label: "Local",
    serverUrl: "http://localhost:8080",
    protocolCompatibility: "compatible",
    deviceId: null,
    lastReachability: null,
    lastSyncAt: null,
    active: true,
    ...overrides,
  };
}
