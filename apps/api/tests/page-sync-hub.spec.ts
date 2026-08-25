import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { PageSyncHub, type PageSyncHubPeer } from "../src/realtime/page-sync-hub.ts";

function peer(overrides: Partial<PageSyncHubPeer> = {}): PageSyncHubPeer {
  return {
    connectionId: generateUuidV7(),
    ownerId: generateUuidV7(),
    deviceId: generateUuidV7(),
    sendPageAdvance: vi.fn(() => true),
    close: vi.fn(),
    ...overrides,
  };
}

describe("PageSyncHub", () => {
  it("closes every current socket once and releases all server references", () => {
    const hub = new PageSyncHub();
    const first = peer();
    const second = peer();
    hub.add(first);
    hub.add(second);

    hub.close();
    hub.close();

    expect(first.close).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledWith(1001, "server-shutdown");
    expect(second.close).toHaveBeenCalledOnce();
    expect(hub.size).toBe(0);
    hub.publish({ pageId: generateUuidV7(), latestPageSequence: 1 });
    expect(first.sendPageAdvance).not.toHaveBeenCalled();
  });

  it("drops a failed peer while continuing to notify healthy sessions", () => {
    const hub = new PageSyncHub();
    const failed = peer({ sendPageAdvance: vi.fn(() => false) });
    const healthy = peer();
    hub.add(failed);
    hub.add(healthy);
    const event = { pageId: generateUuidV7(), latestPageSequence: 9 };

    hub.publish(event);

    expect(failed.sendPageAdvance).toHaveBeenCalledWith(event);
    expect(healthy.sendPageAdvance).toHaveBeenCalledWith(event);
    expect(hub.size).toBe(1);
  });

  it("refuses two different peers with the same connection identity", () => {
    const hub = new PageSyncHub();
    const first = peer();
    hub.add(first);

    expect(() => hub.add(peer({ connectionId: first.connectionId }))).toThrow(
      "connection identity",
    );
    expect(hub.size).toBe(1);
  });

  it("closes every connection for exactly the revoked owner device", () => {
    const hub = new PageSyncHub();
    const ownerId = generateUuidV7();
    const deviceId = generateUuidV7();
    const firstTab = peer({ ownerId, deviceId });
    const secondTab = peer({ ownerId, deviceId });
    const otherDevice = peer({ ownerId });
    const otherOwner = peer({ deviceId });
    for (const candidate of [firstTab, secondTab, otherDevice, otherOwner]) hub.add(candidate);

    expect(hub.closeDevice(ownerId, deviceId, 4403, "device-revoked")).toBe(2);

    expect(firstTab.close).toHaveBeenCalledWith(4403, "device-revoked");
    expect(secondTab.close).toHaveBeenCalledWith(4403, "device-revoked");
    expect(otherDevice.close).not.toHaveBeenCalled();
    expect(otherOwner.close).not.toHaveBeenCalled();
    expect(hub.size).toBe(2);
  });
});
