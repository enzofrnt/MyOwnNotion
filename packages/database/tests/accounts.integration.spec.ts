/**
 * Accounts, invitations and account deletion (feature 058).
 *
 * The races that matter are settled by the database, so they are tested
 * against it with independent connections: two first launches, two sign-ups
 * for the last use of a link. Deletion is tested for what it must remove and
 * for what it must leave alone — another account's rows.
 */

import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  consumeInvitation,
  createAccountRecords,
  createInstallation,
  type DatabaseHandle,
  digestInvitationSecret,
  findAccountByEmail,
  insertInvitation,
  invitationState,
  promoteAdministrator,
  purgeAccountWorkspace,
  readCounts,
  revokeInvitation,
  runSecurityTransaction,
} from "../src/index.ts";
import {
  createSecurityIntegrationContext,
  runConcurrently,
  type SecurityIntegrationContext,
} from "./helpers/security-db.ts";

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";

let context: SecurityIntegrationContext;

beforeAll(async () => {
  context = await createSecurityIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

beforeEach(async () => {
  await context.handle.db.execute(sql`
    UPDATE installations SET state = 'uninitialized', administrator_id = NULL;
    DELETE FROM invitations;
    DELETE FROM sessions;
    DELETE FROM authorized_devices;
    DELETE FROM password_credential_versions;
    DELETE FROM owners;
    DELETE FROM placements;
    DELETE FROM revisions;
    DELETE FROM items;
    DELETE FROM mutations;
    DELETE FROM installations;
  `);
  await createInstallation(context.handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

function records(input: { email: string; now?: Date; role?: "administrator" | "member" }) {
  const id = generateUuidV7();
  return {
    id,
    installationId: INSTALLATION_ID,
    workspaceId: generateUuidV7(),
    workspaceSchemaVersion: 1,
    email: input.email,
    pseudonym: "Someone",
    role: input.role ?? ("member" as const),
    origin: "administrator" as const,
    passwordCredentialId: generateUuidV7(),
    passwordHash: "scrypt$fixture",
    hashAlgorithm: "scrypt",
    now: input.now ?? new Date(),
  };
}

async function promote(handle: DatabaseHandle, email: string): Promise<void> {
  await runSecurityTransaction(handle.db, async (tx) => {
    await promoteAdministrator(tx, {
      ...records({ email }),
      establishKeys: async () => {},
    });
  });
}

describe("first launch", () => {
  it("lets exactly one of two concurrent first launches become administrator", async () => {
    const results = await runConcurrently(context.postgres.connectionString, [
      (handle) => promote(handle, "first@example.test"),
      (handle) => promote(handle, "second@example.test"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 1, workspaceCount: 1 });
    const installation = await context.handle.db.execute<{ state: string }>(
      sql`SELECT state FROM installations`,
    );
    expect(installation.rows[0]?.state).toBe("ready");
  });

  it("refuses a first launch once an administrator exists", async () => {
    await promote(context.handle, "admin@example.test");
    await expect(promote(context.handle, "late@example.test")).rejects.toThrow(
      /already_initialized/,
    );
  });
});

describe("accounts", () => {
  it("treats emails case-insensitively and refuses a second account for one", async () => {
    await promote(context.handle, "Admin@Example.test");
    expect((await findAccountByEmail(context.handle.db, " admin@example.TEST "))?.role).toBe(
      "administrator",
    );
    await expect(
      runSecurityTransaction(context.handle.db, async (tx) => {
        await createAccountRecords(tx, records({ email: "ADMIN@example.test" }));
      }),
    ).rejects.toThrow(/email_unavailable/);
  });
});

describe("invitations", () => {
  async function invitation(input: { maxUses?: number | null; expiresAt?: Date | null } = {}) {
    await promote(context.handle, "admin@example.test");
    const admin = await findAccountByEmail(context.handle.db, "admin@example.test");
    const secret = `secret-${generateUuidV7()}`;
    const created = await insertInvitation(context.handle.db, {
      id: generateUuidV7(),
      installationId: INSTALLATION_ID,
      secretHash: digestInvitationSecret(secret),
      label: null,
      maxUses: input.maxUses === undefined ? 1 : input.maxUses,
      expiresAt: input.expiresAt ?? null,
      createdById: admin?.id as string,
      now: new Date(Date.now() - 1000),
    });
    return { secret, created };
  }

  const consume = (handle: DatabaseHandle, secret: string) =>
    runSecurityTransaction(handle.db, async (tx) => {
      const consumed = await consumeInvitation(tx, {
        secretHash: digestInvitationSecret(secret),
        now: new Date(),
      });
      if (consumed === null) throw new Error("invitation_unavailable");
      return consumed;
    });

  it("lets at most one of two concurrent sign-ups take the last use", async () => {
    const { secret } = await invitation({ maxUses: 1 });
    const results = await runConcurrently(context.postgres.connectionString, [
      (handle) => consume(handle, secret),
      (handle) => consume(handle, secret),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const count = await context.handle.db.execute<{ use_count: number }>(
      sql`SELECT use_count FROM invitations`,
    );
    expect(count.rows[0]?.use_count).toBe(1);
  });

  it("answers unknown, revoked, expired and exhausted links identically", async () => {
    const { secret, created } = await invitation({ maxUses: 2 });
    await expect(consume(context.handle, "not-a-link")).rejects.toThrow("invitation_unavailable");
    await consume(context.handle, secret);
    await revokeInvitation(context.handle.db, { invitationId: created.id, now: new Date() });
    await expect(consume(context.handle, secret)).rejects.toThrow("invitation_unavailable");
    expect(invitationState({ ...created, revokedAt: new Date() }, new Date())).toBe("revoked");
    expect(invitationState({ ...created, expiresAt: new Date(0) }, new Date())).toBe("expired");
    expect(invitationState({ ...created, useCount: 2 }, new Date())).toBe("exhausted");
    expect(invitationState(created, new Date())).toBe("active");
  });
});

describe("account deletion", () => {
  it("removes the member's workspace content and leaves the other account intact", async () => {
    await promote(context.handle, "admin@example.test");
    const member = records({ email: "member@example.test" });
    await runSecurityTransaction(context.handle.db, async (tx) => {
      await createAccountRecords(tx, member);
    });
    const admin = await findAccountByEmail(context.handle.db, "admin@example.test");
    // One mutation and one item in each workspace.
    for (const workspaceId of [member.workspaceId, admin?.workspaceId as string]) {
      const mutationId = generateUuidV7();
      const itemId = generateUuidV7();
      const revisionId = generateUuidV7();
      await context.handle.db.transaction(async (tx) => {
        await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
        await tx.execute(sql`
          INSERT INTO mutations (id, workspace_id, command_type, status, accepted_at, result_revision_ids)
          VALUES (${mutationId}::uuid, ${workspaceId}::uuid, 'item.create', 'accepted', now(),
                  ARRAY[${revisionId}::uuid])`);
        await tx.execute(sql`
          INSERT INTO items (id, workspace_id, kind, name, current_revision_id)
          VALUES (${itemId}::uuid, ${workspaceId}::uuid, 'page', 'Note', ${revisionId}::uuid)`);
        await tx.execute(sql`
          INSERT INTO revisions (id, item_id, mutation_id, lineage_digest)
          VALUES (${revisionId}::uuid, ${itemId}::uuid, ${mutationId}::uuid, 'digest')`);
      });
    }

    await runSecurityTransaction(context.handle.db, async (tx) => {
      await purgeAccountWorkspace(tx, { accountId: member.id, workspaceId: member.workspaceId });
    });

    const remaining = await context.handle.db.execute<{ workspace_id: string }>(
      sql`SELECT workspace_id FROM items`,
    );
    expect(remaining.rows.map((row) => row.workspace_id)).toEqual([admin?.workspaceId]);
    expect(await findAccountByEmail(context.handle.db, "member@example.test")).toBeNull();
    expect(await findAccountByEmail(context.handle.db, "admin@example.test")).not.toBeNull();
  });

  it("never deletes the administrator", async () => {
    await promote(context.handle, "admin@example.test");
    const admin = await findAccountByEmail(context.handle.db, "admin@example.test");
    await runSecurityTransaction(context.handle.db, async (tx) => {
      await purgeAccountWorkspace(tx, {
        accountId: admin?.id as string,
        workspaceId: admin?.workspaceId as string,
      });
    }).catch(() => undefined);
    expect(await findAccountByEmail(context.handle.db, "admin@example.test")).not.toBeNull();
  });
});
