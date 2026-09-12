import { afterEach, expect, it, vi } from "vitest";
import { observeNativeCommand } from "../../../tests/e2e/desktop-process-evidence.ts";

afterEach(() => vi.useRealTimers());

it("returns a successful native result without requesting failure diagnostics", async () => {
  const report = vi.fn();
  expect(await observeNativeCommand(async () => 42, report)).toBe(42);
  expect(report).not.toHaveBeenCalled();
});

it("records failure before returning the same exception and never retries the command", async () => {
  const error = new Error("native command refused");
  const command = vi.fn(async () => {
    throw error;
  });
  const order: string[] = [];
  await observeNativeCommand(command, async () => {
    order.push("report");
  }).catch((caught) => {
    expect(caught).toBe(error);
    order.push("refused");
  });
  expect(order).toEqual(["report", "refused"]);
  expect(command).toHaveBeenCalledOnce();
});

it("preserves the original error when diagnostics throw", async () => {
  const original = new Error("native command refused");
  await expect(
    observeNativeCommand(
      async () => {
        throw original;
      },
      async () => {
        throw new Error("diagnostics unavailable");
      },
    ),
  ).rejects.toBe(original);
});

it("bounds unavailable diagnostics instead of consuming the test timeout", async () => {
  vi.useFakeTimers();
  const original = new Error("native command refused");
  let received: unknown;
  const result = observeNativeCommand(
    async () => {
      throw original;
    },
    () => new Promise(() => {}),
  ).catch((error) => {
    received = error;
  });
  await vi.advanceTimersByTimeAsync(999);
  expect(received).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(received).toBe(original);
  await result;
});
