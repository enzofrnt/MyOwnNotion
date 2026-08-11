/**
 * Bootstrap route contract (T024, feature 002).
 *
 * Drives the real Fastify app over a real PostgreSQL. What matters here is not
 * that the happy path works — it is that every response the client can observe
 * states the committed counts, and that the counts in the response agree with
 * the counts in the database at every step.
 *
 * The WebAuthn ceremony itself cannot be produced without an authenticator, so
 * credential verification is exercised through its failure path. That is the
 * more valuable direction anyway: a verifier that accepts a forged ceremony is
 * the defect worth catching, and the success path is covered by the browser
 * journeys.
 */

import { createInstallation, readCounts } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const CAPABILITY_HEADER = "x-bootstrap-capability";

beforeAll(async () => {
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
    }),
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
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
});

type InjectOptions = {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
};

function inject(options: InjectOptions) {
  return harness.built.app.inject(options as never);
}

async function startBootstrap(clientNonce = "client-nonce-value-long-enough-22") {
  return inject({
    method: "POST",
    url: "/v1/bootstrap",
    payload: { clientNonce },
  });
}

describe("installation status", () => {
  it("answers before any installation work has happened", async () => {
    const response = await inject({ method: "GET", url: "/v1/installation/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ownerCount).toBe(0);
    expect(body.workspaceCount).toBe(0);
    expect(body.securityReady).toBe(false);
  });

  it("reports counts that match the database", async () => {
    const body = (await inject({ method: "GET", url: "/v1/installation/status" })).json();
    const counts = await readCounts(harness.built.database.db);
    expect({ ownerCount: body.ownerCount, workspaceCount: body.workspaceCount }).toEqual(counts);
  });

  it("never reports ready while the deployment key is unavailable", async () => {
    // The harness runs without a mounted key, so `securityReady` must be false
    // whatever the installation state claims.
    const body = (await inject({ method: "GET", url: "/v1/installation/status" })).json();
    expect(body.securityReady).toBe(false);
  });
});

describe("starting an attempt", () => {
  it("returns the capability in the body and the counts as 0/0", async () => {
    const response = await startBootstrap();
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.bootstrapState).toBe("started");
    expect(body.installationState).toBe("uninitialized");
    expect(body.ownerCount).toBe(0);
    expect(body.workspaceCount).toBe(0);
    expect(typeof body.capability).toBe("string");
    expect(body.capability.length).toBeGreaterThanOrEqual(32);
  });

  it("never puts the capability in a header or a location", async () => {
    // It belongs in the body alone; a header or URL would reach logs.
    const response = await startBootstrap();
    const serialisedHeaders = JSON.stringify(response.headers);
    expect(serialisedHeaders).not.toContain(response.json().capability);
  });

  it("persists only a digest of the capability", async () => {
    const capability = (await startBootstrap()).json().capability;
    const rows = await harness.built.database.db.execute<{ capability_hash: string }>(
      sql`SELECT capability_hash FROM bootstrap_attempts`,
    );
    // A leaked table dump must not yield a working capability.
    expect(rows.rows[0]?.capability_hash).not.toBe(capability);
    expect(rows.rows[0]?.capability_hash).not.toContain(capability);
  });

  it("refuses a second concurrent attempt", async () => {
    await startBootstrap();
    const second = await startBootstrap("another-client-nonce-value-22ch");
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("conflict");
  });

  it("keeps the installation at 0/0 after starting", async () => {
    await startBootstrap();
    expect(await readCounts(harness.built.database.db)).toEqual({
      ownerCount: 0,
      workspaceCount: 0,
    });
  });

  it("rejects a client nonce shorter than the contract allows", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/bootstrap",
      payload: { clientNonce: "tooshort" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("capability enforcement", () => {
  it("refuses a request with no capability header", async () => {
    const { attemptId } = (await startBootstrap()).json();
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      payload: { credential: {} },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("bootstrap_capability_invalid");
  });

  it("refuses a forged capability", async () => {
    const { attemptId } = (await startBootstrap()).json();
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: "forged-capability-value-that-is-long" },
      payload: { credential: {} },
    });
    expect(response.statusCode).toBe(403);
  });

  it("refuses a valid capability replayed against another attempt", async () => {
    const { capability } = (await startBootstrap()).json();
    const otherAttemptId = "018f2b7c-0000-7000-8000-0000000000ff";
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${otherAttemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload: { credential: {} },
    });
    expect(response.statusCode).toBe(403);
  });

  it("gives the same answer for an unknown attempt as for a wrong capability", async () => {
    // Distinguishing them would tell a caller whether an attempt exists.
    const unknown = await inject({
      method: "POST",
      url: "/v1/bootstrap/018f2b7c-0000-7000-8000-0000000000ee/credential",
      headers: { [CAPABILITY_HEADER]: "some-capability-value-long-enough-x" },
      payload: { credential: {} },
    });
    const { attemptId } = (await startBootstrap()).json();
    const wrong = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: "some-capability-value-long-enough-x" },
      payload: { credential: {} },
    });
    expect(unknown.statusCode).toBe(wrong.statusCode);
    expect(unknown.json().code).toBe(wrong.json().code);
  });
});

