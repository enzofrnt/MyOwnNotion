import { describe, expect, it, vi } from "vitest";
import { createChangeStreamHeartbeat } from "../src/sync/change-stream-heartbeat.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function fixture() {
  const input = {
    initialCursor: 3,
    revoked: vi.fn(async () => false),
    currentCursor: vi.fn(async () => 3),
    advanced: vi.fn(),
    keepAlive: vi.fn(),
    close: vi.fn(),
  };
  return { input, heartbeat: createChangeStreamHeartbeat(input) };
}
describe("SSE canonical heartbeat boundaries", () => {
  it("checks access first and announces only an actual cursor advance", async () => {
    const { input, heartbeat } = fixture();
    await heartbeat.tick();
    expect(input.advanced).not.toHaveBeenCalled();
    expect(input.keepAlive).toHaveBeenCalledOnce();
    input.currentCursor.mockImplementation(async () => 4);
    await heartbeat.tick();
    await heartbeat.tick();
    expect(input.advanced).toHaveBeenCalledExactlyOnceWith(4);
    expect(input.revoked.mock.invocationCallOrder[0]).toBeLessThan(
      input.currentCursor.mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("closes a revoked device before reading or announcing any cursor", async () => {
    const { input, heartbeat } = fixture();
    input.revoked.mockResolvedValue(true);
    await heartbeat.tick();
    heartbeat.announce(99);
    await heartbeat.tick();
    expect(input.close).toHaveBeenCalledOnce();
    expect(input.currentCursor).not.toHaveBeenCalled();
    expect(input.advanced).not.toHaveBeenCalled();
    expect(input.keepAlive).not.toHaveBeenCalled();
  });
  it("coalesces overlapping ticks and never regresses an immediate local announcement", async () => {
    const { input, heartbeat } = fixture();
    const cursor = deferred<number>();
    input.currentCursor.mockImplementation(() => cursor.promise);
    const first = heartbeat.tick();
    await Promise.resolve();
    await heartbeat.tick();
    expect(input.currentCursor).toHaveBeenCalledOnce();
    heartbeat.announce(8);
    cursor.resolve(5);
    await first;
    heartbeat.announce(7);
    heartbeat.announce(Number.NaN);
    expect(input.advanced).toHaveBeenCalledExactlyOnceWith(8);
  });
  it("ignores late reads after closure without writing to a dead stream", async () => {
    const { input, heartbeat } = fixture();
    const cursor = deferred<number>();
    input.currentCursor.mockImplementation(() => cursor.promise);
    const pending = heartbeat.tick();
    await Promise.resolve();
    heartbeat.stop();
    cursor.resolve(99);
    await pending;
    expect(input.advanced).not.toHaveBeenCalled();
    expect(input.keepAlive).not.toHaveBeenCalled();
    expect(input.close).not.toHaveBeenCalled();
  });
  it("does not start a cursor read if the stream closes during its access check", async () => {
    const { input, heartbeat } = fixture();
    const permission = deferred<boolean>();
    input.revoked.mockImplementation(() => permission.promise);
    const pending = heartbeat.tick();
    heartbeat.stop();
    permission.resolve(false);
    await pending;
    expect(input.currentCursor).not.toHaveBeenCalled();
  });
  it.each(["revoked", "currentCursor", "advanced", "keepAlive"] as const)(
    "ends a failed %s operation without logging or leaving an unhandled rejection",
    async (operation) => {
      const { input, heartbeat } = fixture();
      input.currentCursor.mockImplementation(async () => 4);
      input[operation].mockImplementation(() => {
        throw new Error("private diagnostic must not escape");
      });
      await expect(heartbeat.tick()).resolves.toBeUndefined();
      await heartbeat.tick();
      expect(input.close).toHaveBeenCalledOnce();
    },
  );
  it("contains a close failure when the underlying transport is already broken", async () => {
    const { input, heartbeat } = fixture();
    input.revoked.mockResolvedValue(true);
    input.close.mockImplementation(() => {
      throw new Error("transport already gone");
    });
    await expect(heartbeat.tick()).resolves.toBeUndefined();
    await heartbeat.tick();
    expect(input.close).toHaveBeenCalledOnce();
  });
});
