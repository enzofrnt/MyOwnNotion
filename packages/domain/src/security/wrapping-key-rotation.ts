/**
 * External wrapping-key rotation (T083, US5, FR-017, FR-018).
 *
 * Rotating the deployment key does **not** re-encrypt the workspace. The key
 * hierarchy exists precisely so it does not have to: the deployment key wraps
 * one root key per workspace, so a rotation rewraps that single row and every
 * record, every file chunk, every envelope stays exactly as it is.
 *
 * That is the property this module protects. An implementation that walked the
 * envelopes would be correct in the sense of producing readable data, and
 * catastrophic in every other sense: hours of work per rotation, a window
 * where records are half-rotated, and no way to resume safely. Here the unit
 * of work is a workspace, the cursor is a workspace id, and the operation is
 * idempotent per workspace.
 *
 * Rotating the data-key generation is a *different* operation with the same
 * eight policy states, and it does re-encrypt. Keeping the two apart is
 * deliberate: a deployment key that leaked is not the same emergency as a
 * data key that leaked, and conflating them would make the cheap remedy as
 * expensive as the expensive one.
 */

import type { KeyPolicyState } from "./types.ts";

/** What a wrapping-key rotation touches, per workspace. */
export interface WrappingKeyRewrapUnit {
  readonly workspaceId: string;
  /** The root key row rewrapped for this workspace. Exactly one. */
  readonly rootKeyId: string;
}

export interface WrappingKeyRotationPlan {
  readonly operationId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly units: readonly WrappingKeyRewrapUnit[];
}

/** Where a rotation stopped, so a restart resumes rather than restarts. */
export interface WrappingKeyRotationCheckpoint {
  readonly operationId: string;
  /** Workspaces already rewrapped under `toVersion`. Order is not significant. */
  readonly completedWorkspaceIds: readonly string[];
}

export class WrappingKeyRotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrappingKeyRotationError";
  }
}

/**
 * Builds the plan for one rotation.
 *
 * The version must advance. A rotation to the same version would be a no-op
 * that still moved the policy to `complete`, resetting the due date without
 * any key having changed — the worst possible outcome, because it looks
 * exactly like success.
 */
export function planWrappingKeyRotation(input: {
  operationId: string;
  fromVersion: number;
  toVersion: number;
  units: readonly WrappingKeyRewrapUnit[];
}): WrappingKeyRotationPlan {
  if (!Number.isInteger(input.toVersion) || input.toVersion <= input.fromVersion) {
    throw new WrappingKeyRotationError(
      `a rotation must advance the wrapping key version (from ${input.fromVersion} to ${input.toVersion})`,
    );
  }
  if (input.units.length === 0) {
    throw new WrappingKeyRotationError("a rotation must rewrap at least one workspace root key");
  }
  const workspaces = new Set(input.units.map((unit) => unit.workspaceId));
  if (workspaces.size !== input.units.length) {
    // One row per workspace is the whole economy of this design. Two units for
    // one workspace would mean a second root key exists, which is a corruption
    // rather than a rotation.
    throw new WrappingKeyRotationError("each workspace must appear exactly once in a rotation");
  }
  return {
    operationId: input.operationId,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    units: input.units,
  };
}

/** What is left to do, given where a previous attempt stopped. */
export function remainingUnits(
  plan: WrappingKeyRotationPlan,
  checkpoint: WrappingKeyRotationCheckpoint | null,
): readonly WrappingKeyRewrapUnit[] {
  if (checkpoint === null) {
    return plan.units;
  }
  if (checkpoint.operationId !== plan.operationId) {
    // A checkpoint from another operation says nothing about this one. Treating
    // it as progress would skip workspaces that were never rewrapped.
    throw new WrappingKeyRotationError(
      "checkpoint belongs to a different rotation operation; refusing to resume",
    );
  }
  const done = new Set(checkpoint.completedWorkspaceIds);
  return plan.units.filter((unit) => !done.has(unit.workspaceId));
}

export function isRotationComplete(
  plan: WrappingKeyRotationPlan,
  checkpoint: WrappingKeyRotationCheckpoint | null,
): boolean {
  return remainingUnits(plan, checkpoint).length === 0;
}

/**
 * Whether protected reads may continue during this state.
 *
 * Always true, and worth stating rather than leaving implicit: a wrapping-key
 * rotation never makes data unreadable, because the records are untouched and
 * the previous key version stays able to unwrap what it wrapped until the
 * rotation completes. Blocking reads here would be an outage caused by
 * housekeeping.
 */
export function readsAllowedDuringWrappingRotation(_state: KeyPolicyState): true {
  return true;
}

/**
 * Whether a new protected *write* may use the new version yet.
 *
 * Only once every workspace is rewrapped. A write under the new version while
 * some workspace still has its root key under the old one would produce a
 * record nothing can open after the old version is retired.
 */
export function writesMayUseNewVersion(
  plan: WrappingKeyRotationPlan,
  checkpoint: WrappingKeyRotationCheckpoint | null,
): boolean {
  return isRotationComplete(plan, checkpoint);
}

/** Records progress. Idempotent: rewrapping a workspace twice is harmless. */
export function recordRewrapped(
  checkpoint: WrappingKeyRotationCheckpoint,
  workspaceId: string,
): WrappingKeyRotationCheckpoint {
  if (checkpoint.completedWorkspaceIds.includes(workspaceId)) {
    return checkpoint;
  }
  return {
    operationId: checkpoint.operationId,
    completedWorkspaceIds: [...checkpoint.completedWorkspaceIds, workspaceId],
  };
}