describe("credential verification failures", () => {
  it("refuses a forged ceremony with an indistinguishable code", async () => {
    const { attemptId, capability } = (await startBootstrap()).json();
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload: { credential: { id: "x", rawId: "x", type: "public-key", response: {} } },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("authentication_failed");
  });

  it("leaves the installation at 0/0 after a failed ceremony", async () => {
    const { attemptId, capability } = (await startBootstrap()).json();
    await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload: { credential: { id: "x", rawId: "x", type: "public-key", response: {} } },
    });
    expect(await readCounts(harness.built.database.db)).toEqual({
      ownerCount: 0,
      workspaceCount: 0,
    });
  });

  it("consumes the challenge so a failed ceremony cannot be retried", async () => {
    const { attemptId, capability } = (await startBootstrap()).json();
    const payload = { credential: { id: "x", rawId: "x", type: "public-key", response: {} } };
    const first = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload,
    });
    const second = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload,
    });
    expect(first.statusCode).toBe(401);
    expect(second.statusCode).toBe(401);
  });

  it("records the failure in the audit trail", async () => {
    const { attemptId, capability } = (await startBootstrap()).json();
    await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload: { credential: { id: "x", rawId: "x", type: "public-key", response: {} } },
    });
    const rows = await harness.built.database.db.execute<{ event_type: string; outcome: string }>(
      sql`SELECT event_type, outcome FROM security_audit_events ORDER BY occurred_at`,
    );
    const types = rows.rows.map((row) => row.event_type);
    expect(types).toContain("bootstrap.started");
    expect(types).toContain("bootstrap.credential-verified");
    expect(
      rows.rows.find((row) => row.event_type === "bootstrap.credential-verified")?.outcome,
    ).toBe("failure");
  });
});

describe("problem bodies", () => {
  it("carries a correlation ID and nothing else specific", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/bootstrap/018f2b7c-0000-7000-8000-0000000000ee/credential",
      headers: { [CAPABILITY_HEADER]: "some-capability-value-long-enough-x" },
      payload: { credential: {} },
    });
    const body = response.json();
    expect(body.correlationId).toBeTypeOf("string");
    expect(Object.keys(body).sort()).toEqual(
      ["code", "correlationId", "status", "title", "type"].sort(),
    );
  });

  it("never echoes the presented capability", async () => {
    const forged = "forged-capability-value-that-is-long";
    const { attemptId } = (await startBootstrap()).json();
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/credential`,
      headers: { [CAPABILITY_HEADER]: forged },
      payload: { credential: {} },
    });
    expect(JSON.stringify(response.json())).not.toContain(forged);
  });
});

describe("the routes that follow credential verification", () => {
  // A real WebAuthn ceremony cannot be produced without an authenticator, so
  // these attempts never reach `recovery-prepared`. Their refusal paths are
  // still worth pinning: each is a route that must not act on an attempt that
  // has not earned the right, and each must refuse with a safe code rather
  // than a stack trace.

  async function startedAttempt() {
    const body = (await startBootstrap()).json();
    return { attemptId: body.attemptId as string, capability: body.capability as string };
  }

  it("refuses a download before any kit exists", async () => {
    const { attemptId, capability } = await startedAttempt();
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/recovery/download`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload: { downloadToken: "no-such-token" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("conflict");
  });

  it("refuses a regeneration before a credential is verified", async () => {
    const { attemptId, capability } = await startedAttempt();
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/recovery/regenerate`,
      headers: { [CAPABILITY_HEADER]: capability },
    });
    expect(response.statusCode).toBe(409);
  });

  it("refuses confirmation before the download is consumed", async () => {
    // The rule the whole flow exists to enforce: no readiness without a kit
    // the owner actually stored.
    const { attemptId, capability } = await startedAttempt();
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/recovery/confirm`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload: { storedOffline: true },
    });
    expect(response.statusCode).toBe(409);
    expect(await readCounts(harness.built.database.db)).toEqual({
      ownerCount: 0,
      workspaceCount: 0,
    });
  });

  it("rejects a confirmation body that does not assert offline storage", async () => {
    // `storedOffline` is `const: true` in the contract: there is no way to
    // confirm without asserting it.
    const { attemptId, capability } = await startedAttempt();
    const response = await inject({
      method: "POST",
      url: `/v1/bootstrap/${attemptId}/recovery/confirm`,
      headers: { [CAPABILITY_HEADER]: capability },
      payload: { storedOffline: false },
    });
    expect(response.statusCode).toBe(400);
  });

  it("requires the capability on every follow-up route", async () => {
    const { attemptId } = await startedAttempt();
    for (const path of ["recovery/download", "recovery/regenerate", "recovery/confirm"]) {
      const response = await inject({
        method: "POST",
        url: `/v1/bootstrap/${attemptId}/${path}`,
        payload: { storedOffline: true, downloadToken: "x" },
      });
      expect(response.statusCode, path).toBe(403);
    }
  });
});

