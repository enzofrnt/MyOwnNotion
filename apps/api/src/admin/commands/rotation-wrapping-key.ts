/**
 * The wrapping-key rotation command handler (T083, US5, FR-017, FR-025, FR-027).
 *
 * Rotating the deployment key rewraps **one row per workspace** and touches no
 * protected record, no file chunk, no envelope. That is not an optimisation;
 * it is why the hierarchy has four levels instead of one. The consequence for
 * this handler is that the whole operation is short, so the interesting part
 * is not throughput but what happens when it is interrupted.
 *
 * Three rules follow, and each is a decision the obvious implementation gets
 * wrong:
 *
 *   1. **The work list comes from the rows, not from the checkpoint.** A
 *      checkpoint records what a previous attempt believed it had done; the
 *      rows record what the database holds. When they disagree — a crash
 *      between a rewrap and its checkpoint — the rows are right, and a resume
 *      driven by them converges instead of skipping a workspace.
 *   2. **Each workspace is its own transaction.** One transaction around all
 *      of them would be atomic and unresumable: an interruption at workspace
 *      nine of ten would roll back the other eight. Per-workspace commits mean
 *      an interruption costs at most one workspace of repeated work.
 *   3. **The new version becomes `current` only after every workspace is
 *      rewrapped.** Until then it is `pending`: rewraps may reference it, and
 *      nothing new is written under it. Promoting it earlier would let a
 *      workspace created mid-rotation record a root key wrapped with the old
 *      key and labelled with the new version.
 *
 * Both keys must be present while this runs: the old one to unwrap what it
 * wrapped, the new one to rewrap it. An operator who replaces the mounted file
 * *before* rotating has not rotated — they have made the installation
 * unreadable, and no code here can undo that. Hence `--new-key-file`: the new
 * key arrives as a second mounted file, under the same permission rules, never
 * as an argument.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Database } from "@myownnotion/database";
import {
  completeRotationPolicy,
  failRotationPolicy,
  findCurrentWrappingKeyVersion,
  findLatestCheckpoint,
  findPendingWrappingKeyVersion,
  findRotationPolicy,
  findRunningRotation,
  finishRotationOperation,
  insertWrappingKeyVersion,
  listRootKeysToRewrap,
  markRotationInProgress,
  promoteWrappingKeyVersion,
  recordRotationCheckpoint,
  runSecurityTransaction,
  startRotationOperation,
} from "@myownnotion/database";
import { planWrappingKeyRotation, type WrappingKeyRewrapUnit } from "@myownnotion/domain";
import { loadDeploymentKey } from "../../security/deployment-key.ts";
import { KeyHierarchy } from "../../security/key-hierarchy.ts";
import { type CommandResult, EXIT_CODES } from "../command-output.ts";
import { CommandUsageError, type ParsedCommand, requireOption } from "../command-parser.ts";
import {
  auditRotationCheckpoint,
  auditRotationCompleted,
  auditRotationFailed,
  auditRotationStarted,
  type RotationAudit,
} from "./rotation-audit.ts";

/**
 * How long a wrapping key is good for, and how much grace follows.
 *
 * A year, because rotating this key is cheap and its exposure is small: it
 * lives in one mounted file on the host and never leaves it. The seven-day
 * grace exists so an operator away when the due date passes comes back to a
 * warning rather than to a blocked installation.
 */
export const WRAPPING_KEY_DUE_INTERVAL_DAYS = 365;
export const WRAPPING_KEY_GRACE_DAYS = 7;

export interface WrappingKeyRotationDeps {
  readonly db: Database;
  readonly installationId: string;
  /** Path to the currently mounted key. Still needed: it is what unwraps. */
  readonly deploymentKeyFile: string | undefined;
  readonly now: () => Date;
  readonly newId?: () => string;
  /** Test seam: permission enforcement on the two key files. */
  readonly enforceKeyPermissions?: boolean;
  /**
   * The audit journal, when the caller wired one.
   *
   * Optional so the handler stays testable without a full audit context, and
   * because a rotation must not fail for want of a logger. Every event it does
   * write commits inside the transaction it describes.
   */
  readonly audit?: RotationAudit;
}

