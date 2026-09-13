/**
 * Recovery-kit replacement, after bootstrap (T081, US5, FR-016, FR-018).
 *
 * The bootstrap repository next door prepares the *first* kit, during setup,
 * when nothing exists yet. This module handles every kit after that, and the
 * difference is the whole reason it exists: replacing a kit happens on a live
 * installation, where an owner is relying on the kit they already hold.
 *
 * That single fact produces every rule here.
 *
 * **The old kit stays active until the new one is confirmed.** This is the
 * opposite of the bootstrap's behaviour, where the superseded kit is rejected
 * immediately. During setup nobody depends on the old one; afterwards, an
 * owner who starts a replacement and closes the tab must still be able to
 * recover with the kit in their safe. A window with no usable kit is a window
 * where an unlucky disk failure is unrecoverable.
 *
 * **Supersession and confirmation are one transaction.** The moment the new
 * kit becomes `active/confirmed`, the old one becomes `superseded/confirmed`.
 * The partial unique index permits exactly one active kit, so the database
 * refuses any ordering that would leave two.
 *
 * **The epoch advances only on confirmation.** An epoch is what a kit's
 * ciphertext is bound to, so advancing it early would invalidate the kit an
 * owner still holds — in the middle of an operation they might not finish.
 */

import { and, desc, eq, gt, ne } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { installations, recoveryEpochs, recoveryKits } from "../../schema/security/index.ts";

type Executor = Database | Transaction;

export class RecoveryKitRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecoveryKitRepositoryError";
    this.code = code;
  }
}

export interface RecoveryKitRecord {
  readonly id: string;
  readonly installationId: string;
  readonly sourceLineageId: string;
  readonly recoveryEpoch: number;
  readonly authorizationState: string;
  readonly deliveryState: string;
  readonly supportedKeyGenerations: readonly number[];
  readonly artifactDigest: string;
  readonly downloadTokenHash: string | null;
  readonly downloadExpiresAt: Date | null;
  readonly downloadConsumedAt: Date | null;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
}

type Row = typeof recoveryKits.$inferSelect;

function toRecord(row: Row): RecoveryKitRecord {
  return {
    id: row.id,
    installationId: row.installationId,
    sourceLineageId: row.sourceLineageId,
    recoveryEpoch: row.recoveryEpoch,
    authorizationState: row.authorizationState,
    deliveryState: row.deliveryState,
    supportedKeyGenerations: row.supportedKeyGenerations,
    artifactDigest: row.artifactDigest,
    downloadTokenHash: row.downloadTokenHash,
    downloadExpiresAt: row.downloadExpiresAt,
    downloadConsumedAt: row.downloadConsumedAt,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  };
}

