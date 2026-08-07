/**
 * Shared transactional mutation runner (T074, US4).
 *
 * Every canonical mutation executes inside one PostgreSQL transaction.
 * Mutations touching ancestry-sensitive placements run under SERIALIZABLE
 * isolation with bounded retry: serialization failures (40001) and deadlocks
 * (40P01) are retried with jittered backoff, then surfaced as safe conflicts.
 */
import type { Database, Transaction } from "../client.ts";

export interface RunMutationOptions {
  /** SERIALIZABLE for ancestry/placement-sensitive commands. */
  readonly isolation?: "serializable" | "read committed";
  readonly maxAttempts?: number;
}

const RETRYABLE_SQLSTATE = new Set(["40001", "40P01"]);

function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && RETRYABLE_SQLSTATE.has(code);
}

export class SerializationRetryExceededError extends Error {
  override readonly cause: unknown;
  constructor(attempts: number, cause: unknown) {
    super(`mutation could not be serialized after ${attempts} attempts`);
    this.name = "SerializationRetryExceededError";
    this.cause = cause;
  }
}

export async function runMutation<T>(
  db: Database,
  work: (tx: Transaction) => Promise<T>,
  options: RunMutationOptions = {},
): Promise<T> {
  const isolation = options.isolation ?? "serializable";
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.transaction(work, {
        isolationLevel: isolation === "serializable" ? "serializable" : "read committed",
      });
    } catch (error) {
      if (!isRetryable(error) || attempt === maxAttempts) {
        if (isRetryable(error)) {
          throw new SerializationRetryExceededError(attempt, error);
        }
        throw error;
      }
      lastError = error;
      const backoffMs = Math.min(200, 10 * 2 ** attempt) + Math.random() * 25;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new SerializationRetryExceededError(maxAttempts, lastError);
}
