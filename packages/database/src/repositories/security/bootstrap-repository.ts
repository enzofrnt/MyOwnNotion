/**
 * Attempt-scoped bootstrap persistence and the atomic promotion (T031 / T132, feature 002).
 *
 * Two responsibilities, deliberately in one module because they share the
 * invariant that matters:
 *
 *   - persist an attempt and its pending credential material (passkey and
 *     password), all scoped to the attempt and none of it constituting ownership;
 *   - run the single serializable transaction that turns `0/0` into `1/1`.
 *
 * The promotion is the only place in the codebase that creates an owner. It
 * creates the owner credentials (passkey + password), the owner, the canonical
 * workspace binding, and the initial device and key generation — or it does
 * none of them. Recovery kits are prepared later from settings.
 */

import {
  abandonAttempt,
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
  "password-set",
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
 * Claims the single open bootstrap attempt.
 *
 * While ownership is still `0/0`, any incomplete open attempt is abandoned so
 * a later browser can finish. Conflict only arises when an owner already
 * exists or a true race leaves another open row after abandon.
 */
export interface ClaimResult {
  readonly attempt: BootstrapAttempt;
  readonly supersededAttemptId: string | null;
}

export async function claimAttempt(
  db: Database,
  attempt: BootstrapAttempt,
  now: Date,
): Promise<ClaimResult> {
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

      // Abandon any incomplete open attempt — live or stale — so a second
      // browser can take over while ownership is still 0/0.
      const open = await findOpenAttempt(tx, { installationId: attempt.installationId });
      let supersededAttemptId: string | null = null;
      if (open !== null) {
        await persistAttempt(tx, abandonAttempt(open, now));
        supersededAttemptId = open.attemptId;
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
      return { attempt, supersededAttemptId };
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
 * Upserts verified credential material against the attempt by kind.
 *
 * Passkey and password rows coexist under the same attempt; saving one must
 * not delete the other.
 */
export async function saveVerifiedCredential(
  tx: Transaction,
  attempt: BootstrapAttempt,
  credential: PendingCredentialInput,
): Promise<void> {
  await tx
    .delete(pendingBootstrapCredentials)
    .where(
      and(
        eq(pendingBootstrapCredentials.attemptId, attempt.attemptId),
        eq(pendingBootstrapCredentials.credentialKind, credential.credentialKind),
      ),
    );
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
 * transaction. Legacy kit-era helper retained for older flows and tests.
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

/**
 * Reads the provisional kit a download is about.
 */
export async function findProvisionalKit(
  tx: Transaction,
  kitId: string,
): Promise<{ readonly downloadTokenHash: string | null } | null> {
  const [row] = await tx
    .select({ downloadTokenHash: recoveryKits.downloadTokenHash })
    .from(recoveryKits)
    .where(eq(recoveryKits.id, kitId))
    .limit(1);
  return row ?? null;
}

/** Marks the kit's one-time download as consumed. Legacy kit-era helper. */
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
  readonly passkeyCredentialId: string;
  readonly passwordCredentialId: string;
  readonly workspaceId: string;
  readonly workspaceSchemaVersion: number;
  readonly deviceId: string;
  readonly deviceBindingId: string;
  readonly deviceName: string;
  readonly devicePlatform: string | null;
  readonly dataKeyGenerationId: string;
  readonly wrappedDataKey: string;
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
 * Requires `password-set` with both pending passkey and password rows. Does
 * not create or confirm a recovery kit — that happens later from settings.
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
    if (attempt.state !== "password-set") {
      throw new SecurityRepositoryError(
        "conflict",
        `attempt is ${attempt.state}; promotion requires password-set`,
      );
    }

    const before = await readCounts(tx);
    if (before.ownerCount !== 0) {
      throw new SecurityRepositoryError("conflict", "ownership is already committed");
    }

    const pending = await tx
      .select()
      .from(pendingBootstrapCredentials)
      .where(eq(pendingBootstrapCredentials.attemptId, attempt.attemptId));
    const passkey = pending.find((row) => row.credentialKind === "passkey");
    const password = pending.find((row) => row.credentialKind === "password");
    if (passkey === undefined || password === undefined) {
      throw new SecurityRepositoryError(
        "conflict",
        "passkey and password material must both be held for this attempt",
      );
    }

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

    await tx.insert(passkeyCredentials).values({
      id: input.passkeyCredentialId,
      ownerId: input.ownerId,
      credentialId: passkey.credentialIdDigest,
      publicKey: passkey.publicKey ?? "",
      signCount: passkey.signCount,
      state: "active",
      createdAt: input.now,
    });

    await tx.insert(passwordCredentialVersions).values({
      id: input.passwordCredentialId,
      ownerId: input.ownerId,
      passwordHash: password.passwordHash ?? "",
      hashAlgorithm: password.hashAlgorithm ?? "",
      state: "active",
      createdAt: input.now,
    });

    await tx.insert(authorizedDevices).values({
      id: input.deviceId,
      ownerId: input.ownerId,
      deviceBindingId: input.deviceBindingId,
      name: input.deviceName,
      platform: input.devicePlatform,
      clientType: "web",
      state: "active",
      authorizedAt: input.now,
      lastActivityAt: null,
      lastSyncAt: null,
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

    await tx
      .update(bootstrapAttempts)
      .set({ bootstrapState: "confirmed", updatedAt: input.now })
      .where(eq(bootstrapAttempts.id, attempt.attemptId));

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
