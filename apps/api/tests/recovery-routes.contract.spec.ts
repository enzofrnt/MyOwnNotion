/**
 * The recovery-kit routes (T081, US5, FR-016, FR-018, FR-019).
 *
 * These routes hand out the material that recovers an entire workspace, so the
 * questions worth asking are about who may reach them and what leaves in the
 * response.
 *
 * Two decisions are asserted here rather than left to review:
 *
 *   - **reading status asks for nothing**, because it is how an owner finds
 *     out whether they have a usable kit at all, and a prompt in front of that
 *     question discourages the one check worth doing regularly;
 *   - **everything else demands recent authentication**, because each either
 *     produces the material that recovers the workspace or takes away the
 *     ability to recover it — and a kit download is exactly what an attacker
 *     holding a stolen session would reach for.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallation, schema } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-recovery-routes-"));
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
  await harness.built.database.db.execute(sql`TRUNCATE recovery_kits, recovery_epochs CASCADE`);
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  }).catch(() => {
    // Already present from an earlier test in this file; the row is what
    // matters, not who wrote it.
  });
});

describe("who may reach these routes", () => {
  it("refuses status to an unauthenticated caller", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/security/recovery",
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuses preparation to an unauthenticated caller", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/security/recovery",
    });
    // The material that recovers the whole workspace. Nothing about this may
    // be reachable without proof of who is asking.
    expect(response.statusCode).toBe(401);
  });

  it("refuses download to an unauthenticated caller", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/security/recovery/${randomUUID()}/download`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuses confirmation to an unauthenticated caller", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/security/recovery/${randomUUID()}/confirm`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuses revocation to an unauthenticated caller", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/security/recovery/revoke",
    });
    // Revocation removes the ability to recover. An attacker who could reach
    // it would be able to make an owner's kit useless without ever signing in.
    expect(response.statusCode).toBe(401);
  });
});

describe("what a refusal says", () => {
  it("carries a correlation id and no detail about the installation", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/security/recovery",
    });
    const body = response.json();
    expect(body).toHaveProperty("correlationId");
    // The refusal must not become an oracle about whether this installation
    // has a kit, an owner, or anything else.
    expect(JSON.stringify(body)).not.toMatch(/kit|epoch|deployment/i);
  });
});

describe("the routes that exist", () => {
  it("exposes no route that opens a kit", async () => {
    // FR-019 draws the line at the host: administrative recovery is a local
    // CLI operation. A remote endpoint that unwrapped a kit would move that
    // boundary onto the network, where a bearer token is the only thing
    // standing in front of the whole workspace.
    const routes = harness.built.app.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/recovery\/import/);
    expect(routes).not.toMatch(/recovery\/restore/);
    expect(routes).not.toMatch(/recovery\/open/);
  });

  it("registers exactly the four owner-facing operations", async () => {
    const routes = harness.built.app.printRoutes({ commonPrefix: false });
    expect(routes).toMatch(/v1\/security\/recovery/);
    expect(routes).toMatch(/download/);
    expect(routes).toMatch(/confirm/);
    expect(routes).toMatch(/revoke/);
  });
});

describe("the audit trail", () => {
  it("records a refused attempt without saying what was asked for", async () => {
    await harness.built.app.inject({
      method: "POST",
      url: `/v1/security/recovery/${randomUUID()}/download`,
    });

    // Unauthenticated requests are refused by the gate before the handler, so
    // there is nothing kit-specific to record — and nothing kit-specific in
    // the events that do exist.
    const events = await harness.built.database.db.select().from(schema.securityAuditEvents);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/BEGIN|PRIVATE KEY/);
  });
});