interface LoadedKeys {
  readonly current: Uint8Array;
  readonly next: Uint8Array;
  readonly nextFingerprint: string;
}

/**
 * `security rotation wrapping-key --new-key-file PATH [--yes | --dry-run]`
 *
 * Read-only unless `--yes` is given, and `--dry-run` wins over `--yes` — both
 * enforced by the parser. The dry run is not a courtesy: it reports how many
 * workspaces would be rewrapped and the new key's fingerprint, which is how an
 * operator confirms that the new key loads and the old one still opens the
 * rows *before* committing to a change that needs both.
 */
export async function rotationWrappingKeyCommand(
  command: ParsedCommand,
  deps: WrappingKeyRotationDeps,
  options: { execute: boolean },
): Promise<CommandResult> {
  const newKeyFile = requireOption(command, "new-key-file");
  if (deps.deploymentKeyFile === undefined) {
    return {
      code: EXIT_CODES.keyUnavailable,
      message: "no deployment key file is configured; the current key is needed to unwrap",
    };
  }
  if (newKeyFile === deps.deploymentKeyFile) {
    // The same file cannot be both keys. Left unchecked this would "succeed":
    // every row rewrapped under the key it already had, a completed operation,
    // a reset due date, and nothing rotated.
    throw new CommandUsageError(
      "--new-key-file must differ from the currently mounted deployment key",
    );
  }

  let keys: LoadedKeys;
  try {
    keys = loadBothKeys(deps.deploymentKeyFile, newKeyFile, deps.enforceKeyPermissions);
  } catch (error) {
    return {
      code: EXIT_CODES.keyUnavailable,
      message: error instanceof Error ? error.message : "a deployment key could not be read",
    };
  }

  const policy = await findRotationPolicy(deps.db, {
    installationId: deps.installationId,
    kind: "wrapping-key",
  });
  if (policy === null) {
    return {
      code: EXIT_CODES.refused,
      message: "no wrapping-key rotation policy is configured for this installation",
    };
  }

  const currentVersion = await findCurrentWrappingKeyVersion(deps.db, deps.installationId);
  if (currentVersion === null) {
    return {
      code: EXIT_CODES.refused,
      message: "this installation has no wrapping-key version to rotate from",
    };
  }

  const running = await findRunningRotation(deps.db, {
    installationId: deps.installationId,
    kind: "wrapping-key",
  });

  // The version this rotation is rewrapping towards.
  //
  // A `pending` row is the authority, not the operation, and that distinction
  // is what makes a failed attempt recoverable. A failed operation is no
  // longer running, so asking only about operations would report nothing in
  // flight — while half the root keys already sit under a version that
  // exists. Starting fresh from there would target a *third* version and try
  // to unwrap the already-rewrapped rows with the old key, which cannot open
  // them. The `pending` row says "a rotation towards this is unfinished",
  // whether the attempt that created it failed, crashed, or is still going.
  const existingTarget = await findPendingWrappingKeyVersion(deps.db, deps.installationId);
  const targetVersion = existingTarget?.version ?? currentVersion.version + 1;

  if (running !== null && running.toVersionOrGeneration !== targetVersion) {
    // A running operation and a pending version that disagree. Picking either
    // one would half-resume something, so neither is picked.
    return {
      code: EXIT_CODES.integrityFailure,
      message: `the running rotation targets version ${running.toVersionOrGeneration} but version ${targetVersion} is pending; refusing to resume`,
      data: { operationId: running.id },
    };
  }

  const pending = await listRootKeysToRewrap(deps.db, {
    installationId: deps.installationId,
    wrappingKeyVersionId: existingTarget?.id ?? null,
  });

  if (!options.execute) {
    return {
      code: EXIT_CODES.ok,
      message:
        pending.length === 0
          ? "nothing to rewrap: every workspace root key is already under the target version"
          : "dry run: both keys loaded, nothing has been changed",
      data: {
        wouldRewrapWorkspaces: pending.length,
        fromVersion: currentVersion.version,
        toVersion: targetVersion,
        // So the operator can confirm they mounted the file they meant to,
        // before running it for real.
        newKeyFingerprint: keys.nextFingerprint,
        resuming: running !== null,
      },
    };
  }

  const nextId = deps.newId ?? (() => randomUUID());
  const units: WrappingKeyRewrapUnit[] = pending.map((row) => ({
    workspaceId: row.workspaceId,
    rootKeyId: row.rootKeyId,
  }));

  if (units.length === 0 && existingTarget === null) {
    return {
      code: EXIT_CODES.ok,
      message: "nothing to rewrap: this installation has no active workspace root key",
      data: { rewrappedWorkspaces: 0, fromVersion: currentVersion.version },
    };
  }

  if (units.length > 0) {
    // Validated even on a resume. The plan's rules — the version must advance,
    // each workspace appears once — are properties of the rotation, not of the
    // attempt, and a resume that violated them would be as wrong as a start
    // that did.
    planWrappingKeyRotation({
      operationId: running?.id ?? "resume",
      fromVersion: currentVersion.version,
      toVersion: targetVersion,
      units,
    });
  }

  const now = deps.now();
  const targetVersionId = existingTarget?.id ?? nextId();
  const operationId = running?.id ?? nextId();

  await runSecurityTransaction(deps.db, async (tx) => {
    if (existingTarget === null) {
      // The target version row and the first operation are created together: a
      // version with no operation would look to `status` like a completed
      // rotation, and an operation with no version has nothing for its rewraps
      // to reference.
      await insertWrappingKeyVersion(tx, {
        id: targetVersionId,
        installationId: deps.installationId,
        version: targetVersion,
        externalSecretReference: "mounted:deployment-key",
        algorithm: "AES-256-GCM",
        createdAt: now,
        state: "pending",
      });
    }
    if (running === null) {
      // A new operation, even when resuming after a failure. The failed one is
      // history and stays in the table; overwriting its phase would erase the
      // record that an attempt failed, which is what an operator asks about
      // after an interruption.
      await startRotationOperation(tx, {
        id: operationId,
        installationId: deps.installationId,
        policyId: policy.id,
        kind: "wrapping-key",
        mode: policy.mode,
        fromVersionOrGeneration: currentVersion.version,
        toVersionOrGeneration: targetVersion,
        totalCount: units.length,
      });
      await markRotationInProgress(tx, { policyId: policy.id, operationId, now });
      await auditRotationStarted(deps.audit, tx, {
        kind: "wrapping-key",
        operationId,
        from: currentVersion.version,
        to: targetVersion,
        totalCount: units.length,
      });
    }
  });

  const latest = await findLatestCheckpoint(deps.db, operationId);
  let sequence = (latest?.sequence ?? 0) + 1;
  let processed = latest?.processedCount ?? 0;
  const rewrapped: string[] = [];

  for (const unit of units) {
    try {
      // One transaction per workspace: the rewrap and the checkpoint that
      // records it commit together, so no crash can leave a rewrapped row that
      // no checkpoint mentions, or the reverse.
      await runSecurityTransaction(deps.db, async (tx) => {
        const hierarchy = new KeyHierarchy({
          db: deps.db,
          installationId: deps.installationId,
          workspaceId: unit.workspaceId,
          deploymentKey: () => Buffer.from(keys.current),
          now: deps.now,
        });
        await hierarchy.rewrapRootKey(tx, {
          newWrappingKey: keys.next,
          newWrappingKeyVersionId: targetVersionId,
          rewrapOperationId: operationId,
        });
        processed += 1;
        await recordRotationCheckpoint(tx, {
          id: nextId(),
          operationId,
          sequence,
          cursor: unit.workspaceId,
          processedCount: processed,
          totalCount: units.length,
          checkpointDigest: checkpointDigest(operationId, unit.workspaceId, processed),
          idempotencyKey: `${operationId}:${unit.workspaceId}`,
          phase: "rewrapping",
          now: deps.now(),
        });
        await auditRotationCheckpoint(deps.audit, tx, {
          kind: "wrapping-key",
          operationId,
          processedCount: processed,
          totalCount: units.length,
          cursor: unit.workspaceId,
        });
      });
      sequence += 1;
      rewrapped.push(unit.workspaceId);
    } catch (error) {
      return await abandonRotation(deps, {
        policyId: policy.id,
        operationId,
        done: rewrapped.length,
        total: units.length,
        error,
      });
    }
  }

  // Only now: every workspace root key opens under the new key, so the new
  // version can become the one new work uses.
  const completedAt = deps.now();
  const schedule = await runSecurityTransaction(deps.db, async (tx) => {
    await promoteWrappingKeyVersion(tx, {
      installationId: deps.installationId,
      fromVersionId: currentVersion.id,
      toVersionId: targetVersionId,
      now: completedAt,
    });
    await finishRotationOperation(tx, {
      operationId,
      phase: "complete",
      now: completedAt,
    });
    const completed = await completeRotationPolicy(tx, {
      policyId: policy.id,
      operationId,
      now: completedAt,
      dueIntervalDays: WRAPPING_KEY_DUE_INTERVAL_DAYS,
      graceDays: WRAPPING_KEY_GRACE_DAYS,
    });
    await auditRotationCompleted(deps.audit, tx, {
      kind: "wrapping-key",
      operationId,
      processedCount: rewrapped.length,
      to: targetVersion,
      nextDueAt: completed.dueAt,
    });
    return completed;
  });

  return {
    code: EXIT_CODES.ok,
    message:
      "wrapping-key rotation complete. Replace the mounted deployment key with the new file and restart, then destroy the old key",
    data: {
      operationId,
      rewrappedWorkspaces: rewrapped.length,
      fromVersion: currentVersion.version,
      toVersion: targetVersion,
      newKeyFingerprint: keys.nextFingerprint,
      nextDueAt: schedule.dueAt.toISOString(),
      writeBlockAt: schedule.writeBlockAt.toISOString(),
    },
  };
}

