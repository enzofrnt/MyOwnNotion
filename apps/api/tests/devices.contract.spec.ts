/**
 * Device routes over HTTP (T069, US3, FR-008 – FR-010, FR-023).
 *
 * The device list is the screen an owner opens when they think someone else
 * has access, so these tests are about that moment rather than about CRUD:
 *
 *   - can an unauthenticated caller learn anything at all?
 *   - can a caller discover which device ids exist?
 *   - does revoking require a fresh proof, the way "sign out everywhere else"
 *     does — and does renaming avoid demanding one, so owners do not learn to
 *     approve prompts without reading them?
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallation } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/security/password-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";
const DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000cc";
const OTHER_DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000dd";
const PASSWORD = "correct horse battery staple";
const COOKIE = "mn_dev_session";
const CSRF_HEADER = "x-csrf-token";

const BASE_TIME = new Date("2026-05-01T00:00:00.000Z");
const clock = { value: BASE_TIME };

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-devices-key-"));
  const keyFile = path.join(keyDirectory, "deployment-key");
  writeFileSync(keyFile, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
    now: () => clock.value,
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  clock.value = BASE_TIME;
  await harness.built.database.db.execute(sql`
    TRUNCATE security_audit_events, security_rate_limits, recovery_kits, recovery_epochs,
      data_key_generations, sessions, authorized_devices, pending_bootstrap_credentials,
      bootstrap_attempts, password_credential_versions, passkey_credentials, owners,
      installations CASCADE
  `);
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  await seedOwner();
});

async function seedOwner(): Promise<void> {
  const db = harness.built.database.db;
  const [workspace] = await db
    .execute(sql`SELECT id FROM workspaces LIMIT 1`)
    .then((result) => (result as unknown as { rows: { id: string }[] }).rows ?? []);
  await db.execute(
    sql`INSERT INTO owners (id, installation_id, state) VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')`,
  );
  await db.execute(
    sql`UPDATE installations SET state = 'ready', owner_id = ${OWNER_ID}::uuid, workspace_id = ${workspace?.id}::uuid`,
  );
  await db.execute(sql`
    INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, platform, state)
    VALUES (${DEVICE_ID}::uuid, ${OWNER_ID}::uuid,
              'web-39a88270-225f-4ec4-9548-aebfa39fb55e', 'Laptop', 'macOS', 'active'),
           (${OTHER_DEVICE_ID}::uuid, ${OWNER_ID}::uuid, 'binding-2', 'Phone', NULL, 'active')
  `);
  const hashed = await hashPassword(PASSWORD);
  await db.execute(sql`
    INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
    VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${hashed.encoded}, 'scrypt', 'active')
  `);
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  const match = /mn_dev_session=([^;]*)/.exec(String(value ?? ""));
  return match?.[1] ?? "";
}

async function authenticate(): Promise<{ cookie: string; csrf: string }> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/auth/login/password",
    payload: {
      password: PASSWORD,
      device: {
        deviceBindingId: "web-39a88270-225f-4ec4-9548-aebfa39fb55e",
        name: "Laptop",
        platform: "macOS",
      },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: cookieFrom(response), csrf: response.json().csrfToken as string };
}

function authHeaders(auth: { cookie: string; csrf: string }): Record<string, string> {
  return { cookie: `${COOKIE}=${auth.cookie}`, [CSRF_HEADER]: auth.csrf };
}

describe("who may see the inventory", () => {
  it("refuses an unauthenticated caller", async () => {
    const response = await harness.built.app.inject({ method: "GET", url: "/v1/devices" });
    expect(response.statusCode).toBeGreaterThanOrEqual(401);
    // And says nothing about the devices in the refusal.
    expect(response.body).not.toContain("Laptop");
  });

  it("lists the owner's devices once authenticated", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: authHeaders(auth),
    });
    expect(response.statusCode, response.body).toBe(200);
    const { devices } = response.json() as { devices: { name: string }[] };
    // Two seeded, plus the one the login just bound.
    expect(devices.map((device) => device.name)).toContain("Laptop");
    expect(devices.map((device) => device.name)).toContain("Phone");
  });

  it("never returns a device binding identifier", async () => {
    // It is how a device proves it is itself. An inventory response is the
    // easiest place for it to leak, and nothing in the client needs it.
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: authHeaders(auth),
    });
    expect(response.body).not.toContain("binding-1");
    expect(response.body).not.toContain("binding-2");
  });

  it("reports a never-used device as null rather than omitting the field", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/devices/${OTHER_DEVICE_ID}`,
      headers: authHeaders(auth),
    });
    expect(response.statusCode, response.body).toBe(200);
    const device = response.json() as Record<string, unknown>;
    expect(device).toHaveProperty("lastActivityAt");
    expect(device["lastActivityAt"]).toBeNull();
    expect(device["lastSyncAt"]).toBeNull();
  });
});

describe("what a caller can discover", () => {
  it("answers not-found for an id that does not exist", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/devices/${randomUUID()}`,
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBe(404);
  });

  it("cannot be given another owner to enumerate across", async () => {
    // Worth asserting rather than assuming: the inventory filters by owner id,
    // but in this system a second owner cannot exist at all. FR-001 makes the
    // installation single-owner, and the database enforces it — so the only
    // remaining case is an id that does not exist, covered above.
    await expect(
      harness.built.database.db.execute(sql`
        INSERT INTO owners (id, installation_id, state)
        VALUES (${randomUUID()}::uuid, ${INSTALLATION_ID}::uuid, 'active')
      `),
    ).rejects.toThrow();
  });
});

describe("editing without a fresh prompt", () => {
  it("renames with CSRF alone", async () => {
    // Deliberately not requiring recent authentication: a passkey prompt to
    // fix a typo teaches owners to approve prompts without reading them, and
    // that habit is what the recency requirement on revocation relies on.
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/devices/${DEVICE_ID}`,
      headers: authHeaders(auth),
      payload: { name: "Work laptop" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as { name: string }).name).toBe("Work laptop");
  });

  it("refuses a rename without the CSRF header", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/devices/${DEVICE_ID}`,
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
      payload: { name: "No token" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("refuses an empty update", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/devices/${DEVICE_ID}`,
      headers: authHeaders(auth),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("revoking needs a fresh proof", () => {
  it("revokes right after signing in", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/devices/${OTHER_DEVICE_ID}/revoke`,
      headers: authHeaders(auth),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as { state: string }).state).toBe("revoked");
  });

  it("refuses once the authentication is no longer recent", async () => {
    // The control an attacker holding a stolen session would reach for. A
    // fresh proof costs the owner one prompt and costs the attacker the
    // attack.
    const auth = await authenticate();
    clock.value = new Date(BASE_TIME.getTime() + 24 * 60 * 60_000);
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/devices/${OTHER_DEVICE_ID}/revoke`,
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("refuses to act on an already revoked device", async () => {
    const auth = await authenticate();
    await harness.built.app.inject({
      method: "POST",
      url: `/v1/devices/${OTHER_DEVICE_ID}/revoke`,
      headers: authHeaders(auth),
    });
    const again = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/devices/${OTHER_DEVICE_ID}`,
      headers: authHeaders(auth),
      payload: { name: "Resurrected" },
    });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("reauthorization is not revocation", () => {
  it("flags the device without cutting it off", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/devices/${OTHER_DEVICE_ID}/reauthorize`,
      headers: authHeaders(auth),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as { state: string }).state).toBe("reauthorization-required");

    // Still editable, unlike a revoked device.
    const renamed = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/devices/${OTHER_DEVICE_ID}`,
      headers: authHeaders(auth),
      payload: { name: "Still mine" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
  });
});

describe("the two timestamps are part of every answer", () => {
  /** Every field the contract marks required, so a missing one fails loudly. */
  const REQUIRED = [
    "deviceId",
    "name",
    "platform",
    "clientType",
    "authorizedAt",
    "lastActivityAt",
    "lastSyncAt",
    "state",
    "localStorageLimitBytes",
    "localUsageBytes",
  ] as const;

  it("returns them from the inventory", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: authHeaders(auth),
    });
    const { devices } = response.json() as { devices: Record<string, unknown>[] };
    for (const device of devices) {
      for (const field of REQUIRED) {
        expect(Object.keys(device)).toContain(field);
      }
    }
  });

  it("returns them from a rename", async () => {
    // Not just from the list. A mutation that answered without them would let
    // a client refresh its state into a shape where "never used" is missing
    // rather than null.
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/devices/${DEVICE_ID}`,
      headers: authHeaders(auth),
      payload: { name: "Renamed" },
    });
    const device = response.json() as Record<string, unknown>;
    for (const field of REQUIRED) {
      expect(Object.keys(device)).toContain(field);
    }
  });

  it("returns them from a revocation", async () => {
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/devices/${OTHER_DEVICE_ID}/revoke`,
      headers: authHeaders(auth),
    });
    const device = response.json() as Record<string, unknown>;
    for (const field of REQUIRED) {
      expect(Object.keys(device)).toContain(field);
    }
  });

  it("maps the snake_case columns onto the camelCase fields", async () => {
    // The one mapping worth asserting end to end: a device with a real
    // activity instant in the database must surface it as `lastActivityAt`,
    // and a null `last_sync_at` must stay null rather than borrowing it.
    const activity = "2026-04-02T03:04:05.000Z";
    await harness.built.database.db.execute(sql`
      UPDATE authorized_devices SET last_activity_at = ${activity}::timestamptz
      WHERE id = ${OTHER_DEVICE_ID}::uuid
    `);

    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/devices/${OTHER_DEVICE_ID}`,
      headers: authHeaders(auth),
    });
    const device = response.json() as { lastActivityAt: string | null; lastSyncAt: string | null };
    expect(device.lastActivityAt).toBe(activity);
    expect(device.lastSyncAt).toBeNull();
  });

  it("populates each field only from its own event", async () => {
    // A synchronization sets both, because syncing is activity. Activity
    // alone must not set `lastSyncAt` — a device that never synced would then
    // look as though it had, and the owner would stop wondering why.
    const sync = "2026-04-03T00:00:00.000Z";
    await harness.built.database.db.execute(sql`
      UPDATE authorized_devices
      SET last_sync_at = ${sync}::timestamptz, last_activity_at = ${sync}::timestamptz
      WHERE id = ${OTHER_DEVICE_ID}::uuid
    `);

    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/devices/${OTHER_DEVICE_ID}`,
      headers: authHeaders(auth),
    });
    const device = response.json() as { lastActivityAt: string | null; lastSyncAt: string | null };
    expect(device.lastSyncAt).toBe(sync);
    expect(device.lastActivityAt).toBe(sync);
  });
});