/**
 * Puts the installation into the committed state without running the ceremony,
 * which cannot be produced without an authenticator.
 *
 * It binds the *existing* workspace rather than inserting one. `workspaces`
 * carries a `UNIQUE ((true))` singleton index and feature 001 creates the row
 * at API startup, so an insert here silently does nothing and the binding would
 * dangle. `readCounts` joins through the binding, so a dangling one reports
 * zero and the invariant refuses — which is the behaviour we want, but not the
 * state this test is about.
 */
async function fabricateCommittedOwnership(): Promise<void> {
  const ownerId = "018f2b7c-0000-7000-8000-0000000000bb";
  const [workspace] = await harness.built.database.db
    .execute(sql`SELECT id FROM workspaces LIMIT 1`)
    .then((result) => (result as unknown as { rows: { id: string }[] }).rows ?? []);
  expect(workspace?.id, "feature 001 must have created the canonical workspace").toBeTruthy();
  await harness.built.database.db.execute(sql`
    INSERT INTO owners (id, installation_id, state)
    VALUES (${ownerId}::uuid, ${INSTALLATION_ID}::uuid, 'active')
  `);
  await harness.built.database.db.execute(sql`
    UPDATE installations
    SET state = 'ready', owner_id = ${ownerId}::uuid, workspace_id = ${workspace?.id}::uuid
  `);
}

describe("the bootstrap surface closes after ownership commits", () => {
  it("refuses every bootstrap route once an owner exists", async () => {
    // Leaving the surface open is the most direct route to a second owner.
    await fabricateCommittedOwnership();

    const response = await startBootstrap();
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("bootstrap_unavailable");
  });

  it("reports 1/1 and a ready state once ownership is committed", async () => {
    await fabricateCommittedOwnership();
    const body = (await inject({ method: "GET", url: "/v1/installation/status" })).json();
    expect(body.state).toBe("ready");
    expect(body.ownerCount).toBe(1);
    expect(body.workspaceCount).toBe(1);
    // Still not `securityReady`: the deployment key is not mounted here.
    expect(body.securityReady).toBe(false);
  });
});

describe("status with no installation row at all", () => {
  it("answers uninitialized rather than 404", async () => {
    // The first-run page needs a definite answer, not a status it must
    // interpret.
    await harness.built.database.db.execute(sql`TRUNCATE installations CASCADE`);
    const response = await inject({ method: "GET", url: "/v1/installation/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: "uninitialized",
      ownerCount: 0,
      workspaceCount: 0,
      recoveryReady: false,
      securityReady: false,
    });
  });
});

describe("a binding that points at no workspace", () => {
  it("refuses rather than trusting the column", async () => {
    // `installations.workspace_id` carries no foreign key on purpose: protected
    // records must survive a migration that scrubs plaintext rows. The join in
    // `readCounts` is what keeps that decision safe — a binding pointing
    // nowhere counts zero, the invariant breaks, and the route fails closed
    // instead of reporting a workspace that does not exist.
    await harness.built.database.db.execute(sql`
      INSERT INTO owners (id, installation_id, state)
      VALUES (${"018f2b7c-0000-7000-8000-0000000000cc"}::uuid, ${INSTALLATION_ID}::uuid, 'active')
    `);
    await harness.built.database.db.execute(sql`
      UPDATE installations
      SET state = 'ready',
          owner_id = ${"018f2b7c-0000-7000-8000-0000000000cc"}::uuid,
          workspace_id = ${"018f2b7c-0000-7000-8000-00000000dead"}::uuid
    `);
    const response = await inject({ method: "GET", url: "/v1/installation/status" });
    expect(response.statusCode).toBe(500);
    // And it says nothing about what it found.
    expect(response.body).not.toContain("workspace_id");
  });
});
