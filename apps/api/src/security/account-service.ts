/**
 * Account lifecycle (feature 058).
 *
 * One place creates accounts, whoever asks: the first launch (administrator),
 * the administrator for someone else, an invitation link, or open sign-up.
 * Every path commits the workspace, the account, its password, its first
 * device (when signing in) and the workspace's key hierarchy in a single
 * transaction, so an account never exists half-made.
 *
 * Refusals are deliberately coarse. A sign-up through a link that is unknown,
 * revoked, expired or used up gets one answer; an email already taken gets
 * one answer whatever account holds it.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { BrowserDeviceClaimDto, RegistrationModeDto } from "@myownnotion/contracts";
import {
  type AccountRecord,
  CANONICAL_SCHEMA_VERSION,
  consumeInvitation,
  createAccountRecords,
  type Database,
  digestInvitationSecret,
  findAccountById,
  findInstallation,
  type InvitationRecord,
  insertInvitation,
  invitationState,
  listAccounts,
  listInvitations,
  promoteAdministrator,
  purgeAccountWorkspace,
  revokeInvitation,
  runSecurityTransaction,
  SecurityRepositoryError,
  setAccountDisabled,
  setPassword,
  setRegistrationMode,
  type Transaction,
  updateAccountProfile,
} from "@myownnotion/database";
import { sql } from "drizzle-orm";
import type { AuditService } from "./audit-service.ts";
import { buildPasswordVersion, hashPassword } from "./password-service.ts";
import type { IssuedSession, SessionService } from "./session-service.ts";

export class AccountRefusedError extends Error {
  constructor(
    readonly code:
      | "already_initialized"
      | "registration_closed"
      | "invitation_unavailable"
      | "email_unavailable"
      | "not_found"
      | "conflict",
  ) {
    super(code);
    this.name = "AccountRefusedError";
  }
}

export interface AccountServiceDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly audit: AuditService;
  readonly sessions: SessionService;
  readonly now: () => Date;
  /** Establishes the key hierarchy of a fresh workspace inside `tx`. */
  readonly establishKeys: (tx: Transaction, workspaceId: string) => Promise<void>;
  /** Called after commit, so the API can start the new workspace's services. */
  readonly onAccountCreated?: (account: { id: string; workspaceId: string }) => void;
  /** Called after an account is disabled or deleted, to close its live channels. */
  readonly onAccountRevoked?: (account: { id: string; workspaceId: string }) => void;
}

export interface NewAccountInput {
  readonly email: string;
  readonly pseudonym: string;
  readonly password: string;
  readonly correlationId: string;
}

export interface SignedInAccount {
  readonly account: AccountRecord;
  readonly issued: IssuedSession;
}

function translate(error: unknown): never {
  if (error instanceof SecurityRepositoryError && error.code === "conflict") {
    if (error.message === "email_unavailable") throw new AccountRefusedError("email_unavailable");
    if (error.message === "already_initialized")
      throw new AccountRefusedError("already_initialized");
  }
  throw error;
}

/** 32 random bytes, base64url: the part of an invitation URL after `#`. */
export function newInvitationSecret(): string {
  return randomBytes(32).toString("base64url");
}

export class AccountService {
  readonly #deps: AccountServiceDeps;

  constructor(deps: AccountServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Serializable, with bounded retries: an account's own requests keep
   * touching its session rows while the administrator acts on it, and a
   * serialization conflict there is a reason to retry, not to refuse.
   */
  async #transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return await runSecurityTransaction(this.#deps.db, work, { maxAttempts: 4 });
  }