function loadBothKeys(
  currentPath: string,
  nextPath: string,
  enforcePermissions: boolean | undefined,
): LoadedKeys {
  const permissionOptions =
    enforcePermissions === undefined ? {} : { enforcePermissions: enforcePermissions };
  const current = loadDeploymentKey(currentPath, permissionOptions);
  const next = loadDeploymentKey(nextPath, permissionOptions);
  return { current: current.bytes, next: next.bytes, nextFingerprint: next.fingerprint };
}

/**
 * Stops at the first failed workspace rather than continuing with the rest.
 *
 * Whatever prevented this rewrap — a row that will not open, a key that is not
 * the one this installation was set up with — will almost certainly prevent
 * the next, and a half-rotated installation reporting "12 of 14 succeeded" is
 * harder to reason about than one that stopped. The committed rewraps stay
 * committed, and the operation stays resumable.
 */
async function abandonRotation(
  deps: WrappingKeyRotationDeps,
  input: {
    policyId: string;
    operationId: string;
    done: number;
    total: number;
    error: unknown;
  },
): Promise<CommandResult> {
  const failedAt = deps.now();
  await runSecurityTransaction(deps.db, async (tx) => {
    await finishRotationOperation(tx, {
      operationId: input.operationId,
      phase: "failed",
      now: failedAt,
    });
    await failRotationPolicy(tx, {
      policyId: input.policyId,
      operationId: input.operationId,
      now: failedAt,
    });
    await auditRotationFailed(deps.audit, tx, {
      kind: "wrapping-key",
      operationId: input.operationId,
      processedCount: input.done,
      reason:
        input.error instanceof Error
          ? input.error.message
          : "a workspace root key could not be rewrapped",
    });
  });
  const reason =
    input.error instanceof Error
      ? input.error.message
      : "a workspace root key could not be rewrapped";
  return {
    code: EXIT_CODES.integrityFailure,
    message: `rotation stopped after ${input.done} of ${input.total} workspaces: ${reason}`,
    data: {
      operationId: input.operationId,
      rewrappedWorkspaces: input.done,
      totalWorkspaces: input.total,
      // Re-running picks up where this stopped: the target version row and the
      // committed rewraps are still there.
      resumable: true,
    },
  };
}

/**
 * A digest over the operation, the workspace, and the count reached.
 *
 * Not a security control — a tamper-evident marker, so two checkpoints
 * claiming the same position with different contents are distinguishable.
 */
function checkpointDigest(operationId: string, workspaceId: string, processed: number): string {
  return createHash("sha256").update(`${operationId} ${workspaceId} ${processed}`).digest("hex");
}
