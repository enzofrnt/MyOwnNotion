/**
 * Public protocol-v3 page-operation contract (T122, US5).
 *
 * These tests intentionally cross the real authentication, CSRF, protocol,
 * encryption and PostgreSQL boundaries. A sync route that only works through a
 * direct service call is not the route an offline browser will eventually use.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallation } from "@myownnotion/database";
import {
  documentDigestV3,
  generateUuidV7,
  PAGE_OPERATION_PROTOCOL_VERSION,
} from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/security/password-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  currentProtocolHeaders,
} from "./helpers/app.ts";

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";
const DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000cc";
const PASSWORD = "correct horse battery staple";
const COOKIE = "mn_dev_session";
const CSRF_HEADER = "x-csrf-token";

let harness: ApiHarness;
let keyDirectory: string;

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-page-operation-key-"));
  const keyFile = path.join(keyDirectory, "deployment-key");
  writeFileSync(keyFile, randomBytes(32).toString("base64"), {
    encoding: "utf8",
    mode: 0o600,
  });
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
    clientProtocol: "manual",
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  await harness.built.database.db.execute(sql`
    TRUNCATE page_legacy_branch_conversions, page_ambiguities, page_device_frontiers,
      page_operation_updates, page_operation_checkpoints, page_operation_states,
      security_audit_events, security_rate_limits, recovery_kits, recovery_epochs,
      data_key_generations, sessions, authorized_devices, pending_bootstrap_credentials,
      bootstrap_attempts, password_credential_versions, passkey_credentials, owners,
      installations, protected_envelopes, changes, mutations, placements,
      revision_parents, page_documents, revisions, items CASCADE
  `);
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  const workspaceId = harness.built.context.workspaceId;
  await harness.built.database.db.execute(sql`
    INSERT INTO owners (id, installation_id, state)
    VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')
  `);
  await harness.built.database.db.execute(sql`
    UPDATE installations
       SET state = 'ready', owner_id = ${OWNER_ID}::uuid, workspace_id = ${workspaceId}::uuid
     WHERE id = ${INSTALLATION_ID}::uuid
  `);
  await harness.built.database.db.execute(sql`
    INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
    VALUES (${DEVICE_ID}::uuid, ${OWNER_ID}::uuid, 'page-operation-device', 'Laptop', 'active')
  `);
  const password = await hashPassword(PASSWORD);
  await harness.built.database.db.execute(sql`
    INSERT INTO password_credential_versions
      (id, owner_id, password_hash, hash_algorithm, state)
    VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${password.encoded}, 'scrypt', 'active')
  `);
});

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  return /mn_dev_session=([^;]*)/.exec(String(value ?? ""))?.[1] ?? "";
}

async function authenticate(): Promise<Record<string, string>> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/auth/login/password",
    headers: currentProtocolHeaders(),
    payload: { password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  return {
    ...currentProtocolHeaders(),
    cookie: `${COOKIE}=${cookieFrom(response)}`,
    [CSRF_HEADER]: response.json().csrfToken as string,
  };
}

async function createLegacyPage() {
  const page = await createItemViaApi(harness, { kind: "page", name: "Offline page" });
  return {
    ...page,
    canonicalDigest: await documentDigestV3({ blocks: [] }),
  };
}

function activation(
  page: Awaited<ReturnType<typeof createLegacyPage>>,
  headers: Record<string, string>,
) {
  return harness.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${page.itemId}/activate`,
    headers,
    payload: {
      requestId: generateUuidV7(),
      expectedRevisionId: page.revisionId,
      expectedCanonicalDigest: page.canonicalDigest,
    },
  });
}

describe("page-operation route guards", () => {
  it("requires protocol 3 before interpreting an activation", async () => {
    const page = await createLegacyPage();
    const response = await activation(page, {
      "x-myownnotion-client-protocol": "2",
      "x-csrf-token": "not-read",
    });

    expect(response.statusCode).toBe(426);
    expect(response.headers["x-myownnotion-required-protocol"]).toBe(
      String(PAGE_OPERATION_PROTOCOL_VERSION),
    );
    expect(response.json()).toMatchObject({ code: "protocol.too_old" });
  });

  it("requires an authenticated active device and CSRF", async () => {
    const page = await createLegacyPage();
    const anonymous = await activation(page, currentProtocolHeaders());
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: "authentication_required" });

    const headers = await authenticate();
    const withoutCsrf = { ...headers };
    delete withoutCsrf[CSRF_HEADER];
    const refused = await activation(page, withoutCsrf);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "csrf_validation_failed" });
  });
});

describe("activation and checkpoint catch-up", () => {
  it("activates once, returns a verified checkpoint and replays idempotently", async () => {
    const page = await createLegacyPage();
    const headers = await authenticate();
    const first = await activation(page, headers);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      mode: "checkpoint",
      pageId: page.itemId,
      operationalVersion: 1,
      throughPageSequence: 0,
      latestPageSequence: 0,
      canonicalDigest: page.canonicalDigest,
      followingUpdates: [],
      hasMore: false,
      ambiguities: [],
    });
    expect(first.json().checkpointBytes).toEqual(expect.any(String));
    expect(first.json().versionVector).toEqual(expect.any(String));

    const repeated = await activation(page, headers);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().checkpointId).toBe(first.json().checkpointId);

    const catchUp = await harness.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers,
      payload: {
        mode: "empty",
        requestId: generateUuidV7(),
        knownServerPageSequence: 0,
        maxRemoteBytes: 1024 * 1024,
      },
    });
    expect(catchUp.statusCode, catchUp.body).toBe(200);
    expect(catchUp.json()).toMatchObject({
      mode: "checkpoint",
      checkpointId: first.json().checkpointId,
      pageId: page.itemId,
    });
  });

  it("refuses a stale activation without creating partial operational state", async () => {
    const page = await createLegacyPage();
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/activate`,
      headers: await authenticate(),
      payload: {
        requestId: generateUuidV7(),
        expectedRevisionId: generateUuidV7(),
        expectedCanonicalDigest: page.canonicalDigest,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "page-operations.activation-stale" });

    const rows = await harness.built.database.db.execute(sql`
      SELECT count(*)::int AS count FROM page_operation_states WHERE page_id = ${page.itemId}::uuid
    `);
    expect((rows as unknown as { rows: Array<{ count: number }> }).rows[0]?.count).toBe(0);
  });

  it("refuses a full-document replacement after activation", async () => {
    const page = await createLegacyPage();
    const headers = await authenticate();
    expect((await activation(page, headers)).statusCode).toBe(200);

    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${page.itemId}/document`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: {
        baseRevisionId: page.revisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: { blocks: [] },
        },
      },
    });
    expect(response.statusCode).toBe(426);
    expect(response.json()).toMatchObject({
      code: "page-operations.protocol-read-only",
      requiredProtocol: 3,
      readAllowed: true,
    });

    const batch = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      headers,
      payload: {
        mutations: [
          {
            mutationId: generateUuidV7(),
            commandType: "page.document.replace",
            baseRevisionIds: [page.revisionId],
            payload: {
              itemId: page.itemId,
              baseRevisionId: page.revisionId,
              document: {
                format: "myownnotion.document+json",
                formatVersion: 2,
                body: { blocks: [] },
              },
            },
          },
        ],
      },
    });
    expect(batch.statusCode, batch.body).toBe(200);
    expect(batch.json().results[0]).toMatchObject({
      status: "rejected",
      problem: { code: "page-operations.protocol-read-only" },
    });
  });

  it("accepts one incremental update, replays it once and catches another replica up", async () => {
    const page = await createLegacyPage();
    const headers = await authenticate();
    const activated = await activation(page, headers);
    expect(activated.statusCode, activated.body).toBe(200);
    const checkpoint = activated.json() as {
      checkpointBytes: string;
      checkpointDigest: string;
      versionVector: string;
    };
    const author = await OperationalPageDocument.fromSnapshotTransport({
      pageId: page.itemId,
      snapshotBytes: Buffer.from(checkpoint.checkpointBytes, "base64url"),
      snapshotDigest: checkpoint.checkpointDigest,
      versionVector: Buffer.from(checkpoint.versionVector, "base64url"),
    });
    const blockId = generateUuidV7();
    const transaction = author.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: blockId, content: [{ text: "written offline" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const updateId = generateUuidV7();
    const update = {
      updateId,
      baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
      updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
      updateDigest: await sha256Hex(transaction.updateBytes),
      createdAt: "2026-08-21T12:00:00.000Z",
    };
    const send = (requestId: string) =>
      harness.built.app.inject({
        method: "POST",
        url: `/v1/page-operations/${page.itemId}/sync`,
        headers,
        payload: {
          mode: "active",
          requestId,
          operationalVersion: 1,
          persistedVersionVector: Buffer.from(transaction.resultVersionVector).toString(
            "base64url",
          ),
          knownServerPageSequence: 0,
          updates: [update],
          maxRemoteBytes: 1024 * 1024,
        },
      });

    const accepted = await send(generateUuidV7());
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({
      mode: "active",
      pageId: page.itemId,
      accepted: [{ updateId, pageSequence: 1 }],
      repeated: [],
      latestPageSequence: 1,
      hasMore: false,
    });

    const replayed = await send(generateUuidV7());
    expect(replayed.statusCode, replayed.body).toBe(200);
    expect(replayed.json()).toMatchObject({
      accepted: [],
      repeated: [{ updateId, pageSequence: 1 }],
      latestPageSequence: 1,
    });

    const replica = await harness.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers,
      payload: {
        mode: "active",
        requestId: generateUuidV7(),
        operationalVersion: 1,
        persistedVersionVector: checkpoint.versionVector,
        knownServerPageSequence: 0,
        updates: [],
        maxRemoteBytes: 1024 * 1024,
      },
    });
    expect(replica.statusCode, replica.body).toBe(200);
    expect(replica.json()).toMatchObject({
      accepted: [],
      repeated: [],
      remoteUpdates: [{ updateId, pageSequence: 1 }],
      latestPageSequence: 1,
    });

    const item = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(item.json().pageDocument).toMatchObject({
      formatVersion: 3,
      body: { blocks: [{ id: blockId, type: "paragraph" }] },
    });
  });
});

describe("ambiguity endpoints", () => {
  it("keeps unknown ambiguity details private and non-cacheable", async () => {
    const headers = await authenticate();
    const ambiguityId = generateUuidV7();
    const detail = await harness.built.app.inject({
      method: "GET",
      url: `/v1/page-ambiguities/${ambiguityId}`,
      headers,
    });
    expect(detail.statusCode).toBe(404);
    expect(detail.headers["cache-control"]).toBe("no-store");

    const resolution = await harness.built.app.inject({
      method: "POST",
      url: `/v1/page-ambiguities/${ambiguityId}/resolve`,
      headers,
      payload: { requestId: generateUuidV7(), decision: "confirm-delete" },
    });
    expect(resolution.statusCode).toBe(404);
  });
});
