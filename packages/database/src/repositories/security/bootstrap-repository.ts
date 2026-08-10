/**
 * Attempt-scoped bootstrap persistence and the atomic promotion (T031, feature 002).
 *
 * Two responsibilities, deliberately in one module because they share the
 * invariant that matters:
 *
 *   - persist an attempt, its pending credential material, and its provisional
 *     kit, all scoped to the attempt and none of it constituting ownership;
 *   - run the single serializable transaction that turns `0/0` into `1/1`.
 *
 * The promotion is the only place in the codebase that creates an owner. It
 * creates the owner credential, the owner, the canonical workspace binding, the
 * initial device and key generation, and activates the kit — or it does none of
 * them. There is no partial outcome to observe, because there is no second
 * transaction that could fail after the first committed.
 */

import {
  type BootstrapAttempt,
  type BootstrapState,
  countsForBootstrapState,
} from "@myownnotion/domain";
import { and, eq, inArray } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { owners, workspaces } from "../../schema/index.ts";
import {
  authorizedDevices,
  bootstrapAttempts,
  dataKeyGenerations,
  installations,
  passkeyCredentials,
  passwordCredentialVersions,
  pendingBootstrapCredentials,
  recoveryEpochs,
  recoveryKits,
} from "../../schema/security/index.ts";
import { readCounts, requireInstallation } from "./installation-repository.ts";
import {
  isUniqueViolation,
  SecurityRepositoryError,
  type SecurityScope,
} from "./repository-types.ts";
import { runSecurityRead, runSecurityTransaction } from "./transaction.ts";

type Executor = Database | Transaction;

const OPEN_STATES: BootstrapState[] = [
  "started",
  "credential-verified",
  "recovery-prepared",
  "download-consumed",
];

