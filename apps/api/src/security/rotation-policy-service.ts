/**
 * Reading both rotation policies (T085, US5, FR-025 – FR-027).
 *
 * The domain decides what a policy's dates mean; this reads the rows and asks
 * it, for both kinds in the same health view. Both, always — an installation whose wrapping
 * key is fine and whose data key is overdue is not a healthy installation, and
 * a caller given one answer would believe it was.
 *
 * **Reads are never blocked by this.** A rotation being due, overdue, or in
 * progress says nothing about whether existing records can be opened: they can,
 * under the generation that sealed them. Only protected *writes* are blocked,
 * and only once the write-block instant has passed — a deadline the operator
 * has had a year and then a grace period to notice.
 */

import {
  type Database,
  findRotationPolicy,
  findRunningRotation,
  type RotationKind,
  type Transaction,
} from "@myownnotion/database";
import {
  evaluateRotationPolicy,
  type KeyRotationPolicy,
  type RotationPolicyEvaluation,
} from "@myownnotion/domain";

export interface RotationPolicyServiceDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly now: () => Date;
}

export interface RotationHealth {
  readonly wrappingKey: RotationPolicyEvaluation | null;
  readonly dataKey: RotationPolicyEvaluation | null;
  /**
   * Whether a protected write may proceed right now.
   *
   * Either policy can block: the two protect different things, and a write
   * allowed because the *other* key is healthy would be exactly the write the
   * block exists to prevent.
   */
  readonly writesAllowed: boolean;
}

export class RotationPolicyService {
  readonly #deps: RotationPolicyServiceDeps;

  constructor(deps: RotationPolicyServiceDeps) {
    this.#deps = deps;
  }

  async #evaluate(
    executor: Database | Transaction,
    kind: RotationKind,
  ): Promise<RotationPolicyEvaluation | null> {
    const record = await findRotationPolicy(executor, {
      installationId: this.#deps.installationId,
      kind,
    });
    if (record === null) {
      // No policy row yet. Reported as absent rather than as healthy: an
      // installation that never configured rotation has not satisfied the
      // requirement, and a green answer here would hide that.
      return null;
    }
    const running = await findRunningRotation(executor, {
      installationId: this.#deps.installationId,
      kind,
    });
    const policy: KeyRotationPolicy = {
      kind,
      mode: record.mode,
      currentGeneration: record.currentGeneration,
      dueAt: record.dueAt,
      writeBlockAt: record.writeBlockAt,
      lastCompletedAt: record.lastCompletedAt,
      // The stored value, not a hard-coded null. A failed rotation writes this
      // column, and reading it is what turns that row into the `failed` state
      // an owner is shown — without it the failure is recorded and invisible.
      lastFailureAt: record.lastFailureAt,
      operationId: running?.id ?? null,
    };
    return evaluateRotationPolicy(policy, this.#deps.now());
  }

  /** Both policies, and whether writes may proceed. */
  async health(executor: Database | Transaction = this.#deps.db): Promise<RotationHealth> {
    // A transaction is backed by one pg client. Starting both reads together
    // queues overlapping client.query calls, which pg 9 rejects. Keep the
    // policy pair in one transaction, but read it in connection order.
    const wrappingKey = await this.#evaluate(executor, "wrapping-key");
    const dataKey = await this.#evaluate(executor, "data-key");
    return {
      wrappingKey: wrappingKey ?? null,
      dataKey: dataKey ?? null,
      // An absent policy does not block: the installation has not configured
      // rotation, which is a warning rather than a reason to refuse writes.
      writesAllowed: (wrappingKey?.writesAllowed ?? true) && (dataKey?.writesAllowed ?? true),
    };
  }

  /**
   * Refuses a protected write when either policy has reached its block.
   *
   * Called inside the write's own transaction so the decision cannot be taken
   * before a block that commits moments later. The refusal is a thrown error
   * rather than a boolean because the caller has no safe way to continue.
   */
  async assertWritesAllowed(executor: Database | Transaction): Promise<void> {
    const health = await this.health(executor);
    if (!health.writesAllowed) {
      throw new RotationWriteBlockedError(
        health.wrappingKey?.writesAllowed === false ? "wrapping-key" : "data-key",
      );
    }
  }
}

export class RotationWriteBlockedError extends Error {
  readonly kind: RotationKind;

  constructor(kind: RotationKind) {
    super(`protected writes are blocked until the ${kind} rotation completes`);
    this.name = "RotationWriteBlockedError";
    this.kind = kind;
  }
}
