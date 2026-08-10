/**
 * Serializable transaction boundary for security work (T020, feature 002).
 *
 * Separate from `runMutation` in `../../mutations/run-mutation.ts` on purpose.
 * That runner retries a serialization failure and re-runs the work, which is
 * right for content mutations: replaying an idempotent content command is
 * harmless. It is *wrong* for several security operations, where a
 * serialization failure is the answer rather than an obstacle:
 *
 *   - the bootstrap claim, where exactly one concurrent attempt must win and
 *     the losers must be told they lost;
 *   - recovery-epoch supersession and rotation start, where a silent retry
 *     would let a second operation begin after the first already committed.
 *
 * So `runSecurityTransaction` defaults to **no retry** and surfaces the
 * conflict. A caller that genuinely wants a retry asks for one explicitly, by
 * passing `maxAttempts`, and thereby states that its work is replay-safe.
 */

import type { Database, Transaction } from "../../client.ts";
import {
  isSerializationFailure,
  SecurityRepositoryError,
  type SecurityScope,
} from "./repository-types.ts";

export interface SecurityTransactionOptions {
  /**
   * Attempts, including the first. Defaults to 1: no retry.
   * Only raise it when replaying the work is provably harmless.
   */
  readonly maxAttempts?: number;
  /**
   * `serializable` by default. `read committed` is for read-only status
   * queries where a snapshot is enough and a conflict would be noise.
   */
  readonly isolation?: "serializable" | "read committed";
}

/**
 * Raised when a security transaction lost a serialization race.
 *
 * Deliberately distinct from a generic failure: the caller usually wants to
 * report "someone else got there first" rather than "something went wrong",
 * and for the bootstrap claim that distinction is the whole point.
 */
export class SecurityConflictError extends SecurityRepositoryError {
  constructor(cause: unknown) {
    super("conflict", "a concurrent security operation won this transaction", { cause });
    this.name = "SecurityConflictError";
  }
}

export async function runSecurityTransaction<T>(
  db: Database,
  work: (tx: Transaction) => Promise<T>,
  options: SecurityTransactionOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  const isolationLevel = options.isolation ?? "serializable";

  let lastConflict: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.transaction(work, { isolationLevel });
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      lastConflict = error;
      if (attempt === maxAttempts) {
        break;
      }
      // Jittered backoff so two racing attempts do not resynchronize.
      const backoffMs = Math.min(200, 10 * 2 ** attempt) + Math.random() * 25;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new SecurityConflictError(lastConflict);
}

/**
 * Runs read-only status work. Uses `read committed` because a status read that
 * fails on a serialization conflict would make the installation look broken
 * while it is merely busy.
 */
export async function runSecurityRead<T>(
  db: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return runSecurityTransaction(db, work, { isolation: "read committed" });
}

/**
 * Asserts that a row belongs to the scope the caller claims to operate under.
 *
 * Every security repository calls this before returning a row. A row that
 * belongs elsewhere is a scoping bug, and returning it would silently cross a
 * boundary the product says cannot be crossed.
 */
export function assertRowInScope(
  row: { installationId: string; workspaceId?: string | null },
  scope: SecurityScope,
  what: string,
): void {
  if (row.installationId !== scope.installationId) {
    throw new SecurityRepositoryError(
      "forbidden",
      `${what} belongs to a different installation than the requested scope`,
    );
  }
  if (
    scope.workspaceId !== undefined &&
    row.workspaceId !== null &&
    row.workspaceId !== undefined &&
    row.workspaceId !== scope.workspaceId
  ) {
    throw new SecurityRepositoryError(
      "forbidden",
      `${what} belongs to a different workspace than the requested scope`,
    );
  }
}