/** The kit an owner can currently recover with, if any. */
export async function findActiveKit(
  executor: Executor,
  installationId: string,
): Promise<RecoveryKitRecord | null> {
  const rows = await executor
    .select()
    .from(recoveryKits)
    .where(
      and(
        eq(recoveryKits.installationId, installationId),
        eq(recoveryKits.authorizationState, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

/** The replacement in flight, if a preparation has not yet been confirmed. */
export async function findPendingKit(
  executor: Executor,
  installationId: string,
): Promise<RecoveryKitRecord | null> {
  const rows = await executor
    .select()
    .from(recoveryKits)
    .where(
      and(
        eq(recoveryKits.installationId, installationId),
        eq(recoveryKits.authorizationState, "provisional"),
      ),
    )
    .orderBy(desc(recoveryKits.createdAt))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function findKit(
  executor: Executor,
  kitId: string,
): Promise<RecoveryKitRecord | null> {
  const rows = await executor
    .select()
    .from(recoveryKits)
    .where(eq(recoveryKits.id, kitId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export interface PrepareReplacementInput {
  readonly kitId: string;
  readonly installationId: string;
  readonly sourceLineageId: string;
  readonly recoveryEpoch: number;
  readonly artifactDigest: string;
  readonly downloadTokenHash: string;
  readonly downloadExpiresAt: Date;
  readonly supportedKeyGenerations: readonly number[];
  readonly now: Date;
}

/**
 * Allocates the epoch for a replacement while holding the installation's
 * recovery state lock.  Reading the active epoch before opening the
 * transaction lets a confirmation commit between the read and the insert;
 * the resulting kit can then be bound to an epoch that already exists and
 * become impossible to confirm.
 */
export async function allocateNextRecoveryEpoch(
  tx: Transaction,
  installationId: string,
): Promise<number> {
  const installation = await tx
    .select({ id: installations.id })
    .from(installations)
    .where(eq(installations.id, installationId))
    .for("update")
    .limit(1);
  if (installation.length === 0) {
    throw new RecoveryKitRepositoryError(
      "not_found",
      "the installation for the recovery replacement does not exist",
    );
  }

  const rows = await tx
    .select({ epoch: recoveryEpochs.epoch })
    .from(recoveryEpochs)
    .where(
      and(eq(recoveryEpochs.installationId, installationId), eq(recoveryEpochs.state, "active")),
    )
    .for("update")
    .limit(1);
  // A live installation normally has an active epoch. Keeping the bootstrap
  // default makes this helper safe for the narrow setup window where that row
  // has not been created yet; the installation lock still serializes callers.
  return (rows[0]?.epoch ?? 0) + 1;
}

/**
 * Prepares a replacement, rejecting any earlier unconfirmed attempt.
 *
 * The *active* kit is untouched: it stays the one an owner can recover with
 * until the replacement is confirmed. Only a previous half-finished attempt is
 * cleared, and it must be, because leaving two downloadable kits would mean
 * two one-time downloads and no way to tell which the owner kept.
 */
export async function prepareReplacementKit(
  tx: Transaction,
  input: PrepareReplacementInput,
): Promise<RecoveryKitRecord> {
  await tx
    .update(recoveryKits)
    .set({ authorizationState: "rejected", deliveryState: "expired" })
    .where(
      and(
        eq(recoveryKits.installationId, input.installationId),
        eq(recoveryKits.authorizationState, "provisional"),
      ),
    );

  const inserted = await tx
    .insert(recoveryKits)
    .values({
      id: input.kitId,
      installationId: input.installationId,
      sourceLineageId: input.sourceLineageId,
      recoveryEpoch: input.recoveryEpoch,
      authorizationState: "provisional",
      deliveryState: "downloadable",
      supportedKeyGenerations: [...input.supportedKeyGenerations],
      artifactDigest: input.artifactDigest,
      downloadTokenHash: input.downloadTokenHash,
      downloadExpiresAt: input.downloadExpiresAt,
      createdAt: input.now,
    })
    .returning();
  const row = inserted[0];
  if (row === undefined) {
    throw new RecoveryKitRepositoryError("internal_error", "the replacement kit was not inserted");
  }
  return toRecord(row);
}

/**
 * Consumes the one-time download.
 *
 * Conditional on the kit still being `downloadable`, so a second request
 * updates nothing and is told so. Checking first and updating after would
 * leave a window in which two concurrent downloads both saw `downloadable`,
 * and a one-time download that can happen twice is not one.
 */
export async function consumeKitDownload(
  tx: Transaction,
  input: { kitId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(recoveryKits)
    .set({ deliveryState: "download-consumed", downloadConsumedAt: input.now })
    .where(
      and(
        eq(recoveryKits.id, input.kitId),
        eq(recoveryKits.deliveryState, "downloadable"),
        gt(recoveryKits.downloadExpiresAt, input.now),
      ),
    )
    .returning({ id: recoveryKits.id });
  return rows.length > 0;
}

/**
 * Confirms the replacement and retires the kit it replaces, in one transaction.
 *
 * Also advances the epoch, which is why this is one function rather than
 * three: the new kit becoming active, the old one becoming superseded, and the
 * epoch moving are the same event. Split across calls, any interruption
 * between them leaves an installation whose kit and epoch disagree — and a kit
 * bound to an epoch that is no longer current cannot be opened.
 */
export async function confirmReplacementKit(
  tx: Transaction,
  input: {
    kitId: string;
    installationId: string;
    newEpoch: number;
    epochId: string;
    now: Date;
  },
): Promise<boolean> {
  // Preparation and confirmation take the same installation lock before
  // touching a pending kit or its epoch. This gives both operations one lock
  // order and prevents a deadlock while also making epoch allocation atomic.
  const installation = await tx
    .select({ id: installations.id })
    .from(installations)
    .where(eq(installations.id, input.installationId))
    .for("update")
    .limit(1);
  if (installation.length === 0) {
    throw new RecoveryKitRepositoryError(
      "not_found",
      "the installation for the recovery replacement does not exist",
    );
  }

  // Validate the pending replacement before touching the active kit. A
  // rejected confirmation must leave the installation exactly as it was; in
  // particular, retrying a confirmation after it already succeeded must not
  // supersede the currently active kit a second time.
  const pending = await tx
    .select({ id: recoveryKits.id })
    .from(recoveryKits)
    .where(
      and(
        eq(recoveryKits.id, input.kitId),
        eq(recoveryKits.installationId, input.installationId),
        eq(recoveryKits.authorizationState, "provisional"),
        eq(recoveryKits.deliveryState, "download-consumed"),
        eq(recoveryKits.recoveryEpoch, input.newEpoch),
      ),
    )
    .for("update")
    .limit(1);
  if (pending.length === 0) {
    return false;
  }

  // The old active kit first: the partial unique index permits exactly one
  // active kit, so promoting before retiring would be rejected by the
  // database. That rejection is the index doing its job. The pending-row
  // validation above ensures this ordering is reached only for a valid
  // replacement.
  await tx
    .update(recoveryKits)
    .set({ authorizationState: "superseded", supersededAt: input.now })
    .where(
      and(
        eq(recoveryKits.installationId, input.installationId),
        eq(recoveryKits.authorizationState, "active"),
        ne(recoveryKits.id, input.kitId),
      ),
    );

  const promoted = await tx
    .update(recoveryKits)
    .set({ authorizationState: "active", deliveryState: "confirmed", confirmedAt: input.now })
    .where(
      and(
        eq(recoveryKits.id, input.kitId),
        eq(recoveryKits.installationId, input.installationId),
        eq(recoveryKits.authorizationState, "provisional"),
        // Only a kit that was actually downloaded may be confirmed. An owner
        // cannot have stored a file they never received, and this is the one
        // check standing between "I clicked the button" and a kit nobody has.
        eq(recoveryKits.deliveryState, "download-consumed"),
      ),
    )
    .returning({ id: recoveryKits.id });

  if (promoted.length === 0) {
    // The row lock makes this path unreachable for a concurrent confirmer. If
    // a future change invalidates that assumption, abort the transaction so
    // the active kit cannot be retired without its replacement.
    throw new RecoveryKitRepositoryError(
      "internal_error",
      "the validated recovery replacement could not be promoted",
    );
  }

  await tx
    .update(recoveryEpochs)
    .set({ state: "revoked", revokedAt: input.now })
    .where(
      and(
        eq(recoveryEpochs.installationId, input.installationId),
        eq(recoveryEpochs.state, "active"),
      ),
    );
  await tx.insert(recoveryEpochs).values({
    id: input.epochId,
    installationId: input.installationId,
    epoch: input.newEpoch,
    state: "active",
    createdAt: input.now,
  });
  return true;
}

/** The epoch a new kit must be bound to. */
export async function currentRecoveryEpoch(
  executor: Executor,
  installationId: string,
): Promise<number> {
  const rows = await executor
    .select({ epoch: recoveryEpochs.epoch })
    .from(recoveryEpochs)
    .where(
      and(eq(recoveryEpochs.installationId, installationId), eq(recoveryEpochs.state, "active")),
    )
    .limit(1);
  // An installation with no epoch row has never confirmed a kit. Starting at 1
  // rather than 0 keeps the schema's `epoch >= 1` check satisfied and matches
  // what the bootstrap writes.
  return rows[0]?.epoch ?? 1;
}

/**
 * Revokes the active kit without replacing it.
 *
 * Deliberately leaves the installation with no usable kit, and that is the
 * point: an owner who believes their kit has been seen needs a way to say so
 * immediately, and making them wait for a replacement to be generated and
 * stored would leave the compromised kit valid throughout.
 */
export async function revokeActiveKit(
  tx: Transaction,
  input: { installationId: string; revocationCode: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(recoveryKits)
    .set({ authorizationState: "revoked", revokedAt: input.now })
    .where(
      and(
        eq(recoveryKits.installationId, input.installationId),
        eq(recoveryKits.authorizationState, "active"),
      ),
    )
    .returning({ id: recoveryKits.id });
  if (rows.length === 0) {
    return false;
  }
  await tx
    .update(recoveryEpochs)
    .set({ revocationCode: input.revocationCode })
    .where(
      and(
        eq(recoveryEpochs.installationId, input.installationId),
        eq(recoveryEpochs.state, "active"),
      ),
    );
  return true;
}
