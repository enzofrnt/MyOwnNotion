import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveCoordinator, type SaveCoordinatorState } from "./save-coordinator.ts";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SaveCoordinator", () => {
  it("debounces rapid edits and saves only their latest value", async () => {
    vi.useFakeTimers();
    const save = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    const coordinator = new SaveCoordinator({ delayMs: 250, save });

    coordinator.schedule("one");
    coordinator.schedule("two");
    coordinator.schedule("latest");
    await vi.advanceTimersByTimeAsync(249);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("latest");
  });

  it("keeps one save in flight and coalesces queued edits to the latest value", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const saved: string[] = [];
    const save = vi.fn(async (value: string) => {
      saved.push(value);
      if (value === "first") {
        await first.promise;
      }
    });
    const coordinator = new SaveCoordinator({ delayMs: 100, save });

    coordinator.schedule("first");
    await vi.advanceTimersByTimeAsync(100);
    coordinator.schedule("obsolete");
    coordinator.schedule("latest");
    await vi.advanceTimersByTimeAsync(100);
    expect(saved).toEqual(["first"]);

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(["first", "latest"]);
  });

  it("reports a failure and accepts a newer edit for a later retry", async () => {
    vi.useFakeTimers();
    const states: SaveCoordinatorState[] = [];
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("quota"))
      .mockResolvedValueOnce(undefined);
    const coordinator = new SaveCoordinator({
      delayMs: 50,
      save,
      onStateChange: (state) => states.push(state),
    });

    coordinator.schedule("failed");
    await vi.advanceTimersByTimeAsync(50);
    expect(states.at(-1)).toMatchObject({ status: "error" });

    coordinator.schedule("recovery");
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenLastCalledWith("recovery");
    expect(states.at(-1)).toEqual({ status: "saved-local" });
  });

  it("flushes immediately and disposal durably drains the last queued value", async () => {
    vi.useFakeTimers();
    const save = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    const coordinator = new SaveCoordinator({ delayMs: 500, save });

    coordinator.schedule("flush me");
    await coordinator.flush();
    expect(save).toHaveBeenCalledWith("flush me");

    coordinator.schedule("save on disposal");
    await coordinator.dispose();
    await vi.advanceTimersByTimeAsync(500);
    coordinator.schedule("ignored");
    expect(save).toHaveBeenNthCalledWith(2, "save on disposal");
    expect(save).toHaveBeenCalledTimes(2);
  });
});
