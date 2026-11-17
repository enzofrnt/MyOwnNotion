/**
 * Accounts and invitations (feature 058).
 *
 * An account is an `owners` row: the owner of exactly one workspace. The
 * database carries the invariants that matter for isolation and races —
 * unique normalized email, one workspace per account, one administrator, and
 * an invitation's use count that can never exceed its limit — so concurrent
 * sign-ups fail on a constraint rather than on an application check.
 */

import { createHash } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { workspaces } from "../../schema/index.ts";
import {
  authorizedDevices,
  installations,
  invitations,
  owners,
  passwordCredentialVersions,
} from "../../schema/security/index.ts";
import { isUniqueViolation, SecurityRepositoryError } from "./repository-types.ts";

type Executor = Database | Transaction;

export type AccountRole = "administrator" | "member";
export type AccountOrigin = "bootstrap" | "administrator" | "invitation" | "open";
export type AccountState = "active" | "disabled" | "recovery-required";

export interface AccountRecord {
  readonly id: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly email: string;
  readonly pseudonym: string;
  readonly role: AccountRole;
  readonly origin: AccountOrigin;
  readonly state: AccountState;
  readonly invitationId: string | null;
  readonly createdById: string | null;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
}

/** Trimmed and lower-cased; the one form used for uniqueness and sign-in. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAccount(row: typeof owners.$inferSelect): AccountRecord {
  return {
    id: row.id,
    installationId: row.installationId,
    workspaceId: row.workspaceId,
    email: row.email,
    pseudonym: row.pseudonym,
    role: row.role as AccountRole,
    origin: row.origin as AccountOrigin,
    state: row.state as AccountState,
    invitationId: row.invitationId,
    createdById: row.createdById,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
  };
}

export interface InsertAccountInput {
  readonly id: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly email: string;
  readonly pseudonym: string;
  readonly role: AccountRole;
  readonly origin: AccountOrigin;
  readonly state?: AccountState;
  readonly invitationId?: string | null;
  readonly createdById?: string | null;
  /** When the workspace row does not exist yet, create it with this version. */
  readonly workspaceSchemaVersion?: number;
}

/**
 * Inserts the account and, when asked, its fresh workspace.
 *
 * A duplicate email surfaces as `conflict` with a stable message so the route
 * can answer `email_unavailable` without parsing constraint names.
 */
export async function insertAccount(tx: Transaction, input: InsertAccountInput): Promise<void> {
  if (input.workspaceSchemaVersion !== undefined) {
    const existing = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (existing[0] === undefined) {
      await tx
        .insert(workspaces)
        .values({ id: input.workspaceId, schemaVersion: input.workspaceSchemaVersion });
    }
  }
  try {
    await tx.insert(owners).values({
      id: input.id,
      installationId: input.installationId,
      workspaceId: input.workspaceId,
      email: input.email.trim(),
      emailNormalized: normalizeEmail(input.email),
      pseudonym: input.pseudonym.trim(),
      role: input.role,
      origin: input.origin,
      state: input.state ?? "active",
      invitationId: input.invitationId ?? null,
      createdById: input.createdById ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error, "owners_email_unique")) {
      throw new SecurityRepositoryError("conflict", "email_unavailable", { cause: error });
    }
    throw error;
  }
}

