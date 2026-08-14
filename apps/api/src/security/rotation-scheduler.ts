/**
 * Startup and daily rotation evaluation (T085, US5, FR-025 – FR-027, SC-009).
 *
 * FR-026 asks for an at-least-daily check. The obvious implementation — an
 * interval timer — quietly fails to deliver it, and this module exists mostly
 * to avoid that failure:
 *
 *   - a server restarted every few hours by a deployment never reaches its
 *     24-hour timer, so the check that was promised daily never runs at all;
 *   - a timer measures elapsed process time, not calendar time, so a suspended
 *     or throttled host skips days without noticing.
 *
 * So the evaluation runs **at startup**, unconditionally, and the interval is
 * only a fallback for a process that stays up. A restart is not a reason to
 * skip a check; it is the most likely moment for one to be overdue.
 *
 * The evaluation itself changes nothing. It reads, warns, and returns — a
 * scheduler that started rotations on its own would perform an expensive,
 * irreversible operation at an hour nobody chose.
 */

import type { FastifyBaseLogger } from "fastify";
import type { RotationHealth, RotationPolicyService } from "./rotation-policy-service.ts";

export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RotationSchedulerDeps {
  readonly policies: RotationPolicyService;
  readonly logger: FastifyBaseLogger;
  /**
   * Records a reached write block, at most once per evaluation.
   *
   * Deliberately raised here rather than from the write path. Auditing every
   * refused write would emit one row per request — thousands of identical
   * events burying the one an operator needs, and a self-inflicted write
   * amplification while the installation is already unhappy.
   *
   * The scheduler evaluates at startup and daily, so this fires about as often
   * as an operator would want to be told.
   */
  readonly onWriteBlocked?: (blocked: {
    kind: "wrapping-key" | "data-key";
    dueAt: Date;
    writeBlockAt: Date;
  }) => Promise<void>;
  /** Injected so tests do not wait a day, and so the interval is visible. */
  readonly intervalMs?: number;
}

/** States worth telling an operator about, in ascending urgency. */
const WARNING_STATES = new Set(["due", "overdue-within-grace", "emergency", "write-block"]);

export class RotationScheduler {
  readonly #deps: RotationSchedulerDeps;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: RotationSchedulerDeps) {
    this.#deps = deps;
  }

  /**
   * Evaluates both policies and logs anything an operator should act on.
   *
   * Returns the health so a caller can assert on it; the logging is the point
   * in production, and the return value is what makes it testable without
   * reading log output.
   */
  async evaluate(): Promise<RotationHealth> {
    const health = await this.#deps.policies.health();
    for (const [kind, evaluation] of [
      ["wrapping-key", health.wrappingKey],
      ["data-key", health.dataKey],
    ] as const) {
      if (evaluation === null) {
        // Absent, not healthy. An installation that never configured rotation
        // has not satisfied FR-025, and silence would hide it.
        this.#deps.logger.warn({ kind }, "no rotation policy is configured for this key");
        continue;
      }
      if (!WARNING_STATES.has(evaluation.state)) {
        continue;
      }
      // `fatal` for a reached write block: the installation is refusing
      // protected writes, which an operator needs to see immediately rather
      // than find in a log they read weekly.
      const level = evaluation.state === "write-block" ? "fatal" : "warn";
      this.#deps.logger[level](
        {
          kind,
          state: evaluation.state,
          nextAction: evaluation.nextAction,
          dueAt: evaluation.dueAt.toISOString(),
          writeBlockAt: evaluation.writeBlockAt.toISOString(),
          daysUntilWriteBlock: evaluation.daysUntilWriteBlock,
        },
        evaluation.state === "write-block"
          ? "protected writes are blocked until this key is rotated"
          : "a key rotation is due",
      );
      if (evaluation.state === "write-block") {
        await this.#deps.onWriteBlocked?.({
          kind,
          dueAt: evaluation.dueAt,
          writeBlockAt: evaluation.writeBlockAt,
        });
      }
    }
    return health;
  }

  /**
   * Evaluates now, then at least daily.
   *
   * The startup evaluation is not optional and not deferred: a process that
   * restarts often would otherwise never reach the interval, and the check
   * promised as daily would never happen.
   */
  async start(): Promise<void> {
    await this.evaluate();
    const interval = this.#deps.intervalMs ?? DAILY_INTERVAL_MS;
    this.#timer = setInterval(() => {
      void this.evaluate().catch((error: unknown) => {
        // A failed evaluation must not stop the schedule: the next one may
        // succeed, and losing the schedule turns a transient database error
        // into permanent silence about an approaching write block.
        this.#deps.logger.error({ err: error }, "rotation evaluation failed");
      });
    }, interval);
    // Never hold the process open for this. A scheduled check is not a reason
    // for a container to refuse to exit.
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
