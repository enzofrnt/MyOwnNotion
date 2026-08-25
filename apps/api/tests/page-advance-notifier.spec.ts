import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { PageAdvanceNotifier } from "../src/realtime/page-advance-notifier.ts";

describe("PageAdvanceNotifier", () => {
  it("delivers one committed page position to every current listener", () => {
    const notifier = new PageAdvanceNotifier();
    const first = vi.fn();
    const second = vi.fn();
    notifier.subscribe(first);
    notifier.subscribe(second);
    const event = { pageId: generateUuidV7(), latestPageSequence: 42 };

    notifier.publish(event);

    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
    expect(notifier.size).toBe(2);
  });

  it("releases listeners explicitly and on clear", () => {
    const notifier = new PageAdvanceNotifier();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = notifier.subscribe(first);
    notifier.subscribe(second);

    unsubscribe();
    notifier.publish({ pageId: generateUuidV7(), latestPageSequence: 1 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    notifier.clear();
    notifier.publish({ pageId: generateUuidV7(), latestPageSequence: 2 });
    expect(second).toHaveBeenCalledOnce();
    expect(notifier.size).toBe(0);
  });

  it("removes a failed listener without delaying healthy sessions", () => {
    const notifier = new PageAdvanceNotifier();
    const broken = vi.fn(() => {
      throw new Error("closed socket");
    });
    const healthy = vi.fn();
    notifier.subscribe(broken);
    notifier.subscribe(healthy);
    const event = { pageId: generateUuidV7(), latestPageSequence: 7 };

    expect(() => notifier.publish(event)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(event);
    expect(notifier.size).toBe(1);

    notifier.publish({ pageId: event.pageId, latestPageSequence: 8 });
    expect(broken).toHaveBeenCalledOnce();
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid internal sequence values before publishing", () => {
    const notifier = new PageAdvanceNotifier();
    const listener = vi.fn();
    notifier.subscribe(listener);

    expect(() => notifier.publish({ pageId: generateUuidV7(), latestPageSequence: -1 })).toThrow(
      "page sequence",
    );
    expect(listener).not.toHaveBeenCalled();
  });
});