export async function findAccountById(
  executor: Executor,
  accountId: string,
): Promise<AccountRecord | null> {
  const rows = await executor.select().from(owners).where(eq(owners.id, accountId)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toAccount(row);
}

export async function findAccountByEmail(
  executor: Executor,
  email: string,
): Promise<AccountRecord | null> {
  const rows = await executor
    .select()
    .from(owners)
    .where(eq(owners.emailNormalized, normalizeEmail(email)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toAccount(row);
}

export async function findAccountByWorkspace(
  executor: Executor,
  workspaceId: string,
): Promise<AccountRecord | null> {
  const rows = await executor
    .select()
    .from(owners)
    .where(eq(owners.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toAccount(row);
}

export async function listAccounts(executor: Executor): Promise<readonly AccountRecord[]> {
  const rows = await executor.select().from(owners).orderBy(asc(owners.createdAt), asc(owners.id));
  return rows.map(toAccount);
}

/** Every workspace that belongs to an account, for installation-wide jobs. */
export async function listAccountWorkspaceIds(executor: Executor): Promise<readonly string[]> {
  const rows = await executor
    .select({ workspaceId: owners.workspaceId })
    .from(owners)
    .orderBy(asc(owners.createdAt));
  return rows.map((row) => row.workspaceId);
}

export async function updateAccountProfile(
  executor: Executor,
  input: { readonly accountId: string; readonly email?: string; readonly pseudonym?: string },
): Promise<void> {
  const changes: Partial<typeof owners.$inferInsert> = {};
  if (input.email !== undefined) {
    changes.email = input.email.trim();
    changes.emailNormalized = normalizeEmail(input.email);
  }
  if (input.pseudonym !== undefined) changes.pseudonym = input.pseudonym.trim();
  if (Object.keys(changes).length === 0) return;
  try {
    await executor.update(owners).set(changes).where(eq(owners.id, input.accountId));
  } catch (error) {
    if (isUniqueViolation(error, "owners_email_unique")) {
      throw new SecurityRepositoryError("conflict", "email_unavailable", { cause: error });
    }
    throw error;
  }
}

/** Disables or re-enables a member. The administrator is never matched. */
export async function setAccountDisabled(
  executor: Executor,
  input: { readonly accountId: string; readonly disabled: boolean; readonly now: Date },
): Promise<boolean> {
  const updated = await executor
    .update(owners)
    .set(
      input.disabled
        ? { state: "disabled", disabledAt: input.now }
        : { state: "active", disabledAt: null },
    )
    .where(
      and(
        eq(owners.id, input.accountId),
        eq(owners.role, "member"),
        input.disabled ? eq(owners.state, "active") : eq(owners.state, "disabled"),
      ),
    )
    .returning({ id: owners.id });
  return updated.length > 0;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type InvitationState = "active" | "revoked" | "expired" | "exhausted";

export interface InvitationRecord {
  readonly id: string;
  readonly label: string | null;
  readonly maxUses: number | null;
  readonly useCount: number;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdById: string;
  readonly createdAt: Date;
}

/** Revoked beats expired beats exhausted: the strongest reason wins. */
export function invitationState(invitation: InvitationRecord, now: Date): InvitationState {
  if (invitation.revokedAt !== null) return "revoked";
  if (invitation.expiresAt !== null && invitation.expiresAt.getTime() <= now.getTime())
    return "expired";
  if (invitation.maxUses !== null && invitation.useCount >= invitation.maxUses) return "exhausted";
  return "active";
}

export function digestInvitationSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function toInvitation(row: typeof invitations.$inferSelect): InvitationRecord {
  return {
    id: row.id,
    label: row.label,
    maxUses: row.maxUses,
    useCount: row.useCount,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdById: row.createdById,
    createdAt: row.createdAt,
  };
}

export async function insertInvitation(
  executor: Executor,
  input: {
    readonly id: string;
    readonly installationId: string;
    readonly secretHash: string;
    readonly label: string | null;
    readonly maxUses: number | null;
    readonly expiresAt: Date | null;
    readonly createdById: string;
    readonly now: Date;
  },
): Promise<InvitationRecord> {
  const [row] = await executor
    .insert(invitations)
    .values({
      id: input.id,
      installationId: input.installationId,
      secretHash: input.secretHash,
      label: input.label,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt,
      createdById: input.createdById,
      createdAt: input.now,
    })
    .returning();
  if (row === undefined) throw new SecurityRepositoryError("internal_error", "invitation insert");
  return toInvitation(row);
}

export async function listInvitations(executor: Executor): Promise<readonly InvitationRecord[]> {
  const rows = await executor
    .select()
    .from(invitations)
    .orderBy(asc(invitations.createdAt), asc(invitations.id));
  return rows.map(toInvitation);
}

export async function revokeInvitation(
  executor: Executor,
  input: { readonly invitationId: string; readonly now: Date },
): Promise<boolean> {
  const updated = await executor
    .update(invitations)
    .set({ revokedAt: input.now })
    .where(and(eq(invitations.id, input.invitationId), isNull(invitations.revokedAt)))
    .returning({ id: invitations.id });
  return updated.length > 0;
}

/**
 * Consumes one use of a link, or returns null.
 *
 * A single conditional UPDATE: two sign-ups racing for the last use both
 * evaluate the predicate against the committed row, and the second sees the
 * incremented count and matches nothing. Unknown, revoked, expired and
 * exhausted links all return null — the caller must not tell them apart.
 */
export async function consumeInvitation(
  tx: Transaction,
  input: { readonly secretHash: string; readonly now: Date },
): Promise<InvitationRecord | null> {
  const updated = await tx
    .update(invitations)
    .set({ useCount: sql`${invitations.useCount} + 1` })
    .where(
      and(
        eq(invitations.secretHash, input.secretHash),
        isNull(invitations.revokedAt),
        sql`(${invitations.expiresAt} IS NULL OR ${invitations.expiresAt} > ${input.now})`,
        sql`(${invitations.maxUses} IS NULL OR ${invitations.useCount} < ${invitations.maxUses})`,
      ),
    )
    .returning();
  const row = updated[0];
  return row === undefined ? null : toInvitation(row);
}

// ---------------------------------------------------------------------------
// Account creation with its first credentials
// ---------------------------------------------------------------------------

export interface NewAccountDevice {
  readonly id: string;
  readonly bindingId: string;
  readonly name: string;
  readonly platform: string | null;
}

export interface CreateAccountRecordsInput extends InsertAccountInput {
  readonly workspaceSchemaVersion: number;
  readonly passwordCredentialId: string;
  readonly passwordHash: string;
  readonly hashAlgorithm: string;
  readonly hashParameters?: Record<string, unknown>;
  /** The device the new account signs in from; absent when an administrator creates it. */
  readonly device?: NewAccountDevice;
  readonly now: Date;
}

/**
 * Workspace, account, password and (optionally) the first device, in the
 * caller's transaction. The key hierarchy of the new workspace is established
 * by the caller in the same transaction, so an account never exists without
 * keys nor keys without an account.
 */
export async function createAccountRecords(
  tx: Transaction,
  input: CreateAccountRecordsInput,
): Promise<void> {
  await insertAccount(tx, input);
  await tx.insert(passwordCredentialVersions).values({
    id: input.passwordCredentialId,
    ownerId: input.id,
    passwordHash: input.passwordHash,
    hashAlgorithm: input.hashAlgorithm,
    hashParameters: input.hashParameters ?? {},
    state: "active",
    createdAt: input.now,
  });
  if (input.device !== undefined) {
    await tx.insert(authorizedDevices).values({
      id: input.device.id,
      ownerId: input.id,
      deviceBindingId: input.device.bindingId,
      name: input.device.name,
      platform: input.device.platform,
      clientType: "web",
      state: "active",
      authorizedAt: input.now,
      lastActivityAt: null,
      lastSyncAt: null,
    });
  }
}

/**
 * Commits the first-launch administrator and makes the installation ready.
 *
 * Serialized on the installation row: of two concurrent first launches, the
 * second finds the installation initialized and receives `conflict`; the
 * single-administrator index is the backstop if anything ever bypassed the
 * lock.
 */
export async function promoteAdministrator(
  tx: Transaction,
  input: CreateAccountRecordsInput & {
    readonly establishKeys: (tx: Transaction) => Promise<void>;
  },
): Promise<void> {
  const locked = await tx
    .select({ state: installations.state, administratorId: installations.administratorId })
    .from(installations)
    .where(eq(installations.id, input.installationId))
    .for("update");
  const installation = locked[0];
  if (installation === undefined) {
    throw new SecurityRepositoryError("installation_not_ready", "no installation row exists");
  }
  if (installation.administratorId !== null || installation.state !== "uninitialized") {
    throw new SecurityRepositoryError("conflict", "already_initialized");
  }
  try {
    await createAccountRecords(tx, { ...input, role: "administrator", origin: "bootstrap" });
  } catch (error) {
    if (isUniqueViolation(error, "owners_single_administrator")) {
      throw new SecurityRepositoryError("conflict", "already_initialized", { cause: error });
    }
    throw error;
  }
  await input.establishKeys(tx);
  await tx
    .update(installations)
    .set({ state: "ready", administratorId: input.id, updatedAt: input.now })
    .where(eq(installations.id, input.installationId));
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

/**
 * Removes an account and everything its workspace holds, in the caller's
 * transaction. Children before parents, in the order the foreign keys
 * require; `items.current_revision_id` is deferred, so revisions can go
 * before the items that point at them.
 *
 * The `workspaces` row itself is kept as an empty tombstone: pending
 * protected-file garbage rows still name it, and the cleanup job needs them
 * to reclaim the blobs on disk. Nothing else references it any more, and no
 * account can ever be bound to it again (`owners_workspace_unique` is moot
 * because new accounts always get a fresh workspace id).
 *
 * Audit events survive with their account reference cleared (`ON DELETE SET
 * NULL`): the administrator keeps the trail of what happened.
 */
export async function purgeAccountWorkspace(
  tx: Transaction,
  input: { readonly accountId: string; readonly workspaceId: string },
): Promise<void> {
  const ws = input.workspaceId;
  const owner = input.accountId;
  const items = sql`(SELECT id FROM items WHERE workspace_id = ${ws})`;
  const statements = [
    sql`DELETE FROM mcp_exchange_tokens WHERE connection_id IN (SELECT id FROM mcp_connections WHERE workspace_id = ${ws})`,
    sql`DELETE FROM mcp_mutations WHERE connection_id IN (SELECT id FROM mcp_connections WHERE workspace_id = ${ws})`,
    sql`DELETE FROM mcp_connections WHERE workspace_id = ${ws} OR owner_id = ${owner}`,
    sql`DELETE FROM page_legacy_branch_conversions WHERE workspace_id = ${ws}`,
    sql`DELETE FROM page_ambiguities WHERE workspace_id = ${ws}`,
    sql`DELETE FROM page_operation_checkpoints WHERE workspace_id = ${ws}`,
    sql`DELETE FROM page_operation_updates WHERE workspace_id = ${ws}`,
    sql`DELETE FROM page_device_frontiers WHERE workspace_id = ${ws}`,
    sql`DELETE FROM page_operation_states WHERE workspace_id = ${ws}`,
    sql`DELETE FROM page_documents WHERE page_id IN ${items}`,
    sql`DELETE FROM database_entries WHERE workspace_id = ${ws}`,
    sql`DELETE FROM database_presentations WHERE workspace_id = ${ws}`,
    sql`DELETE FROM databases WHERE workspace_id = ${ws}`,
    sql`DELETE FROM file_usages WHERE file_item_id IN ${items} OR used_by_item_id IN ${items}`,
    // Shared, content-addressed bytes: release this workspace's references so
    // the orphan cleanup can reclaim contents nobody else uses.
    sql`UPDATE file_contents fc SET reference_count = GREATEST(0, fc.reference_count - used.n)
          FROM (SELECT content_id, count(*)::int AS n FROM logical_files
                 WHERE item_id IN ${items} GROUP BY content_id) used
         WHERE fc.id = used.content_id`,
    sql`DELETE FROM logical_files WHERE item_id IN ${items}`,
    sql`DELETE FROM protected_upload_completions WHERE workspace_id = ${ws}`,
    sql`DELETE FROM protected_upload_chunks WHERE workspace_id = ${ws}`,
    sql`DELETE FROM uploads WHERE workspace_id = ${ws}`,
    sql`DELETE FROM relationships WHERE workspace_id = ${ws}`,
    sql`DELETE FROM placements WHERE workspace_id = ${ws}`,
    sql`DELETE FROM lifecycle_events WHERE item_id IN ${items}`,
    sql`DELETE FROM changes WHERE workspace_id = ${ws}`,
    sql`DELETE FROM revision_parents WHERE revision_id IN (SELECT id FROM revisions WHERE item_id IN ${items})`,
    sql`DELETE FROM revisions WHERE item_id IN ${items}`,
    sql`DELETE FROM items WHERE workspace_id = ${ws}`,
    sql`DELETE FROM mutations WHERE workspace_id = ${ws}`,
    sql`DELETE FROM protected_envelopes WHERE workspace_id = ${ws}`,
    sql`DELETE FROM protected_blob_chunks WHERE workspace_id = ${ws}`,
    sql`DELETE FROM encryption_migrations WHERE workspace_id = ${ws}`,
    sql`DELETE FROM data_key_generations WHERE workspace_id = ${ws}`,
    sql`DELETE FROM workspace_root_keys WHERE workspace_id = ${ws}`,
    sql`DELETE FROM exports WHERE workspace_id = ${ws}`,
    sql`DELETE FROM backups WHERE workspace_id = ${ws}`,
    sql`DELETE FROM sessions WHERE owner_id = ${owner}`,
    sql`DELETE FROM authorized_devices WHERE owner_id = ${owner}`,
    sql`DELETE FROM passkey_credentials WHERE owner_id = ${owner}`,
    sql`DELETE FROM password_credential_versions WHERE owner_id = ${owner}`,
    sql`DELETE FROM owners WHERE id = ${owner} AND role = 'member'`,
  ];
  for (const statement of statements) await tx.execute(statement);
}

/** The first-launch account, or null before the installation is initialized. */
export async function findAdministrator(executor: Executor): Promise<AccountRecord | null> {
  const rows = await executor
    .select()
    .from(owners)
    .where(eq(owners.role, "administrator"))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toAccount(row);
}

/** Recovery by the host operator ends a `recovery-required` state; nothing else. */
export async function markAccountRecovered(executor: Executor, accountId: string): Promise<void> {
  await executor
    .update(owners)
    .set({ state: "active" })
    .where(and(eq(owners.id, accountId), eq(owners.state, "recovery-required")));
}
