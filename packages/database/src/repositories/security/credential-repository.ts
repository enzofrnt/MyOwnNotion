/**
 * Owner credential persistence (T042/T043, feature 002).
 *
 * Passkeys and the password alternative live side by side here because they
 * are alternatives, not layers: the repository never asks whether a password
 * exists before serving a passkey, and never treats "has a password" as a mode
 * the owner is in.
 *
 * Two properties the module holds on to:
 *
 *   - **The last active passkey cannot be removed while it is the only way
 *     in.** Removing it would lock the owner out of their own installation
 *     with no path back except the recovery kit — a support call they cannot
 *     make. The check lives in the same transaction as the removal, so a
 *     concurrent removal of two credentials cannot pass it twice.
 *   - **Removal is a state change, not a delete.** A revoked credential stays
 *     as the record of a decision, and the audit trail refers to its id.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import {
  authorizedDevices,
  owners,
  passkeyCredentials,
  passwordCredentialVersions,
} from "../../schema/security/index.ts";
import { SecurityRepositoryError } from "./repository-types.ts";
import { runSecurityTransaction } from "./transaction.ts";

type Executor = Database | Transaction;

/**
 * The single owner's id, or `null` before bootstrap commits one.
 *
 * Read rather than assumed: password login has no other way to know whose
 * credential to check, and the singleton index guarantees at most one row, so
 * "the first" and "the only" are the same thing.
 */
export async function readOwnerId(executor: Executor): Promise<string | null> {
  const rows = await executor.select({ id: owners.id }).from(owners).limit(1);
  return rows[0]?.id ?? null;
}

export interface PasskeyCredentialRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
  readonly label: string | null;
  readonly state: "pending" | "active" | "revoked";
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

type PasskeyRow = typeof passkeyCredentials.$inferSelect;

function toPasskey(row: PasskeyRow): PasskeyCredentialRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    credentialId: row.credentialId,
    publicKey: row.publicKey,
    signCount: Number(row.signCount),
    label: row.label,
    state: row.state as PasskeyCredentialRecord["state"],
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Finds a passkey by the credential id the authenticator presented.
 *
 * Returns revoked credentials too. The caller must check state: a revoked
 * credential that silently looked absent would make "this credential was
 * revoked" and "this credential never existed" the same event in the log,
 * which is exactly the distinction an operator needs after a lost device.
 */
export async function findPasskeyByCredentialId(
  executor: Executor,
  credentialId: string,
): Promise<PasskeyCredentialRecord | null> {
  const rows = await executor
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, credentialId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toPasskey(row);
}

/** The owner-visible passkey inventory. Public keys are not selected. */
export async function listPasskeys(
  executor: Executor,
  ownerId: string,
): Promise<readonly Omit<PasskeyCredentialRecord, "publicKey">[]> {
  const rows = await executor
    .select({
      id: passkeyCredentials.id,
      ownerId: passkeyCredentials.ownerId,
      credentialId: passkeyCredentials.credentialId,
      signCount: passkeyCredentials.signCount,
      label: passkeyCredentials.label,
      state: passkeyCredentials.state,
      createdAt: passkeyCredentials.createdAt,
      lastUsedAt: passkeyCredentials.lastUsedAt,
      revokedAt: passkeyCredentials.revokedAt,
    })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.ownerId, ownerId))
    .orderBy(sql`${passkeyCredentials.createdAt} DESC`);
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    credentialId: row.credentialId,
    signCount: Number(row.signCount),
    label: row.label,
    state: row.state as PasskeyCredentialRecord["state"],
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  }));
}

export interface EnrollPasskeyInput {
  readonly id: string;
  readonly ownerId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
  readonly label: string | null;
  readonly now: Date;
}

export async function enrollPasskey(tx: Transaction, input: EnrollPasskeyInput): Promise<void> {
  await tx.insert(passkeyCredentials).values({
    id: input.id,
    ownerId: input.ownerId,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    signCount: input.signCount,
    label: input.label,
    // Active immediately: the ceremony that produced it is the proof, and a
    // pending credential the owner cannot use would look like a failure.
    state: "active",
    createdAt: input.now,
  });
}

/** Advances the sign count and records use, after a verified assertion. */
export async function recordPasskeyUse(
  executor: Executor,
  input: { credentialId: string; signCount: number; now: Date },
): Promise<void> {
  await executor
    .update(passkeyCredentials)
    .set({ signCount: input.signCount, lastUsedAt: input.now })
    .where(eq(passkeyCredentials.credentialId, input.credentialId));
}

export class LastCredentialError extends SecurityRepositoryError {
  constructor() {
    super("conflict", "the last usable sign-in credential cannot be removed");
    this.name = "LastCredentialError";
  }
}

/**
 * Removes a passkey, refusing when it is the last way in.
 *
 * "Last way in" counts a set password as a way in: an owner with one passkey
 * and a password may remove the passkey, because they can still sign in. An
 * owner with one passkey and no password may not, because they could not.
 *
 * The count and the update are in one serializable transaction. Two concurrent
 * removals that each saw two active credentials would otherwise both pass the
 * check and leave zero.
 */
