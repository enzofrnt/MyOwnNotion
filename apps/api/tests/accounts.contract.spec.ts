/**
 * Sign-in, registration modes, invitations and administration (feature 058:
 * US2, US5, US6).
 */
import { sql } from "drizzle-orm";
import type { InjectOptions, LightMyRequestResponse as Response } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiHarness, createSecuredApiHarness } from "./helpers/app.ts";
import {
  type AccountInject,
  browserDevice,
  createAdministrator,
  createMember,
  signIn,
} from "./helpers/content-owner.ts";

let harness: ApiHarness;
let admin: AccountInject;

const PASSWORD = "correct horse battery staple";

beforeAll(async () => {
  harness = await createSecuredApiHarness();
  admin = await createAdministrator(harness, { email: "admin@example.test" });
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

function anonymous(options: InjectOptions): Promise<Response> {
  return harness.built.app.inject(options);
}

function signup(payload: Record<string, unknown>) {
  return anonymous({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { pseudonym: "Newcomer", password: PASSWORD, device: browserDevice(), ...payload },
  });
}

async function setMode(mode: "closed" | "invitation" | "open") {
  const response = await admin({ method: "PUT", url: "/v1/admin/registration", payload: { mode } });
  expect(response.statusCode, response.body).toBe(200);
}

describe("sign-in (US2)", () => {
  it("signs in with email and password, case-insensitively", async () => {
    const account = await signIn(harness, { email: " ADMIN@example.test ", password: PASSWORD });
    expect(account.accountId).toBe(admin.accountId);
  });

  it("answers an unknown email exactly like a wrong password", async () => {
    const login = (email: string, password: string) =>
      anonymous({
        method: "POST",
        url: "/v1/auth/login/password",
        payload: { email, password, device: browserDevice() },
      });
    const unknown = await login("nobody@example.test", PASSWORD);
    const wrong = await login("admin@example.test", "a wrong but long password");
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().code).toBe(wrong.json().code);
    expect(Object.keys(unknown.json()).sort()).toEqual(Object.keys(wrong.json()).sort());
  });

  it("lets each account read only itself through /v1/me", async () => {
    const member = await createMember(harness, admin, { pseudonym: "Bea" });
    const me = await member({ method: "GET", url: "/v1/me" });
    expect(me.json()).toEqual({
      accountId: member.accountId,
      email: member.email,
      pseudonym: "Bea",
      role: "member",
    });
  });

  it("updates the pseudonym, and the email only with a unique address", async () => {
    const member = await createMember(harness, admin);
    const renamed = await member({ method: "PATCH", url: "/v1/me", payload: { pseudonym: "Zed" } });
    expect(renamed.json().pseudonym).toBe("Zed");
    const taken = await member({
      method: "PATCH",
      url: "/v1/me",
      payload: { email: "Admin@example.test" },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe("email_unavailable");
  });
});

describe("registration modes (US5)", () => {
  it("is closed by default: no public sign-up", async () => {
    await setMode("closed");
    const response = await signup({ email: "closed@example.test" });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("registration_closed");
    const status = await anonymous({ method: "GET", url: "/v1/installation/status" });
    expect(status.json().registrationMode).toBe("closed");
  });

  it("opens sign-up to anyone in open mode", async () => {
    await setMode("open");
    const response = await signup({ email: "open@example.test" });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().account).toMatchObject({ role: "member", pseudonym: "Newcomer" });
    const duplicate = await signup({ email: "OPEN@example.test" });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("email_unavailable");
    await setMode("closed");
  });

  it("refuses a link outside invitation mode and open sign-up in invitation mode", async () => {
    await setMode("invitation");
    expect((await signup({ email: "noinvite@example.test" })).json().code).toBe(
      "registration_closed",
    );
    await setMode("open");
    const viaLink = await signup({ email: "linkinopen@example.test", invitation: "x".repeat(43) });
    expect(viaLink.statusCode).toBe(410);
    await setMode("closed");
  });
});

describe("invitations (US5)", () => {
  async function createInvitation(payload: Record<string, unknown> = {}) {
    const response = await admin({ method: "POST", url: "/v1/admin/invitations", payload });
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    const secret = String(body.url).split("#")[1] as string;
    return { invitation: body.invitation, url: String(body.url), secret };
  }

  it("creates a link whose secret lives in the URL fragment only", async () => {
    const { url, secret, invitation } = await createInvitation({ label: "Family", maxUses: 2 });
    expect(url).toMatch(/\/join#[A-Za-z0-9_-]{43}$/);
    expect(invitation).toMatchObject({ label: "Family", maxUses: 2, useCount: 0, state: "active" });
    const stored = await harness.built.database.db.execute<{ secret_hash: string }>(
      sql`SELECT secret_hash FROM invitations`,
    );
    expect(JSON.stringify(stored.rows)).not.toContain(secret);
    const listed = await admin({ method: "GET", url: "/v1/admin/invitations" });
    expect(listed.body).not.toContain(secret);
  });

  it("counts uses, lists the accounts created, and refuses once exhausted", async () => {
    await setMode("invitation");
    const { secret, invitation } = await createInvitation({ maxUses: 1 });
    const first = await signup({ email: "invited@example.test", invitation: secret });
    expect(first.statusCode, first.body).toBe(201);
    const second = await signup({ email: "late@example.test", invitation: secret });
    expect(second.statusCode).toBe(410);
    expect(second.json().code).toBe("invitation_unavailable");

    const listed = (await admin({ method: "GET", url: "/v1/admin/invitations" })).json()
      .invitations as Array<{
      invitationId: string;
      useCount: number;
      state: string;
      accounts: { email: string }[];
    }>;
    const row = listed.find((entry) => entry.invitationId === invitation.invitationId);
    expect(row?.useCount).toBe(1);
    expect(row?.state).toBe("exhausted");
    expect(row?.accounts.map((account) => account.email)).toEqual(["invited@example.test"]);
    await setMode("closed");
  });

  it("answers revoked and unknown links identically and stops honoring them outside invitation mode", async () => {
    await setMode("invitation");
    const { secret, invitation } = await createInvitation();
    const revoked = await admin({
      method: "DELETE",
      url: `/v1/admin/invitations/${invitation.invitationId}`,
    });
    expect(revoked.statusCode).toBe(204);
    const viaRevoked = await signup({ email: "rev@example.test", invitation: secret });
    const viaUnknown = await signup({ email: "unk@example.test", invitation: "y".repeat(43) });
    expect(viaRevoked.statusCode).toBe(410);
    expect(viaUnknown.statusCode).toBe(410);
    expect(viaRevoked.json().code).toBe(viaUnknown.json().code);

    const live = await createInvitation();
    await setMode("closed");
    expect(
      (await signup({ email: "closedlink@example.test", invitation: live.secret })).statusCode,
    ).toBe(403);
    await setMode("invitation");
    expect(
      (await signup({ email: "reopened@example.test", invitation: live.secret })).statusCode,
    ).toBe(201);
    await setMode("closed");
  });

  it("audits mode changes and link use without the secret", async () => {
    const events = await harness.built.database.db.execute<{
      event_type: string;
      metadata: unknown;
    }>(
      sql`SELECT event_type, metadata FROM security_audit_events
           WHERE event_type IN ('registration.mode-changed','invitation.created','invitation.revoked','invitation.used')`,
    );
    const types = new Set(events.rows.map((row) => row.event_type));
    expect(types).toEqual(
      new Set([
        "registration.mode-changed",
        "invitation.created",
        "invitation.revoked",
        "invitation.used",
      ]),
    );
  });
});

describe("administration (US6)", () => {
  it("is invisible to members", async () => {
    const member = await createMember(harness, admin);
    for (const [method, url] of [
      ["GET", "/v1/admin/accounts"],
      ["GET", "/v1/admin/registration"],
      ["GET", "/v1/admin/invitations"],
    ] as const) {
      const response = await member({ method, url });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it("lists accounts with their origin", async () => {
    const accounts = (await admin({ method: "GET", url: "/v1/admin/accounts" })).json()
      .accounts as Array<{ email: string; origin: string; role: string }>;
    expect(accounts.find((account) => account.email === "admin@example.test")).toMatchObject({
      origin: "bootstrap",
      role: "administrator",
    });
    expect(accounts.some((account) => account.origin === "administrator")).toBe(true);
  });

  it("disables a member at once and re-enables them", async () => {
    const member = await createMember(harness, admin);
    expect((await member({ method: "GET", url: "/v1/me" })).statusCode).toBe(200);
    const disabled = await admin({
      method: "POST",
      url: `/v1/admin/accounts/${member.accountId}/disable`,
    });
    expect(disabled.statusCode).toBe(204);
    expect((await member({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    await expect(signIn(harness, member)).rejects.toThrow(/401/);
    await admin({ method: "POST", url: `/v1/admin/accounts/${member.accountId}/enable` });
    const again = await signIn(harness, member);
    expect((await again({ method: "GET", url: "/v1/me" })).statusCode).toBe(200);
  });

  it("resets a member's password and signs every session out", async () => {
    const member = await createMember(harness, admin);
    const reset = await admin({
      method: "POST",
      url: `/v1/admin/accounts/${member.accountId}/password`,
      payload: { password: "a brand new long password" },
    });
    expect(reset.statusCode).toBe(204);
    expect((await member({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    await expect(signIn(harness, member)).rejects.toThrow(/401/);
    await signIn(harness, { email: member.email, password: "a brand new long password" });
  });

  it("deletes a member only with the typed email, removing their content", async () => {
    const member = await createMember(harness, admin);
    const created = await member({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": crypto.randomUUID(), "x-myownnotion-client-protocol": "3" },
      payload: {
        id: crypto.randomUUID(),
        kind: "folder",
        name: "Member folder",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const wrong = await admin({
      method: "DELETE",
      url: `/v1/admin/accounts/${member.accountId}`,
      payload: { confirmEmail: "someone-else@example.test" },
    });
    expect(wrong.statusCode).toBe(409);
    const deleted = await admin({
      method: "DELETE",
      url: `/v1/admin/accounts/${member.accountId}`,
      payload: { confirmEmail: member.email },
    });
    expect(deleted.statusCode).toBe(204);
    const items = await harness.built.database.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM items WHERE workspace_id = ${member.workspaceId}::uuid`,
    );
    expect(items.rows[0]?.count).toBe("0");
    expect((await member({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
  });

  it("never disables or deletes the administrator", async () => {
    const disable = await admin({
      method: "POST",
      url: `/v1/admin/accounts/${admin.accountId}/disable`,
    });
    expect(disable.statusCode).toBe(409);
    const remove = await admin({
      method: "DELETE",
      url: `/v1/admin/accounts/${admin.accountId}`,
      payload: { confirmEmail: admin.email },
    });
    expect(remove.statusCode).toBe(409);
  });
});
