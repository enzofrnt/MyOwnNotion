/**
 * The data-key rotation command handler (T084, US5, FR-017, FR-018, FR-025, FR-027).
 *
 * The expensive twin of the wrapping-key rotation. That one rewraps one row
 * per workspace and finishes in milliseconds; this one **re-encrypts every
 * protected record**, and on a workspace of any size it will be interrupted at
 * least once. Everything below follows from that.
 *
 *   - **The old generation stays readable throughout.** It becomes
 *     `decrypt-only`, not `revoked`, because half the workspace is still
 *     sealed under it while the sweep runs. Revoking early is the one
 *     irreversible mistake available here: the unrewritten half would be
 *     permanently unreadable, and the rotation would destroy exactly what it
 *     was protecting.
 *   - **New writes use the new generation immediately.** Waiting for the sweep
 *     to finish would mean weeks of writes under the generation the operator
 *     is trying to leave.
 *   - **The sweep is batched, ordered, and checkpointed.** The cursor is the
 *     envelope row id: unique, totally ordered, and therefore resumable with
 *     no window that skips or repeats a row.
 *   - **Revocation is a separate decision.** This command never revokes as
 *     part of finishing. It reports that nothing remains under the old
 *     generation; retiring it for good is `--revoke-generation`, which refuses
 *     unless that count is zero *at the moment it runs*.
 *
 * The rewrite goes back through `ProtectedRecordService` rather than copying
 * ciphertext columns around. That costs a decrypt and an encrypt per record
 * and buys the thing that matters: the AAD is rebuilt from the record's own
 * identity, so a row whose binding was already wrong fails here instead of
 * being carried forward intact.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Database } from "@myownnotion/database";
import {
  completeRotationPolicy,
  countRecordsInGeneration,
  failRotationPolicy,
  findCurrentGeneration,
  findLatestCheckpoint,
  findRotationPolicy,
  findRunningRotation,
  finishRotationOperation,
  listEntitiesInGeneration,
  markRotationInProgress,
  recordRotationCheckpoint,
  revokeGeneration,
  runSecurityTransaction,
  startRotationOperation,
} from "@myownnotion/database";
import {
  advanceDataKeyRotation,
  type DataKeyRotationProgress,
  mayRevokeGeneration,
  planDataKeyRotation,
  rotationCompletion,
} from "@myownnotion/domain";
import { KeyHierarchy } from "../../security/key-hierarchy.ts";
import { ProtectedRecordService } from "../../security/protected-record-service.ts";
import { type CommandResult, EXIT_CODES } from "../command-output.ts";
import { type ParsedCommand, requireOption } from "../command-parser.ts";

/**
 * How long a data-key generation is good for, and how much grace follows.
 *
 * Shorter than the wrapping key's year, because this key protects the content
 * itself and its exposure is wider: it is unwrapped in memory on every read.
 * The grace is longer for the opposite reason to the wrapping key's — not
 * because the work is trivial, but because it is not, and an operator who
 * starts on the due date needs the sweep to have time to finish before writes
 * are blocked.
 */
export const DATA_KEY_DUE_INTERVAL_DAYS = 180;
export const DATA_KEY_GRACE_DAYS = 30;

/**
 * Records per transaction.
 *
 * Small enough that an interruption costs little and that the sweep never
 * holds a long transaction against ordinary traffic — the workspace stays
 * writable throughout, and a batch that locked hundreds of rows would make
 * rotation and use mutually exclusive.
 */
const BATCH_SIZE = 50;

export interface DataKeyRotationDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly workspaceId: string;
  /** Reads the mounted deployment key, or null when it is unavailable. */
  readonly deploymentKey: () => Buffer | null;
  readonly now: () => Date;
  readonly newId?: () => string;
  /** Test seam: how many records one transaction rewrites. */
  readonly batchSize?: number;
}

/**
 * `security rotation data-key [--yes | --dry-run]`
 * `security rotation data-key --revoke-generation N --yes`
 *
 * Without `--yes` this reports what the sweep would do and changes nothing —
 * which on a rotation measured in hours is the first thing an operator wants,
 * because the count is what tells them whether to start now or overnight.
 */
