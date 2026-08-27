import {
  MAX_REALTIME_PAGE_SYNC_IN_FLIGHT,
  MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
} from "@myownnotion/contracts";
import { describe, expect, it } from "vitest";
import { PendingAuthenticationFrames } from "../src/realtime/pending-authentication-frames.ts";

describe("pending WebSocket authentication frames", () => {
  it("preserves accepted frames in order and clears them after replay", () => {
    const pending = new PendingAuthenticationFrames();
    const first = Buffer.from("hello");
    const second = [Buffer.from("sync"), Buffer.from("-request")];

    expect(pending.enqueue(first, false)).toBe(true);
    expect(pending.enqueue(second, true)).toBe(true);
    expect(pending.drain()).toEqual([
      { frame: first, isBinary: false },
      { frame: second, isBinary: true },
    ]);
    expect(pending.drain()).toEqual([]);
  });

  it("refuses a ninth frame without retaining the overflow", () => {
    const pending = new PendingAuthenticationFrames();
    for (let index = 0; index < MAX_REALTIME_PAGE_SYNC_IN_FLIGHT; index += 1) {
      expect(pending.enqueue(Buffer.from(String(index)), false)).toBe(true);
    }

    expect(pending.enqueue(Buffer.from("overflow"), false)).toBe(false);
    expect(pending.drain()).toHaveLength(MAX_REALTIME_PAGE_SYNC_IN_FLIGHT);
  });

  it("accepts the exact byte limit and refuses one byte more", () => {
    const exact = new PendingAuthenticationFrames();
    expect(exact.enqueue(Buffer.alloc(MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES), true)).toBe(true);

    const overflow = new PendingAuthenticationFrames();
    expect(overflow.enqueue(Buffer.alloc(MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES + 1), true)).toBe(
      false,
    );
    expect(overflow.drain()).toEqual([]);
  });
});