export async function revokePasskey(
  db: Database,
  input: { ownerId: string; credentialId: string; now: Date },
): Promise<{ removed: boolean }> {
  return await runSecurityTransaction(db, async (tx) => {
    const rows = await tx
      .select()
      .from(passkeyCredentials)
      .where(
        and(eq(passkeyCredentials.ownerId, input.ownerId), eq(passkeyCredentials.state, "active")),
      );
    const target = rows.find((row) => row.credentialId === input.credentialId);
    if (target === undefined) {
      // Already gone, or never here, or another owner's. One answer for all
      // three: distinguishing them would confirm a credential id exists.
      return { removed: false };
    }
    if (rows.length === 1 && !(await hasActivePassword(tx, input.ownerId))) {
      throw new LastCredentialError();
    }
    await tx
      .update(passkeyCredentials)
      .set({ state: "revoked", revokedAt: input.now })
      .where(eq(passkeyCredentials.id, target.id));
    return { removed: true };
  });
}

export async function renamePasskey(
  executor: Executor,
  input: { ownerId: string; credentialId: string; label: string },
): Promise<void> {
  await executor
    .update(passkeyCredentials)
    .set({ label: input.label })
    .where(
      and(
        eq(passkeyCredentials.ownerId, input.ownerId),
        eq(passkeyCredentials.credentialId, input.credentialId),
      ),
    );
}

// ---------------------------------------------------------------------------
// The password alternative
// ---------------------------------------------------------------------------

export interface PasswordVersionRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly passwordHash: string;
  readonly hashAlgorithm: string;
  readonly createdAt: Date;
}

export async function findActivePassword(
  executor: Executor,
  ownerId: string,
): Promise<PasswordVersionRecord | null> {
  const rows = await executor
    .select()
    .from(passwordCredentialVersions)
    .where(
      and(
        eq(passwordCredentialVersions.ownerId, ownerId),
        eq(passwordCredentialVersions.state, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        ownerId: row.ownerId,
        passwordHash: row.passwordHash,
        hashAlgorithm: row.hashAlgorithm,
        createdAt: row.createdAt,
      };
}

export async function hasActivePassword(executor: Executor, ownerId: string): Promise<boolean> {
  return (await findActivePassword(executor, ownerId)) !== null;
}

export interface SetPasswordInput {
  readonly id: string;
  readonly ownerId: string;
  readonly passwordHash: string;
  readonly hashAlgorithm: string;
  readonly hashParameters: Record<string, unknown>;
  readonly now: Date;
}

/**
 * Sets or replaces the password.
 *
 * The previous version is superseded, not deleted, and both writes happen in
 * one transaction — the partial unique index permits exactly one active
 * version per owner, so doing it in two steps would either violate the index
 * or leave a window with no password at all.
 */
export async function setPassword(db: Database, input: SetPasswordInput): Promise<void> {
  await runSecurityTransaction(db, async (tx) => {
    await tx
      .update(passwordCredentialVersions)
      .set({ state: "superseded", supersededAt: input.now })
      .where(
        and(
          eq(passwordCredentialVersions.ownerId, input.ownerId),
          eq(passwordCredentialVersions.state, "active"),
        ),
      );
    await tx.insert(passwordCredentialVersions).values({
      id: input.id,
      ownerId: input.ownerId,
      passwordHash: input.passwordHash,
      hashAlgorithm: input.hashAlgorithm,
      hashParameters: input.hashParameters,
      state: "active",
      createdAt: input.now,
    });
  });
}

// ---------------------------------------------------------------------------
// Devices, as far as authentication needs them
// ---------------------------------------------------------------------------

/**
 * Finds the device a session would be bound to.
 *
 * Authentication needs only this much of the device inventory: enough to
 * refuse a revoked device, and an id to bind the session to. The full
 * inventory belongs to the device feature.
 */
export async function findAuthorizedDevice(
  executor: Executor,
  input: { ownerId: string; deviceBindingId: string },
): Promise<{ id: string; state: string } | null> {
  const rows = await executor
    .select({ id: authorizedDevices.id, state: authorizedDevices.state })
    .from(authorizedDevices)
    .where(
      and(
        eq(authorizedDevices.ownerId, input.ownerId),
        eq(authorizedDevices.deviceBindingId, input.deviceBindingId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The owner's first device, used when a sign-in presents no known binding. */
export async function findAnyAuthorizedDevice(
  executor: Executor,
  ownerId: string,
): Promise<{ id: string; state: string } | null> {
  const rows = await executor
    .select({ id: authorizedDevices.id, state: authorizedDevices.state })
    .from(authorizedDevices)
    .where(and(eq(authorizedDevices.ownerId, ownerId), eq(authorizedDevices.state, "active")))
    .orderBy(sql`${authorizedDevices.authorizedAt} ASC`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Records real authenticated activity. Never called by a read or a rename.
 *
 * A synchronization counts as activity as well: a device that synced was
 * reachable and in use, and leaving `lastActivityAt` behind would show it as
 * dormant in the very inventory meant to surface dormant devices. The reverse
 * does not hold — being active is not synchronizing — so plain activity leaves
 * `lastSyncAt` alone.
 */
export async function recordDeviceActivity(
  executor: Executor,
  input: { deviceId: string; now: Date; kind?: "activity" | "sync" },
): Promise<void> {
  await executor
    .update(authorizedDevices)
    .set(
      input.kind === "sync"
        ? { lastSyncAt: input.now, lastActivityAt: input.now }
        : { lastActivityAt: input.now },
    )
    .where(eq(authorizedDevices.id, input.deviceId));
}
