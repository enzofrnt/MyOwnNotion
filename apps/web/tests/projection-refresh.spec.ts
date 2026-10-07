import { describe, expect, it, vi } from "vitest";
import { createProjectionRefresh } from "../src/features/databases/projection-refresh.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function advance() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("projection refresh drain", () => {
  it("starts without a timer and joins a burst before the first read", async () => {
    const load = vi.fn(async () => "latest");
    const publish = vi.fn();
    const queue = createProjectionRefresh({ load, publish });
    queue.activate();
    const first = queue.refresh();
    expect(queue.refresh()).toBe(first);
    expect(queue.refresh()).toBe(first);
    await first;
    expect(load).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledExactlyOnceWith("latest");
  });

  it("reruns once after a burst during a read and awaits the final publication", async () => {
    const obsolete = deferred<string>();
    const latest = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(latest.promise);
    const publish = vi.fn();
    const queue = createProjectionRefresh({ load, publish });
    queue.activate();
    const first = queue.refresh();
    await advance();
    const saved = queue.refresh();
    expect(saved).toBe(first);
    expect(queue.refresh()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    let settled = false;
    void saved.then(() => {
      settled = true;
    });
    obsolete.resolve("obsolete");
    await advance();
    expect(publish).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);
    latest.resolve("latest");
    await saved;
    expect(settled).toBe(true);
    expect(publish).toHaveBeenCalledExactlyOnceWith("latest");
  });

  it("drains an additional notification during the second read", async () => {
    const reads = [deferred<number>(), deferred<number>(), deferred<number>()];
    const load = vi.fn(() => reads[load.mock.calls.length - 1]?.promise ?? Promise.resolve(0));
    const publish = vi.fn();
    const queue = createProjectionRefresh({ load, publish });
    queue.activate();
    const completion = queue.refresh();
    await advance();
    void queue.refresh();
    reads[0]?.resolve(1);
    await advance();
    void queue.refresh();
    reads[1]?.resolve(2);
    await advance();
    expect(load).toHaveBeenCalledTimes(3);
    expect(publish).not.toHaveBeenCalled();
    reads[2]?.resolve(3);
    await completion;
    expect(publish).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("ignores an obsolete failure when another read is requested", async () => {
    const obsolete = deferred<string>();
    const error = new Error("obsolete read");
    const load = vi.fn().mockReturnValueOnce(obsolete.promise).mockResolvedValueOnce("latest");
    const publish = vi.fn();
    const onError = vi.fn();
    const queue = createProjectionRefresh({ load, publish, onError });
    queue.activate();
    const completion = queue.refresh();
    await advance();
    void queue.refresh();
    obsolete.reject(error);
    await completion;
    expect(onError).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith("latest");
  });

  it("reports a final failure and permits a later successful refresh", async () => {
    const error = new Error("unreadable projection");
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("recovered");
    const publish = vi.fn();
    const onError = vi.fn();
    const queue = createProjectionRefresh({ load, publish, onError });
    queue.activate();
    await expect(queue.refresh()).rejects.toBe(error);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(publish).not.toHaveBeenCalled();
    await queue.refresh();
    expect(publish).toHaveBeenCalledExactlyOnceWith("recovered");
  });

  it("cancels the old scope before reactivation, even if its read fails late", async () => {
    const obsolete = deferred<string>();
    const latest = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(latest.promise);
    const publish = vi.fn();
    const onError = vi.fn();
    const queue = createProjectionRefresh({ load, publish, onError });
    queue.activate();
    const oldCompletion = queue.refresh();
    await advance();
    void queue.refresh();
    queue.deactivate();
    queue.activate();
    const newCompletion = queue.refresh();
    await advance();
    latest.resolve("new scope");
    await newCompletion;
    obsolete.reject(new Error("old scope"));
    await oldCompletion;
    expect(load).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith("new scope");
  });

  it("does no reads after deactivation and releases a pending waiter", async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const publish = vi.fn();
    const queue = createProjectionRefresh({ load, publish });
    await queue.refresh();
    expect(load).not.toHaveBeenCalled();
    queue.activate();
    const completion = queue.refresh();
    await advance();
    void queue.refresh();
    queue.deactivate();
    pending.resolve("unmounted");
    await completion;
    await queue.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
});
