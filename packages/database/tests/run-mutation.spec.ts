/**
 * Transactional mutation runner retry semantics (T074, US4, FR-017/FR-018).
 *
 * Serialization failures and deadlocks are retried with bounded attempts so a
 * concurrent placement change does not surface as a spurious failure; once the
 * bound is reached the outcome is an explicit, diagnosable error rather than a
 * partially applied mutation. Every other error propagates untouched.
 *
 * This suite drives the runner against a scripted transaction double, so it
 * needs no PostgreSQL instance.
 */

import type { Database, Transaction } from "@myownnotion/database";
import { runMutation, SerializationRetryExceededError } from "@myownnotion/database";
import { describe, expect, it } from "vitest";

interface Attempt {
  readonly isolationLevel: string | undefined;
}

/**
 * Minimal Database double: records each attempt's isolation level and throws
 * the scripted errors before finally succeeding.
 */
function fakeDb(script: ReadonlyArray<unknown>): {
  db: Database;
  attempts: Attempt[];
} {
  const attempts: Attempt[] = [];
  let index = 0;
  const db = {
    async transaction<T>(
      work: (tx: Transaction) => Promise<T>,
      config?: { isolationLevel?: string },
    ): Promise<T> {
      attempts.push({ isolationLevel: config?.isolationLevel });
      const scripted = script[index];
      index += 1;
      if (scripted !== undefined) {
        throw scripted;
      }
      return work({} as Transaction);
    },
  } as unknown as Database;
  return { db, attempts };
}

const serializationFailure = Object.assign(new Error("could not serialize access"), {
  code: "40001",
});
const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });

describe("runMutation", () => {
  it("runs the work once under SERIALIZABLE by default", async () => {
    const { db, attempts } = fakeDb([]);
    const result = await runMutation(db, async () => "done");

    expect(result).toBe("done");
    expect(attempts).toEqual([{ isolationLevel: "serializable" }]);
  });

  it("honours an explicit read-committed isolation level", async () => {
    const { db, attempts } = fakeDb([]);
    await runMutation(db, async () => null, { isolation: "read committed" });

    expect(attempts[0]?.isolationLevel).toBe("read committed");
  });

  it("retries a serialization failure and returns the eventual success", async () => {
    const { db, attempts } = fakeDb([serializationFailure, serializationFailure]);
    const result = await runMutation(db, async () => "eventually");

    expect(result).toBe("eventually");
    expect(attempts.length).toBe(3);
  });

  it("retries a deadlock the same way", async () => {
    const { db, attempts } = fakeDb([deadlock]);
    expect(await runMutation(db, async () => "ok")).toBe("ok");
    expect(attempts.length).toBe(2);
  });

  it("finds a retryable SQLSTATE wrapped by the query layer", async () => {
    const wrapped = new Error("query execution failed", { cause: serializationFailure });
    const { db, attempts } = fakeDb([wrapped, wrapped]);

    expect(await runMutation(db, async () => "recovered")).toBe("recovered");
    expect(attempts.length).toBe(3);
  });

  it("surfaces an explicit error once the attempt bound is reached", async () => {
    const { db, attempts } = fakeDb([
      serializationFailure,
      serializationFailure,
      serializationFailure,
    ]);

    await expect(runMutation(db, async () => "never", { maxAttempts: 3 })).rejects.toThrow(
      SerializationRetryExceededError,
    );
    expect(attempts.length).toBe(3);
  });

  it("records the attempt count and the underlying cause on the bound error", async () => {
    const { db } = fakeDb([serializationFailure, serializationFailure]);
    try {
      await runMutation(db, async () => "never", { maxAttempts: 2 });
      expect.unreachable("expected the retry bound to be exceeded");
    } catch (error) {
      expect(error).toBeInstanceOf(SerializationRetryExceededError);
      const failure = error as SerializationRetryExceededError;
      expect(failure.message).toContain("2 attempts");
      expect(failure.cause).toBe(serializationFailure);
    }
  });

  it("does not retry a non-retryable error and propagates it unchanged", async () => {
    const violation = Object.assign(new Error("unique violation"), { code: "23505" });
    const { db, attempts } = fakeDb([violation]);

    await expect(runMutation(db, async () => "never")).rejects.toBe(violation);
    // A deterministic failure must not be retried.
    expect(attempts.length).toBe(1);
  });

  it("propagates an error carrying no SQLSTATE code", async () => {
    const plain = new Error("boom");
    const { db, attempts } = fakeDb([plain]);

    await expect(runMutation(db, async () => "never")).rejects.toBe(plain);
    expect(attempts.length).toBe(1);
  });

  it("propagates a thrown non-object value", async () => {
    const { db } = fakeDb(["a string failure"]);
    await expect(runMutation(db, async () => "never")).rejects.toBe("a string failure");
  });

  it("stops safely when an error cause chain contains a cycle", async () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    const { db, attempts } = fakeDb([cyclic]);

    await expect(runMutation(db, async () => "never")).rejects.toBe(cyclic);
    expect(attempts.length).toBe(1);
  });

  it("performs a single attempt when maxAttempts is 1", async () => {
    const { db, attempts } = fakeDb([serializationFailure]);

    await expect(runMutation(db, async () => "never", { maxAttempts: 1 })).rejects.toThrow(
      SerializationRetryExceededError,
    );
    expect(attempts.length).toBe(1);
  });
});
