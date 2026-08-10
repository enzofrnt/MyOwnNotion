/**
 * Key-rotation policy evaluation (T018, feature 002).
 *
 * Pure functions over a controlled clock: given a policy record and an
 * instant, what state is the installation in, may it still write, and what
 * should it do next. No I/O, no ambient `Date.now()` — every caller passes the
 * instant, so the boundaries are testable to the second.
 *
 * The design rests on one judgement worth stating plainly: **a late rotation
 * must never lock the owner out of their own data.** Reads of valid existing
 * ciphertext stay available in every state, including `write-block`. Only new
 * protected writes are refused, and only once `writeBlockAt` has passed. The
 * alternative — blocking reads — would turn an operational lapse into data
 * loss for a single-owner self-hosted product with no support desk.
 *
 * Wrapping-key and data-key policies are evaluated by the same rules but never
 * share state: they have separate due dates, separate generations, and at most
 * one in-flight operation each.
 */
import {
  type KeyKind,
  type KeyPolicyState,
  type RotationMode,
  SCHEDULED_ROTATION_GRACE_DAYS,
} from "./types.ts";

const MILLISECONDS_PER_DAY = 86_400_000;

/** Durable policy record for one key kind. */
export interface KeyRotationPolicy {
  readonly kind: KeyKind;
  readonly mode: RotationMode;
  /** Generation or version currently in force. */
  readonly currentGeneration: number;
  /** When rotation becomes due. */
  readonly dueAt: Date;
  readonly lastCompletedAt: Date | null;
  /**
   * When new protected writes stop. Derived from `dueAt` and `mode` by
   * `computeWriteBlockAt`; stored so a mode change cannot silently move a
   * deadline the owner was already warned about.
   */
  readonly writeBlockAt: Date;
  /** Set while an operation is running; at most one per policy. */
  readonly operationId: string | null;
  /** Set when the last operation failed and has not been retried. */
  readonly lastFailureAt: Date | null;
}

/**
 * A scheduled rotation gets `SCHEDULED_ROTATION_GRACE_DAYS` of grace after the
 * due date. An emergency rotation gets none: the whole point is that the
 * current material is suspect, so continuing to write under it is the risk.
 */
export function computeWriteBlockAt(dueAt: Date, mode: RotationMode): Date {
  return mode === "emergency"
    ? new Date(dueAt.getTime())
    : new Date(dueAt.getTime() + SCHEDULED_ROTATION_GRACE_DAYS * MILLISECONDS_PER_DAY);
}

export type RotationNextAction =
  | "none"
  | "schedule-rotation"
  | "start-rotation"
  | "start-rotation-urgently"
  | "resume-rotation"
  | "retry-rotation";

export interface RotationPolicyEvaluation {
  readonly kind: KeyKind;
  readonly state: KeyPolicyState;
  readonly currentGeneration: number;
  readonly dueAt: Date;
  readonly lastCompletedAt: Date | null;
  readonly writeBlockAt: Date;
  readonly nextAction: RotationNextAction;
  /**
   * Whether new protected writes are permitted. Reads are always permitted;
   * there is deliberately no `readsAllowed` field to negotiate away.
   */
  readonly writesAllowed: boolean;
  /** Whole days until `writeBlockAt`; negative once it has passed. */
  readonly daysUntilWriteBlock: number;
}

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY);
}

/**
 * Evaluates a policy at `now`.
 *
 * Precedence matters. An in-flight or failed operation is reported before any
 * date-derived state, because "a rotation is already running" and "the last
 * rotation failed" are what the operator has to act on — telling them the key
 * is `overdue-within-grace` while a rotation is mid-flight would be true and
 * useless.
 */
export function evaluateRotationPolicy(
  policy: KeyRotationPolicy,
  now: Date,
): RotationPolicyEvaluation {
  const writeBlockAt = policy.writeBlockAt;
  const blocked = now.getTime() >= writeBlockAt.getTime();
  const base = {
    kind: policy.kind,
    currentGeneration: policy.currentGeneration,
    dueAt: policy.dueAt,
    lastCompletedAt: policy.lastCompletedAt,
    writeBlockAt,
    daysUntilWriteBlock: wholeDaysBetween(now, writeBlockAt),
  } as const;

  if (policy.operationId !== null) {
    // A running operation does not lift an already-reached write block: the
    // block is released when the rotation completes, not when it starts.
    return {
      ...base,
      state: "in-progress",
      nextAction: "resume-rotation",
      writesAllowed: !blocked,
    };
  }

  if (policy.lastFailureAt !== null) {
    return {
      ...base,
      state: "failed",
      nextAction: "retry-rotation",
      writesAllowed: !blocked,
    };
  }

  if (blocked) {
    return {
      ...base,
      state: "write-block",
      nextAction: "start-rotation-urgently",
      writesAllowed: false,
    };
  }

  const due = now.getTime() >= policy.dueAt.getTime();
  if (!due) {
    return { ...base, state: "pre-due", nextAction: "none", writesAllowed: true };
  }

  if (policy.mode === "emergency") {
    // Emergency has zero grace, so `due` and `write-block` share an instant;
    // reaching here means the block is due imminently.
    return {
      ...base,
      state: "emergency",
      nextAction: "start-rotation-urgently",
      writesAllowed: true,
    };
  }

  // Inside the scheduled grace window. The first day is reported as plain
  // `due`; afterwards the wording escalates, because an operator who ignored
  // day one needs to see that the deadline is approaching.
  const dueForWholeDays = wholeDaysBetween(policy.dueAt, now);
  return {
    ...base,
    state: dueForWholeDays < 1 ? "due" : "overdue-within-grace",
    nextAction: "start-rotation",
    writesAllowed: true,
  };
}

/**
 * Reads of valid existing ciphertext are available in every policy state.
 *
 * Written as a function rather than a comment so a future change has to
 * deliberately return `false` somewhere, and so the property test can assert
 * it across the whole state space.
 */
export function readsAllowedInState(_state: KeyPolicyState): true {
  return true;
}

export class RotationConflictError extends Error {
  constructor(kind: KeyKind, operationId: string) {
    super(`a ${kind} rotation is already running (operation ${operationId})`);
    this.name = "RotationConflictError";
  }
}

/**
 * At most one operation per policy. The two kinds are independent, so a
 * data-key rotation does not block a wrapping-key rotation.
 */
export function assertRotationMayStart(policy: KeyRotationPolicy): void {
  if (policy.operationId !== null) {
    throw new RotationConflictError(policy.kind, policy.operationId);
  }
}

export function canStartRotation(policy: KeyRotationPolicy): boolean {
  return policy.operationId === null;
}

/**
 * The policy after a rotation completes: the generation advances, the clock
 * restarts from `completedAt`, the failure marker clears, and the write block
 * is recomputed for the new due date.
 */
export function completeRotation(
  policy: KeyRotationPolicy,
  completedAt: Date,
  nextDueAt: Date,
): KeyRotationPolicy {
  return {
    ...policy,
    currentGeneration: policy.currentGeneration + 1,
    lastCompletedAt: completedAt,
    dueAt: nextDueAt,
    writeBlockAt: computeWriteBlockAt(nextDueAt, policy.mode),
    operationId: null,
    lastFailureAt: null,
  };
}

/**
 * The policy after a rotation fails. The generation and the deadline are
 * untouched: a failed attempt must not buy more time, or a rotation that keeps
 * failing would postpone its own write block indefinitely.
 */
export function failRotation(policy: KeyRotationPolicy, failedAt: Date): KeyRotationPolicy {
  return { ...policy, operationId: null, lastFailureAt: failedAt };
}
