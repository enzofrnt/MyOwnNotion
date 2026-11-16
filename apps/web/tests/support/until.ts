/**
 * Waits for the state a test's next step needs (feature 060).
 *
 * Never a delay: `read` throws (or fails an `expect`) until the state exists,
 * and the timeout is only the bound that turns a missing state into a failure
 * naming it. Each attempt first lets React commit what the previous step
 * scheduled — these suites run in an act environment, where work scheduled
 * outside `act` is not flushed and a plain poll can wait on a state React has
 * already computed but not committed.
 */
import { act } from "react";
import { vi } from "vitest";

export async function until<T>(read: () => T | Promise<T>, timeout = 5_000): Promise<T> {
  return await vi.waitFor(
    async () => {
      await act(async () => {});
      return await read();
    },
    { timeout, interval: 10 },
  );
}

/** Narrows a lookup to a present element, or throws a message naming it. */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is not rendered yet`);
  return value;
}

/**
 * Runs every pending promise continuation, then returns.
 *
 * A zero-delay task runs only once the microtask queue is empty, so this is a
 * deterministic barrier — not a guess at elapsed time — for code under test
 * whose asynchronous work is promises alone (mocked services that resolve,
 * React state updates). Use it only there, and say so where it is used: code
 * that schedules timers, animation frames or IndexedDB requests needs `until`
 * on the state it produces, or an owned clock (`vi.useFakeTimers`).
 */
export async function drainPromiseWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