export async function rotationDataKeyCommand(
  command: ParsedCommand,
  deps: DataKeyRotationDeps,
  options: { execute: boolean },
): Promise<CommandResult> {
  if (command.options["revoke-generation"] !== undefined) {
    return await revokeCommand(command, deps, options);
  }

  const current = await findCurrentGeneration(deps.db, deps.workspaceId);
  if (current === null) {
    return {
      code: EXIT_CODES.refused,
      message: "this workspace has no current data key generation to rotate from",
    };
  }
  const policy = await findRotationPolicy(deps.db, {
    installationId: deps.installationId,
    kind: "data-key",
  });
  if (policy === null) {
    return {
      code: EXIT_CODES.refused,
      message: "no data-key rotation policy is configured for this installation",
    };
  }

  const running = await findRunningRotation(deps.db, {
    installationId: deps.installationId,
    kind: "data-key",
  });

  // On a resume the new generation already exists and is `current`; the
  // generation still to be swept is the one the operation named. On a fresh
  // start the sweep will be over the generation that is current now.
  const fromGeneration = running?.fromVersionOrGeneration ?? current.generation;
  const remaining = await countRecordsInGeneration(deps.db, {
    workspaceId: deps.workspaceId,
    keyGeneration: fromGeneration,
  });

  if (!options.execute) {
    return {
      code: EXIT_CODES.ok,
      message:
        running === null
          ? "dry run: nothing has been changed"
          : "dry run: a rotation is in progress",
      data: {
        wouldRewriteRecords: remaining,
        fromGeneration,
        toGeneration: running?.toVersionOrGeneration ?? current.generation + 1,
        resuming: running !== null,
        // Named so the operator knows the answer before starting: the old
        // generation stays readable, so this is not an outage window.
        readsRemainAvailable: true,
      },
    };
  }

  const nextId = deps.newId ?? (() => randomUUID());
  const batchSize = deps.batchSize ?? BATCH_SIZE;
  const startedAt = deps.now();

  let operationId = running?.id ?? nextId();
  let toGeneration = running?.toVersionOrGeneration ?? current.generation + 1;

  if (running === null) {
    // Validated before anything is written: the generation must advance, and
    // the total must be a sane count.
    planDataKeyRotation({
      operationId,
      fromGeneration,
      toGeneration,
      totalCount: remaining,
    });
    try {
      toGeneration = await runSecurityTransaction(deps.db, async (tx) => {
        const keys = hierarchy(deps);
        // Minting and retiring together. The old generation becomes
        // `decrypt-only` in the same transaction that makes the new one
        // current, so there is never an instant with two writable generations
        // or none.
        const started = await keys.startNextGeneration(tx);
        await startRotationOperation(tx, {
          id: operationId,
          installationId: deps.installationId,
          policyId: policy.id,
          kind: "data-key",
          mode: policy.mode,
          fromVersionOrGeneration: fromGeneration,
          toVersionOrGeneration: started.generation,
          totalCount: remaining,
        });
        await markRotationInProgress(tx, {
          policyId: policy.id,
          operationId,
          now: startedAt,
        });
        return started.generation;
      });
    } catch (error) {
      return {
        code: EXIT_CODES.keyUnavailable,
        message: `the new generation could not be created: ${
          error instanceof Error ? error.message : "unknown reason"
        }`,
      };
    }
  } else {
    operationId = running.id;
  }

  const checkpoint = await findLatestCheckpoint(deps.db, operationId);
  let sequence = (checkpoint?.sequence ?? 0) + 1;
  let progress: DataKeyRotationProgress = {
    operationId,
    fromGeneration,
    toGeneration,
    rewrittenCount: checkpoint?.processedCount ?? 0,
    totalCount: Math.max(remaining, checkpoint?.processedCount ?? 0),
    // The stored position, so a resume continues rather than re-reads. Safe
    // because the set under the old generation only ever shrinks: new writes
    // go to the new generation from the moment it becomes current, so no row
    // can appear behind the cursor after the sweep has passed it.
    cursor: checkpoint?.cursor ?? "",
  };

  for (;;) {
    const batch = await listEntitiesInGeneration(deps.db, {
      workspaceId: deps.workspaceId,
      keyGeneration: fromGeneration,
      afterCursor: progress.cursor,
      limit: batchSize,
    });
    if (batch.length === 0) {
      break;
    }
    try {
      await runSecurityTransaction(deps.db, async (tx) => {
        const keys = hierarchy(deps);
        const records = new ProtectedRecordService({
          db: deps.db,
          keys,
          installationId: deps.installationId,
          workspaceId: deps.workspaceId,
          now: deps.now,
        });
        for (const entry of batch) {
          const plaintext = await records.read(tx, {
            entityType: entry.entityType,
            entityId: entry.entityId,
            recordVersion: entry.recordVersion,
          });
          if (plaintext === null) {
            // The row went away between the listing and the rewrite — an
            // ordinary delete. Nothing to re-encrypt, and nothing wrong.
            continue;
          }
          // Same record version, new generation: the envelope row is updated
          // in place, so revision history keeps its own envelopes and the
          // record's identity is untouched.
          await records.write(tx, {
            entityType: entry.entityType,
            entityId: entry.entityId,
            recordVersion: entry.recordVersion,
            payload: plaintext,
          });
        }
        const last = batch.at(-1);
        progress = advanceDataKeyRotation(progress, {
          cursor: last?.cursor ?? progress.cursor,
          rewritten: batch.length,
        });
        await recordRotationCheckpoint(tx, {
          id: nextId(),
          operationId,
          sequence,
          cursor: progress.cursor,
          processedCount: progress.rewrittenCount,
          totalCount: progress.totalCount,
          checkpointDigest: checkpointDigest(operationId, progress),
          idempotencyKey: `${operationId}:${sequence}`,
          phase: "rewriting",
          now: deps.now(),
        });
      });
      sequence += 1;
    } catch (error) {
      return await abandonRotation(deps, {
        policyId: policy.id,
        operationId,
        progress,
        error,
      });
    }
  }

  const stillUnderOld = await countRecordsInGeneration(deps.db, {
    workspaceId: deps.workspaceId,
    keyGeneration: fromGeneration,
  });
  const completedAt = deps.now();
  const schedule = await runSecurityTransaction(deps.db, async (tx) => {
    await finishRotationOperation(tx, { operationId, phase: "complete", now: completedAt });
    return await completeRotationPolicy(tx, {
      policyId: policy.id,
      operationId,
      now: completedAt,
      dueIntervalDays: DATA_KEY_DUE_INTERVAL_DAYS,
      graceDays: DATA_KEY_GRACE_DAYS,
      currentGeneration: toGeneration,
    });
  });

  return {
    code: EXIT_CODES.ok,
    message: mayRevokeGeneration({ progress, remainingUnderOldGeneration: stillUnderOld })
      ? `data-key rotation complete. Generation ${fromGeneration} now holds nothing and may be revoked with --revoke-generation ${fromGeneration}`
      : `data-key rotation swept every record it found, but ${stillUnderOld} remain under generation ${fromGeneration}; run it again before revoking`,
    data: {
      operationId,
      rewrittenRecords: progress.rewrittenCount,
      fromGeneration,
      toGeneration,
      remainingUnderOldGeneration: stillUnderOld,
      completion: rotationCompletion(progress),
      nextDueAt: schedule.dueAt.toISOString(),
      writeBlockAt: schedule.writeBlockAt.toISOString(),
    },
  };
}