function toAttempt(row: typeof bootstrapAttempts.$inferSelect): BootstrapAttempt {
  return {
    attemptId: row.id,
    installationId: row.installationId,
    state: row.bootstrapState as BootstrapState,
    capabilityHash: row.capabilityHash,
    clientNonceHash: row.clientNonceHash,
    challengeHash: row.challengeHash,
    credentialVerified: row.challengeHash !== null,
    recoveryKitId: row.recoveryKitId,
    downloadTokenHash: row.downloadTokenHash,
    downloadExpiresAt: row.downloadExpiresAt,
    downloadConsumedAt: row.downloadConsumedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The single open attempt, or null. The partial unique index guarantees one. */
export async function findOpenAttempt(
  executor: Executor,
  scope: SecurityScope,
): Promise<BootstrapAttempt | null> {
  const rows = await executor
    .select()
    .from(bootstrapAttempts)
    .where(
      and(
        eq(bootstrapAttempts.installationId, scope.installationId),
        inArray(bootstrapAttempts.bootstrapState, OPEN_STATES),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toAttempt(row);
}

export async function findAttempt(
  executor: Executor,
  attemptId: string,
): Promise<BootstrapAttempt | null> {
  const rows = await executor
    .select()
    .from(bootstrapAttempts)
    .where(eq(bootstrapAttempts.id, attemptId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toAttempt(row);
}

export class BootstrapClaimConflictError extends SecurityRepositoryError {
  constructor() {
    super("conflict", "another bootstrap attempt is already open for this installation");
    this.name = "BootstrapClaimConflictError";
  }
}

/**
 * Claims the single open attempt.
 *
 * Concurrent claimers race on `bootstrap_attempts_open_unique`; exactly one
 * wins and the rest are told they lost. Returning the existing attempt instead
 * would hand a second browser a capability it never proved it owned.
 */
export async function claimAttempt(
  db: Database,
  attempt: BootstrapAttempt,
): Promise<BootstrapAttempt> {
  try {
    return await runSecurityTransaction(db, async (tx) => {
      const installation = await requireInstallation(tx);
      if (installation.id !== attempt.installationId) {
        throw new SecurityRepositoryError("forbidden", "scope does not match this installation");
      }
      const counts = await readCounts(tx);
      if (counts.ownerCount !== 0) {
        // The bootstrap surface must close the moment ownership commits.
        throw new SecurityRepositoryError(
          "bootstrap_unavailable",
          "this installation already has an owner",
        );
      }
      await tx.insert(bootstrapAttempts).values({
        id: attempt.attemptId,
        installationId: attempt.installationId,
        bootstrapState: attempt.state,
        clientNonceHash: attempt.clientNonceHash,
        capabilityHash: attempt.capabilityHash,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      });
      await tx
        .update(installations)
        .set({ state: "bootstrap-in-progress", updatedAt: attempt.createdAt })
        .where(eq(installations.id, installation.id));
      return attempt;
    });
  } catch (error) {
    if (isUniqueViolation(error, "bootstrap_attempts_open_unique")) {
      throw new BootstrapClaimConflictError();
    }
    throw error;
  }
}

export interface PendingCredentialInput {
  readonly id: string;
  readonly attemptId: string;
  readonly credentialKind: "passkey" | "password";
  readonly credentialIdDigest: string;
  readonly publicKey?: string;
  readonly passwordHash?: string;
  readonly hashAlgorithm?: string;
  readonly origin: string;
  readonly relyingPartyId?: string;
  readonly signCount: number;
  readonly userVerified: boolean;
  readonly verifiedAt: Date;
  readonly expiresAt: Date;
}

/**
 * Persists the verified credential against the attempt.
 *
 * No owner foreign key: this record exists precisely while `ownerCount` is 0,
 * and the schema has no column that could accidentally bind it to an owner.
 */
export async function saveVerifiedCredential(
  tx: Transaction,
  attempt: BootstrapAttempt,
  credential: PendingCredentialInput,
): Promise<void> {
  await tx
    .delete(pendingBootstrapCredentials)
    .where(eq(pendingBootstrapCredentials.attemptId, attempt.attemptId));
  await tx.insert(pendingBootstrapCredentials).values({
    id: credential.id,
    attemptId: credential.attemptId,
    credentialKind: credential.credentialKind,
    credentialIdDigest: credential.credentialIdDigest,
    publicKey: credential.publicKey ?? null,
    passwordHash: credential.passwordHash ?? null,
    hashAlgorithm: credential.hashAlgorithm ?? null,
    origin: credential.origin,
    relyingPartyId: credential.relyingPartyId ?? null,
    signCount: credential.signCount,
    userVerified: credential.userVerified ? "true" : "false",
    verifiedAt: credential.verifiedAt,
    expiresAt: credential.expiresAt,
  });
  await persistAttempt(tx, attempt);
}

/** Writes the attempt's current state back. */
export async function persistAttempt(tx: Transaction, attempt: BootstrapAttempt): Promise<void> {
  await tx
    .update(bootstrapAttempts)
    .set({
      bootstrapState: attempt.state,
      challengeHash: attempt.challengeHash,
      downloadTokenHash: attempt.downloadTokenHash,
      downloadExpiresAt: attempt.downloadExpiresAt,
      downloadConsumedAt: attempt.downloadConsumedAt,
      recoveryKitId: attempt.recoveryKitId,
      updatedAt: attempt.updatedAt,
    })
    .where(eq(bootstrapAttempts.id, attempt.attemptId));
}

export interface ProvisionalKitInput {
  readonly kitId: string;
  readonly installationId: string;
  readonly sourceLineageId: string;
  readonly recoveryEpoch: number;
  readonly artifactDigest: string;
  readonly downloadTokenHash: string;
  readonly downloadExpiresAt: Date;
  readonly supportedKeyGenerations: readonly number[];
  readonly createdAt: Date;
}

/**
 * Prepares a provisional kit, rejecting the one it supersedes in the same
 * transaction. Two statements, one commit: a regeneration that left the old
 * kit usable would defeat the one-time delivery entirely.
 */
export async function prepareProvisionalKit(
  tx: Transaction,
  attempt: BootstrapAttempt,
  kit: ProvisionalKitInput,
  supersededKitId: string | null,
): Promise<void> {
  if (supersededKitId !== null) {
    await tx
      .update(recoveryKits)
      .set({ authorizationState: "rejected", deliveryState: "expired" })
      .where(eq(recoveryKits.id, supersededKitId));
  }
  await tx.insert(recoveryKits).values({
    id: kit.kitId,
    installationId: kit.installationId,
    sourceLineageId: kit.sourceLineageId,
    recoveryEpoch: kit.recoveryEpoch,
    authorizationState: "provisional",
    deliveryState: "downloadable",
    supportedKeyGenerations: [...kit.supportedKeyGenerations],
    artifactDigest: kit.artifactDigest,
    downloadTokenHash: kit.downloadTokenHash,
    downloadExpiresAt: kit.downloadExpiresAt,
    createdAt: kit.createdAt,
  });
  await persistAttempt(tx, attempt);
}

/** Marks the kit's one-time download as consumed. */
export async function recordKitDownloaded(
  tx: Transaction,
  attempt: BootstrapAttempt,
  kitId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(recoveryKits)
    .set({ deliveryState: "download-consumed", downloadConsumedAt: now })
    .where(eq(recoveryKits.id, kitId));
  await persistAttempt(tx, attempt);
}

export interface PromotionInput {
  readonly attempt: BootstrapAttempt;
  readonly ownerId: string;
  readonly credentialId: string;
  readonly workspaceId: string;
  readonly workspaceSchemaVersion: number;
  readonly deviceId: string;
  readonly deviceBindingId: string;
  readonly deviceName: string;
  readonly devicePlatform: string | null;
  readonly dataKeyGenerationId: string;
  readonly wrappedDataKey: string;
  readonly recoveryEpochId: string;
  readonly now: Date;
}

export interface PromotionResult {
  readonly ownerId: string;
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly ownerCount: 1;
  readonly workspaceCount: 1;
}

/**
 * The atomic promotion: `0/0` in, `1/1` out, in one serializable transaction.
 *
 * Everything commits together — the owner credential promoted from the pending
 * material, the owner, the canonical workspace binding, the first authorized
 * device, the first data-key generation, the recovery epoch, and the kit moving
 * to `active/confirmed`. A failure anywhere rolls all of it back, so no partial
 * owner is ever observable, not even for an instant.
 */
export async function promoteBootstrap(
  db: Database,
  input: PromotionInput,
): Promise<PromotionResult> {
  return runSecurityTransaction(db, async (tx) => {
    const attempt = await findAttempt(tx, input.attempt.attemptId);
    if (attempt === null) {
      throw new SecurityRepositoryError("not_found", "bootstrap attempt no longer exists");
    }
    if (attempt.state !== "download-consumed") {
      // The domain refuses this too; the repository refuses it again because a
      // concurrent request could have moved the attempt since it was read.
      throw new SecurityRepositoryError(
        "conflict",
        `attempt is ${attempt.state}; promotion requires a consumed download`,
      );
    }

    const before = await readCounts(tx);
    if (before.ownerCount !== 0) {
      throw new SecurityRepositoryError("conflict", "ownership is already committed");
    }

    const pending = await tx
      .select()
      .from(pendingBootstrapCredentials)
      .where(eq(pendingBootstrapCredentials.attemptId, attempt.attemptId))
      .limit(1);
    const credential = pending[0];
    if (credential === undefined) {
      throw new SecurityRepositoryError(
        "conflict",
        "no verified credential material is held for this attempt",
      );
    }

    // Bind the canonical feature-001 workspace. Created only when bootstrap is
    // the first thing that ever ran; its ID is never regenerated.
    const existing = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (existing[0] === undefined) {
      await tx
        .insert(workspaces)
        .values({ id: input.workspaceId, schemaVersion: input.workspaceSchemaVersion });
    }

    await tx.insert(owners).values({
      id: input.ownerId,
      installationId: attempt.installationId,
      state: "active",
      lastAuthenticatedAt: input.now,
      createdAt: input.now,
    });

    // Promote the pending material into its committed credential table.
    if (credential.credentialKind === "passkey") {
      await tx.insert(passkeyCredentials).values({
        id: input.credentialId,
        ownerId: input.ownerId,
        credentialId: credential.credentialIdDigest,
        publicKey: credential.publicKey ?? "",
        signCount: credential.signCount,
        state: "active",
        createdAt: input.now,
      });
    } else {
      await tx.insert(passwordCredentialVersions).values({
        id: input.credentialId,
        ownerId: input.ownerId,
        passwordHash: credential.passwordHash ?? "",
        hashAlgorithm: credential.hashAlgorithm ?? "",
        state: "active",
        createdAt: input.now,
      });
    }

    await tx.insert(authorizedDevices).values({
      id: input.deviceId,
      ownerId: input.ownerId,
      deviceBindingId: input.deviceBindingId,
      name: input.deviceName,
      platform: input.devicePlatform,
      clientType: "web",
      state: "active",
      authorizedAt: input.now,
      // Null until a real activity or synchronization event; the promotion is
      // neither, and synthesizing them here would claim activity that never
      // happened.
      lastActivityAt: null,
      lastSyncAt: null,
    });

    await tx.insert(recoveryEpochs).values({
      id: input.recoveryEpochId,
      installationId: attempt.installationId,
      epoch: 1,
      state: "active",
      createdAt: input.now,
    });

    await tx.insert(dataKeyGenerations).values({
      id: input.dataKeyGenerationId,
      installationId: attempt.installationId,
      workspaceId: input.workspaceId,
      generation: 1,
      wrappedKeyMaterial: input.wrappedDataKey,
      state: "current",
      createdAt: input.now,
    });

    if (attempt.recoveryKitId === null) {
      throw new SecurityRepositoryError("conflict", "attempt has no recovery kit to confirm");
    }
    await tx
      .update(recoveryKits)
      .set({ authorizationState: "active", deliveryState: "confirmed", confirmedAt: input.now })
      .where(eq(recoveryKits.id, attempt.recoveryKitId));

    await tx
      .update(bootstrapAttempts)
      .set({ bootstrapState: "confirmed", updatedAt: input.now })
      .where(eq(bootstrapAttempts.id, attempt.attemptId));

    // The pending material has served its purpose; leaving it would keep a
    // second copy of credential material with no owner scope.
    await tx
      .delete(pendingBootstrapCredentials)
      .where(eq(pendingBootstrapCredentials.attemptId, attempt.attemptId));

    await tx
      .update(installations)
      .set({
        state: "ready",
        ownerId: input.ownerId,
        workspaceId: input.workspaceId,
        updatedAt: input.now,
      })
      .where(eq(installations.id, attempt.installationId));

    const after = await readCounts(tx);
    if (after.ownerCount !== 1 || after.workspaceCount !== 1) {
      // Unreachable through the constraints; refusing beats committing a shape
      // the design says cannot exist.
      throw new SecurityRepositoryError(
        "internal_error",
        `promotion did not reach 1/1 (observed ${after.ownerCount}/${after.workspaceCount})`,
      );
    }
    expectPromotedCounts(attempt.state);

    return {
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      deviceId: input.deviceId,
      ownerCount: 1,
      workspaceCount: 1,
    };
  });
}

/** Cross-check against the domain's own view of what `confirmed` means. */
function expectPromotedCounts(previousState: BootstrapState): void {
  const counts = countsForBootstrapState("confirmed");
  if (counts.ownerCount !== 1 || counts.workspaceCount !== 1) {
    throw new SecurityRepositoryError(
      "internal_error",
      `domain and repository disagree on the counts after ${previousState}`,
    );
  }
}

/** Reads the committed counts without opening a write transaction. */
export async function bootstrapCounts(db: Database): Promise<{
  ownerCount: number;
  workspaceCount: number;
}> {
  return runSecurityRead(db, async (tx) => readCounts(tx));
}
