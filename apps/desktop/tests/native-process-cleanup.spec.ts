import { ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeProcess, crashProcess, removeProfile } from "../../../tests/e2e/desktop-process.ts";

afterEach(() => vi.useRealTimers());
function processFixture() {
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 12345 });
  const exit = () => {
    Object.defineProperty(child, "exitCode", { value: 0, configurable: true });
    child.emit("exit", 0, null);
  };
  return { child, exit };
}

describe("native fixture process termination", () => {
  it("accepts a racing taskkill failure only after the owned process exits", async () => {
    vi.useFakeTimers();
    const { child, exit } = processFixture();
    const missingProcess = new Error("owned process already gone");
    const result = crashProcess(child, async () => {
      setTimeout(exit, 10);
      throw missingProcess;
    }).then(
      () => "exited",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBe("exited");
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("retains a termination error when the owned process stays alive", async () => {
    vi.useFakeTimers();
    const { child } = processFixture();
    const denied = new Error("termination denied");
    const result = crashProcess(child, async () => {
      throw denied;
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe(denied);
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("does not mistake successful kill invocation for actual exit", async () => {
    vi.useFakeTimers();
    const { child } = processFixture();
    const result = crashProcess(child, async () => {}).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual(
      new Error("Native test process did not exit after forced termination"),
    );
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("handles immediate exit during termination and an already exited process", async () => {
    const { child, exit } = processFixture();
    const force = vi.fn(async () => exit());
    await crashProcess(child, force);
    await crashProcess(child, force);
    expect(force).toHaveBeenCalledTimes(1);
    expect(child.listenerCount("exit")).toBe(0);
  });
});

describe("native fixture graceful close", () => {
  it("waits for exit notification after the browser channel closes", async () => {
    vi.useFakeTimers();
    const { child, exit } = processFixture();
    const force = vi.fn(async () => exit());
    const result = closeProcess(
      child,
      async () => {
        setTimeout(exit, 10);
      },
      force,
    );
    await vi.advanceTimersByTimeAsync(10);
    await result;
    expect(force).not.toHaveBeenCalled();
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("forces a hung graceful close at the existing deadline", async () => {
    vi.useFakeTimers();
    const { child, exit } = processFixture();
    const force = vi.fn(async () => exit());
    const result = closeProcess(child, () => new Promise(() => {}), force);
    await vi.advanceTimersByTimeAsync(4999);
    expect(force).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(force).toHaveBeenCalledTimes(1);
    expect(child.listenerCount("exit")).toBe(0);
  });
});

describe("native temporary profile removal", () => {
  it.each(["EBUSY", "EPERM", "ENOTEMPTY"])("retries transient %s under Bun", async (code) => {
    vi.useFakeTimers();
    const remove = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("locked"), { code }))
      .mockResolvedValue(undefined);
    const result = removeProfile("temporary-profile", remove).then(
      () => "removed",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe("removed");
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("retains a permanent lock after the existing ten linear retries", async () => {
    vi.useFakeTimers();
    const locked = Object.assign(new Error("locked"), { code: "EBUSY" });
    const remove = vi.fn().mockRejectedValue(locked);
    const result = removeProfile("temporary-profile", remove).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5500);
    expect(await result).toBe(locked);
    expect(remove).toHaveBeenCalledTimes(11);
  });

  it("does not retry unrelated filesystem failures", async () => {
    const failure = Object.assign(new Error("I/O failure"), { code: "EIO" });
    const remove = vi.fn().mockRejectedValue(failure);
    await expect(removeProfile("temporary-profile", remove)).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

it("observes the real Bun child lifecycle before removing a temporary profile", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await closeProcess(child, async () => {
      child.kill();
    });
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