  #audit(correlationId: string, workspaceId?: string, ownerId?: string) {
    return {
      installationId: this.#deps.installationId,
      correlationId,
      actorClass: "owner" as const,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(ownerId === undefined ? {} : { ownerId }),
    };
  }

  async #create(
    input: NewAccountInput & {
      readonly role: "administrator" | "member";
      readonly origin: "bootstrap" | "administrator" | "invitation" | "open";
      readonly device?: BrowserDeviceClaimDto;
      readonly createdById?: string;
      readonly invitationSecret?: string;
      readonly registrationModes?: readonly RegistrationModeDto[];
    },
  ): Promise<{ account: AccountRecord; deviceId: string | null }> {
    const now = this.#deps.now();
    const id = randomUUID();
    const workspaceId = randomUUID();
    // Hash before the transaction: scrypt is slow, and holding a serializable
    // transaction open across it would make concurrent sign-ups conflict.
    const hashed = await hashPassword(input.password);
    const deviceId = input.device === undefined ? null : randomUUID();
    const records = {
      id,
      installationId: this.#deps.installationId,
      workspaceId,
      workspaceSchemaVersion: CANONICAL_SCHEMA_VERSION,
      email: input.email,
      pseudonym: input.pseudonym,
      role: input.role,
      origin: input.origin,
      createdById: input.createdById ?? null,
      passwordCredentialId: randomUUID(),
      passwordHash: hashed.encoded,
      hashAlgorithm: hashed.algorithm,
      hashParameters: hashed.parameters,
      ...(input.device === undefined || deviceId === null
        ? {}
        : {
            device: {
              id: deviceId,
              bindingId: input.device.deviceBindingId,
              name: input.device.name,
              platform: input.device.platform,
            },
          }),
      now,
    };

    try {
      await this.#transaction(async (tx) => {
        if (input.origin === "bootstrap") {
          await promoteAdministrator(tx, {
            ...records,
            establishKeys: async (inner) => await this.#deps.establishKeys(inner, workspaceId),
          });
        } else {
          const installation = await findInstallation(tx);
          if (installation === null || installation.state !== "ready")
            throw new AccountRefusedError("registration_closed");
          if (
            input.registrationModes !== undefined &&
            !input.registrationModes.includes(installation.registrationMode)
          )
            throw new AccountRefusedError(
              installation.registrationMode === "closed" || input.origin === "open"
                ? "registration_closed"
                : "invitation_unavailable",
            );
          let invitationId: string | null = null;
          if (input.origin === "invitation") {
            const consumed =
              input.invitationSecret === undefined
                ? null
                : await consumeInvitation(tx, {
                    secretHash: digestInvitationSecret(input.invitationSecret),
                    now,
                  });
            if (consumed === null) throw new AccountRefusedError("invitation_unavailable");
            invitationId = consumed.id;
          }
          await createAccountRecords(tx, { ...records, invitationId });
          await this.#deps.establishKeys(tx, workspaceId);
          if (invitationId !== null) {
            await this.#deps.audit.recordInTransaction(
              tx,
              this.#audit(input.correlationId, undefined, id),
              {
                eventType: "invitation.used",
                outcome: "success",
                objectKind: "invitation",
                objectId: invitationId,
              },
            );
          }
        }
        await this.#deps.audit.recordInTransaction(
          tx,
          this.#audit(input.correlationId, workspaceId, id),
          {
            eventType: "account.created",
            outcome: "success",
            objectKind: "account",
            objectId: id,
            metadata: { origin: input.origin },
          },
        );
      });
    } catch (error) {
      translate(error);
    }

    const account = await findAccountById(this.#deps.db, id);
    if (account === null) throw new SecurityRepositoryError("internal_error", "account vanished");
    this.#deps.onAccountCreated?.({ id, workspaceId });
    return { account, deviceId };
  }

  async #signIn(
    created: { account: AccountRecord; deviceId: string | null },
    correlationId: string,
  ): Promise<SignedInAccount> {
    if (created.deviceId === null)
      throw new SecurityRepositoryError("internal_error", "sign-in requires a device");
    const issued = await this.#deps.sessions.issue({
      ownerId: created.account.id,
      deviceId: created.deviceId,
      authMethod: "password",
      correlationId,
    });
    return { account: created.account, issued };
  }

  /** First launch: creates the administrator and signs them in. */
  async bootstrap(
    input: NewAccountInput & { readonly device: BrowserDeviceClaimDto },
  ): Promise<SignedInAccount> {
    const created = await this.#create({ ...input, role: "administrator", origin: "bootstrap" });
    return await this.#signIn(created, input.correlationId);
  }

  /** Self-service sign-up, through a link or in open mode. */
  async signup(
    input: NewAccountInput & {
      readonly device: BrowserDeviceClaimDto;
      readonly invitation?: string;
    },
  ): Promise<SignedInAccount> {
    const viaInvitation = input.invitation !== undefined;
    const created = await this.#create({
      ...input,
      role: "member",
      origin: viaInvitation ? "invitation" : "open",
      ...(viaInvitation ? { invitationSecret: input.invitation } : {}),
      // A link works only in invitation mode; open sign-up only in open mode.
      registrationModes: viaInvitation ? ["invitation"] : ["open"],
    });
    return await this.#signIn(created, input.correlationId);
  }

  /** The administrator creates an account for someone; nobody is signed in. */
  async createByAdministrator(
    input: NewAccountInput & { readonly administratorId: string },
  ): Promise<AccountRecord> {
    const created = await this.#create({
      ...input,
      role: "member",
      origin: "administrator",
      createdById: input.administratorId,
    });
    return created.account;
  }

  async list(): Promise<readonly AccountRecord[]> {
    return await listAccounts(this.#deps.db);
  }

  async #requireMember(accountId: string): Promise<AccountRecord> {
    const account = await findAccountById(this.#deps.db, accountId);
    if (account === null) throw new AccountRefusedError("not_found");
    if (account.role === "administrator") throw new AccountRefusedError("conflict");
    return account;
  }

  async setDisabled(input: {
    readonly accountId: string;
    readonly disabled: boolean;
    readonly correlationId: string;
  }): Promise<void> {
    const account = await this.#requireMember(input.accountId);
    const now = this.#deps.now();
    await this.#transaction(async (tx) => {
      const changed = await setAccountDisabled(tx, {
        accountId: account.id,
        disabled: input.disabled,
        now,
      });
      if (!changed) return;
      if (input.disabled) {
        // Sessions end now, not at their next sliding refresh.
        await tx.execute(sqlRevokeSessions(account.id, now));
      }
      await this.#deps.audit.recordInTransaction(
        tx,
        this.#audit(input.correlationId, account.workspaceId, account.id),
        {
          eventType: input.disabled ? "account.disabled" : "account.enabled",
          outcome: "success",
          objectKind: "account",
          objectId: account.id,
        },
      );
    });
    if (input.disabled) this.#deps.onAccountRevoked?.(account);
  }

  async resetPassword(input: {
    readonly accountId: string;
    readonly password: string;
    readonly correlationId: string;
  }): Promise<void> {
    const account = await this.#requireMember(input.accountId);
    const now = this.#deps.now();
    const version = await buildPasswordVersion({
      ownerId: account.id,
      password: input.password,
      now,
    });
    await setPassword(this.#deps.db, {
      id: version.id,
      ownerId: version.ownerId,
      passwordHash: version.passwordHash,
      hashAlgorithm: version.hashAlgorithm,
      hashParameters: version.hashParameters,
      now: version.createdAt,
    });
    await this.#transaction(async (tx) => {
      await tx.execute(sqlRevokeSessions(account.id, now));
      await this.#deps.audit.recordInTransaction(
        tx,
        this.#audit(input.correlationId, account.workspaceId, account.id),
        {
          eventType: "account.password-reset",
          outcome: "success",
          objectKind: "account",
          objectId: account.id,
        },
      );
    });
    this.#deps.onAccountRevoked?.(account);
  }

  async delete(input: {
    readonly accountId: string;
    readonly confirmEmail: string;
    readonly correlationId: string;
  }): Promise<void> {
    const account = await this.#requireMember(input.accountId);
    if (account.email.trim().toLowerCase() !== input.confirmEmail.trim().toLowerCase())
      throw new AccountRefusedError("conflict");
    // Channels first, so nothing writes into the workspace while it is purged.
    this.#deps.onAccountRevoked?.(account);
    await this.#transaction(async (tx) => {
      await purgeAccountWorkspace(tx, { accountId: account.id, workspaceId: account.workspaceId });
      await this.#deps.audit.recordInTransaction(
        tx,
        this.#audit(input.correlationId, undefined, undefined),
        {
          eventType: "account.deleted",
          outcome: "success",
          objectKind: "account",
          objectId: account.id,
        },
      );
    });
  }

  async updateProfile(input: {
    readonly accountId: string;
    readonly email?: string;
    readonly pseudonym?: string;
    readonly correlationId: string;
  }): Promise<AccountRecord> {
    try {
      await updateAccountProfile(this.#deps.db, {
        accountId: input.accountId,
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.pseudonym === undefined ? {} : { pseudonym: input.pseudonym }),
      });
    } catch (error) {
      translate(error);
    }
    await this.#deps.audit.record(this.#audit(input.correlationId, undefined, input.accountId), {
      eventType: "account.updated",
      outcome: "success",
      objectKind: "account",
      objectId: input.accountId,
    });
    const account = await findAccountById(this.#deps.db, input.accountId);
    if (account === null) throw new AccountRefusedError("not_found");
    return account;
  }

  // -------------------------------------------------------------------------
  // Registration settings and invitations
  // -------------------------------------------------------------------------

  async setRegistrationMode(mode: RegistrationModeDto, correlationId: string): Promise<void> {
    await this.#transaction(async (tx) => {
      await setRegistrationMode(tx, { installationId: this.#deps.installationId, mode });
      await this.#deps.audit.recordInTransaction(tx, this.#audit(correlationId), {
        eventType: "registration.mode-changed",
        outcome: "success",
        metadata: { mode },
      });
    });
  }

  async createInvitation(input: {
    readonly administratorId: string;
    readonly label?: string;
    readonly maxUses?: number;
    readonly expiresInDays?: number;
    readonly correlationId: string;
  }): Promise<{ invitation: InvitationRecord; secret: string }> {
    const now = this.#deps.now();
    const secret = newInvitationSecret();
    const invitation = await this.#transaction(async (tx) => {
      const created = await insertInvitation(tx, {
        id: randomUUID(),
        installationId: this.#deps.installationId,
        secretHash: digestInvitationSecret(secret),
        label: input.label?.trim() || null,
        maxUses: input.maxUses ?? null,
        expiresAt:
          input.expiresInDays === undefined
            ? null
            : new Date(now.getTime() + input.expiresInDays * 86_400_000),
        createdById: input.administratorId,
        now,
      });
      // The secret is never in the trail; the id is.
      await this.#deps.audit.recordInTransaction(tx, this.#audit(input.correlationId), {
        eventType: "invitation.created",
        outcome: "success",
        objectKind: "invitation",
        objectId: created.id,
      });
      return created;
    });
    return { invitation, secret };
  }

  async listInvitations(): Promise<
    readonly (InvitationRecord & {
      readonly state: ReturnType<typeof invitationState>;
      readonly accounts: readonly AccountRecord[];
    })[]
  > {
    const now = this.#deps.now();
    const [invitations, accounts] = await Promise.all([
      listInvitations(this.#deps.db),
      listAccounts(this.#deps.db),
    ]);
    return invitations.map((invitation) => ({
      ...invitation,
      state: invitationState(invitation, now),
      accounts: accounts.filter((account) => account.invitationId === invitation.id),
    }));
  }

  async revokeInvitation(invitationId: string, correlationId: string): Promise<void> {
    const revoked = await revokeInvitation(this.#deps.db, {
      invitationId,
      now: this.#deps.now(),
    });
    if (revoked)
      await this.#deps.audit.record(this.#audit(correlationId), {
        eventType: "invitation.revoked",
        outcome: "success",
        objectKind: "invitation",
        objectId: invitationId,
      });
  }
}

function sqlRevokeSessions(ownerId: string, now: Date) {
  return sql`UPDATE sessions SET state = 'revoked', revoked_at = ${now}
             WHERE owner_id = ${ownerId} AND state = 'active'`;
}
