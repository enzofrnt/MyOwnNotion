/**
 * What a history entry says, and what it must never say (T039, FR-022, FR-023).
 *
 * Two requirements that pull in opposite directions. FR-022 wants the entry to
 * identify the date, the device and the nature of a change — enough for an owner
 * to recognise work they do not remember doing. FR-023 forbids recording a
 * technical secret in the clear, and a history is the worst place to leak one:
 * it is read on screen, kept indefinitely, and carried out whole in an export.
 *
 * So the assertions come in pairs. The device is named, and the thing the device
 * proves itself with is not. The nature is stated, and the session that performed
 * it is not.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallation } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/security/password-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

// The identity the app itself uses. A different one here would leave the key
// hierarchy writing wrapping keys against an installation row that does not
// exist, and every protected write would fail as an opaque 500.
const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000001a2";
const DEVICE_ID = "018f2b7c-0000-7000-8000-0000000001a3";
const DEVICE_NAME = "Kitchen laptop";
const DEVICE_BINDING = "web-39a88270-225f-4ec4-9548-aebfa39fb55e";
const PASSWORD = "correct horse battery staple";
const COOKIE = "mn_dev_session";

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-history-key-"));
  const keyFile = path.join(keyDirectory, "deployment-key");
  writeFileSync(keyFile, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
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
    VALUES (${DEVICE_ID}::uuid, ${OWNER_ID}::uuid, ${DEVICE_BINDING}, ${DEVICE_NAME}, 'macOS', 'active')
  `);
  const hashed = await hashPassword(PASSWORD);
  await db.execute(sql`
    INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
    VALUES (${randomUUID()}::uuid, ${OWNER_ID}::uuid, ${hashed.encoded}, 'scrypt', 'active')
  `);
});

interface Signed {
  readonly cookie: string;
  readonly csrf: string;
  readonly sessionId: string;
}

async function signIn(): Promise<Signed> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/auth/login/password",
    payload: {
      password: PASSWORD,
      device: {
        deviceBindingId: DEVICE_BINDING,
        name: DEVICE_NAME,
        platform: "macOS",
      },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const header = response.headers["set-cookie"];
  const raw = Array.isArray(header) ? header[0] : header;
  const cookie = /mn_dev_session=([^;]*)/.exec(String(raw ?? ""))?.[1] ?? "";
  const body = response.json() as { csrfToken: string; session?: { id?: string } };
  return { cookie, csrf: body.csrfToken, sessionId: body.session?.id ?? cookie };
}

function headersFor(signed: Signed): Record<string, string> {
  return {
    cookie: `${COOKIE}=${signed.cookie}`,
    "x-csrf-token": signed.csrf,
  };
}

async function createPageAsSignedInOwner(
  signed: Signed,
  name: string,
): Promise<{ revisionId: string }> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/items",
    headers: { ...headersFor(signed), "idempotency-key": generateUuidV7() },
    payload: {
      id: generateUuidV7(),
      kind: "page",
      name,
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return { revisionId: (response.json() as { revisionIds: string[] }).revisionIds[0] as string };
}

describe("what a history entry identifies", () => {
  it("names the date, the device and the nature of the change", async () => {
    const signed = await signIn();
    const { revisionId } = await createPageAsSignedInOwner(signed, "Attributed page");

    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/revisions/${revisionId}`,
      headers: headersFor(signed),
    });
    expect(response.statusCode, response.body).toBe(200);
    const revision = response.json() as {
      acceptedAt: string;
      authoredByDeviceId: string | null;
      authoredByDeviceName: string | null;
      changeNature: string;
    };

    expect(Date.parse(revision.acceptedAt)).not.toBeNaN();
    // The device the request was authenticated as, taken from the session rather
    // than from anything the payload said. A client-chosen author is a history
    // an owner cannot trust.
    expect(revision.authoredByDeviceId).not.toBeNull();
    // In the owner's terms. `item.create` is how the server was asked; "created"
    // is what happened, and someone reading their own history is not debugging a
    // protocol.
    expect(revision.changeNature).toBe("created");
  });

  it("records no session identifier and no device binding secret", async () => {
    const signed = await signIn();
    const { revisionId } = await createPageAsSignedInOwner(signed, "Nothing technical");

    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/revisions/${revisionId}`,
      headers: headersFor(signed),
    });
    const body = response.body;

    // The binding is how a device proves it is itself. A history is read,
    // retained and exported whole, so this is the worst place for it to appear.
    expect(body).not.toContain(DEVICE_BINDING);
    // The session cookie value is a bearer credential. Anything that showed it
    // in a history would hand out a live session to whoever read the entry.
    expect(body).not.toContain(signed.cookie);
    expect(body).not.toContain(signed.csrf);
    // And no field named for one, so a future field cannot smuggle one in under
    // a name nobody reviewed.
    const fields = Object.keys(response.json() as Record<string, unknown>);
    expect(fields.filter((field) => /session|token|secret|binding|key/i.test(field))).toEqual([]);
  });

  it("says the device is unknown rather than guessing, for an unattributed write", async () => {
    // No session: an anonymous write, which is what a revision written before
    // this feature looks like from the history's point of view.
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": generateUuidV7() },
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Unattributed",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const revisionId = (response.json() as { revisionIds: string[] }).revisionIds[0];

    const read = await harness.built.app.inject({
      method: "GET",
      url: `/v1/revisions/${revisionId}`,
    });
    const revision = read.json() as { authoredByDeviceId: string | null };
    // Null, not the only device that exists. A history that fills a gap with a
    // plausible answer is worse than one that admits the gap.
    expect(revision.authoredByDeviceId).toBeNull();
  });
});