/**
 * `--revoke-generation N` — the deliberate, separate, irreversible step.
 *
 * Kept out of the rotation on purpose. Revocation makes every record still
 * sealed under the generation permanently unreadable, and the count that
 * justifies it can only be trusted at the instant it is taken. Folding it into
 * the sweep would mean the decision was taken against a count measured before
 * the last batch.
 */
async function revokeCommand(
  command: ParsedCommand,
  deps: DataKeyRotationDeps,
  options: { execute: boolean },
): Promise<CommandResult> {
  const raw = requireOption(command, "revoke-generation");
  const generation = Number.parseInt(raw, 10);
  if (!Number.isInteger(generation) || generation < 1) {
    return { code: EXIT_CODES.usage, message: `--revoke-generation must be a generation number` };
  }

  const remaining = await countRecordsInGeneration(deps.db, {
    workspaceId: deps.workspaceId,
    keyGeneration: generation,
  });
  if (remaining > 0) {
    return {
      code: EXIT_CODES.refused,
      message: `generation ${generation} still holds ${remaining} records; revoking it would make them permanently unreadable`,
      data: { generation, remaining },
    };
  }
  if (!options.execute) {
    return {
      code: EXIT_CODES.ok,
      message: `dry run: generation ${generation} holds nothing and could be revoked`,
      data: { generation, remaining: 0 },
    };
  }

  const revoked = await runSecurityTransaction(deps.db, async (tx) =>
    revokeGeneration(tx, {
      workspaceId: deps.workspaceId,
      generation,
      now: deps.now(),
    }),
  );
  return revoked
    ? {
        code: EXIT_CODES.ok,
        message: `generation ${generation} is revoked`,
        data: { generation },
      }
    : {
        // Either it is current — revoking it would leave the workspace with no
        // writable generation — or it is already revoked. Neither is a state
        // this command should force.
        code: EXIT_CODES.refused,
        message: `generation ${generation} is not a retired generation`,
        data: { generation },
      };
}

function hierarchy(deps: DataKeyRotationDeps): KeyHierarchy {
  return new KeyHierarchy({
    db: deps.db,
    installationId: deps.installationId,
    workspaceId: deps.workspaceId,
    deploymentKey: deps.deploymentKey,
    now: deps.now,
  });
}

/**
 * Stops at the first failed batch, leaving everything already rewritten in
 * place.
 *
 * Nothing is rolled back beyond the failed transaction, and nothing needs to
 * be: records under the new generation and records under the old one are both
 * readable, which is the property that makes this rotation safe to interrupt
 * at all.
 */
async function abandonRotation(
  deps: DataKeyRotationDeps,
  input: {
    policyId: string;
    operationId: string;
    progress: DataKeyRotationProgress;
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
  });
  return {
    code: EXIT_CODES.integrityFailure,
    message: `rotation stopped after ${input.progress.rewrittenCount} records: ${
      input.error instanceof Error ? input.error.message : "a record could not be re-encrypted"
    }`,
    data: {
      operationId: input.operationId,
      rewrittenRecords: input.progress.rewrittenCount,
      // Both generations remain readable, so an interrupted rotation is not an
      // outage. This is the difference between this rotation and one that
      // revoked as it went.
      readsRemainAvailable: true,
      resumable: true,
    },
  };
}

function checkpointDigest(operationId: string, progress: DataKeyRotationProgress): string {
  return createHash("sha256")
    .update(`${operationId} ${progress.cursor} ${progress.rewrittenCount}`)
    .digest("hex");
}
