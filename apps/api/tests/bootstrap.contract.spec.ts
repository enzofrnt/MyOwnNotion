/**
 * First launch (feature 058, US1).
 *
 * One form creates the administrator — email, pseudonym, password — signs them
 * in, and makes the installation ready. Once that has happened, the bootstrap
 * route refuses everyone, and two simultaneous first launches produce exactly
 * one administrator.
 */
import { createInstallation, readCounts } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type ApiHarness, createSecuredApiHarness } from "./helpers/app.ts";
import { browserDevice } from "./helpers/content-owner.ts";

let harness: ApiHarness;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";

beforeAll(async () => {
  harness = await createSecuredApiHarness();
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.built.database.db.execute(sql`
    UPDATE installations SET state = 'uninitialized', administrator_id = NULL;
    TRUNCATE security_audit_events, security_rate_limits, data_key_generations,
      workspace_root_keys, sessions, authorized_devices, password_credential_versions,
      passkey_credentials, invitations, owners, installations CASCADE
  `);
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

function bootstrap(overrides: Record<string, unknown> = {}) {
  return harness.built.app.inject({
    method: "POST",
    url: "/v1/bootstrap",
    payload: {
      email: "Admin@Example.test",
      pseudonym: "Admin",
      password: "correct horse battery staple",
      device: browserDevice(),
      ...overrides,
    },
  });
}

describe("first launch", () => {
  it("reports an uninitialized installation with no registration mode", async () => {
    const status = await harness.built.app.inject({
      method: "GET",
      url: "/v1/installation/status",
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      state: "uninitialized",
      ownerCount: 0,
      workspaceCount: 0,
    });
    expect(status.json()).not.toHaveProperty("registrationMode");
  });

  it("creates the administrator, signs them in and makes the installation ready", async () => {
    const response = await bootstrap();
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.account).toMatchObject({
      email: "Admin@Example.test",
      pseudonym: "Admin",
      role: "administrator",
    });
    expect(body.csrfToken).toEqual(expect.any(String));
    expect(response.headers["set-cookie"]).toBeDefined();
    // The password is accepted and never returned.
    expect(response.body).not.toContain("correct horse");

    const status = await harness.built.app.inject({
      method: "GET",
      url: "/v1/installation/status",
    });
    expect(status.json()).toMatchObject({
      state: "ready",
      ownerCount: 1,
      workspaceCount: 1,
      registrationMode: "closed",
    });

    const cookie = String(response.headers["set-cookie"]).split(";")[0] as string;
    const me = await harness.built.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie },
    });
    expect(me.json()).toMatchObject({ role: "administrator", pseudonym: "Admin" });
  });

  it("refuses a second first launch once an administrator exists", async () => {
    expect((await bootstrap()).statusCode).toBe(201);
    const second = await bootstrap({ email: "intruder@example.test" });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("already_initialized");
    expect(await readCounts(harness.built.database.db)).toEqual({
      ownerCount: 1,
      workspaceCount: 1,
    });
  });

  it("lets exactly one of two simultaneous first launches win", async () => {
    const [first, second] = await Promise.all([
      bootstrap({ email: "first@example.test" }),
      bootstrap({ email: "second@example.test" }),
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes[0]).toBe(201);
    expect(codes[1]).toBeGreaterThanOrEqual(409);
    expect(await readCounts(harness.built.database.db)).toEqual({
      ownerCount: 1,
      workspaceCount: 1,
    });
  });

  it("validates the form and creates nothing on a refusal", async () => {
    for (const overrides of [{ email: "not-an-email" }, { pseudonym: "" }, { password: "short" }]) {
      const response = await bootstrap(overrides);
      expect(response.statusCode, JSON.stringify(overrides)).toBe(400);
    }
    expect(await readCounts(harness.built.database.db)).toEqual({
      ownerCount: 0,
      workspaceCount: 0,
    });
  });

  it("records the creation in the administrator's audit trail without the password", async () => {
    await bootstrap();
    const events = await harness.built.database.db.execute<{
      event_type: string;
      metadata: unknown;
    }>(
      sql`SELECT event_type, metadata FROM security_audit_events WHERE event_type = 'account.created'`,
    );
    expect(events.rows).toHaveLength(1);
    expect(JSON.stringify(events.rows)).not.toContain("correct horse");
    expect(events.rows[0]?.metadata).toEqual({ origin: "bootstrap" });
  });
});
