/**
 * Refusing to start without a security configuration (feature 002).
 *
 * A production API that cannot load its security configuration must stop, not
 * serve. Continuing is not a degraded mode: the installation, bootstrap,
 * authentication, and session routes are absent, so the workspace is open to
 * anyone who can reach it — and the failure is invisible, because the process
 * listens, `/health` answers 200, and the container healthcheck goes green.
 *
 * This was reached with the shipped Compose defaults, not with a contrived
 * configuration, which is why it gets its own test.
 *
 * **The decision is injected, never set as a global.** An earlier version of
 * this file assigned `process.env.NODE_ENV = "production"`, which leaked into
 * every other test sharing the process and took the whole coverage run down
 * with it. A test that has to mutate a global to reach a branch is telling you
 * the branch reads from the wrong place.
 */

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";

let postgres: DisposablePostgres;
let blobRoot: string;

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  blobRoot = mkdtempSync(path.join(os.tmpdir(), "mon-startup-"));
}, 180_000);

afterAll(async () => {
  await postgres?.stop();
  rmSync(blobRoot, { recursive: true, force: true });
});

afterEach(() => {
  // These two are read by `loadSecurityConfig` from the environment, so they
  // are set per test and cleared here. `NODE_ENV` is deliberately not among
  // them: the refusal is an injected option.
  delete process.env["MYOWNNOTION_PUBLIC_ORIGIN"];
  delete process.env["MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE"];
});

async function waitForBlockedRotationRead(client: pg.Client): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ blocked: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks waiting
        JOIN pg_class relation ON relation.oid = waiting.relation
        WHERE relation.relname = 'rotation_policies'
          AND waiting.granted = false
      ) AS blocked
    `);
    if (result.rows[0]?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the startup rotation-policy read never reached the database lock");
}

describe("when a refused configuration must stop the process", () => {
  it("refuses the shipped Compose defaults", async () => {
    // Exactly those defaults: an http loopback origin with the named exception
    // switched off. `loadSecurityConfig` rightly refuses the combination, and
    // the process must not carry on regardless.
    process.env["MYOWNNOTION_PUBLIC_ORIGIN"] = "http://127.0.0.1:5173";
    process.env["MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE"] = "0";

    await expect(
      buildApp({
        databaseUrl: postgres.connectionString,
        blobRoot,
        logger: false,
        refuseWithoutSecurity: true,
      }),
    ).rejects.toThrow();
  });

  it("refuses when nothing is configured at all", async () => {
    await expect(
      buildApp({
        databaseUrl: postgres.connectionString,
        blobRoot,
        logger: false,
        refuseWithoutSecurity: true,
      }),
    ).rejects.toThrow();
  });

  it("starts when the configuration is valid", async () => {
    // The refusal must be about the configuration, not about the mode.
    process.env["MYOWNNOTION_PUBLIC_ORIGIN"] = "https://notes.example.test";
    const built = await buildApp({
      databaseUrl: postgres.connectionString,
      blobRoot,
      logger: false,
      refuseWithoutSecurity: true,
    });
    const response = await built.app.inject({ method: "GET", url: "/v1/installation/status" });
    expect(response.statusCode).toBe(200);
    await built.close();
  });

  it("finishes startup security work before reporting the app ready", async () => {
    // Keep the rotation-policy read waiting in PostgreSQL. `buildApp` must stay
    // pending until that startup evaluation completes; otherwise `close()` can
    // end the pool underneath a detached query and produce a much later
    // unhandled rejection in an unrelated test.
    process.env["MYOWNNOTION_PUBLIC_ORIGIN"] = "https://notes.example.test";
    const blocker = new pg.Client({ connectionString: postgres.connectionString });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE rotation_policies IN ACCESS EXCLUSIVE MODE");

    let settled = false;
    const building = buildApp({
      databaseUrl: postgres.connectionString,
      blobRoot,
      logger: false,
      refuseWithoutSecurity: true,
    }).then((value) => {
      settled = true;
      return value;
    });

    let remainedPending = false;
    let observationError: unknown;
    try {
      await waitForBlockedRotationRead(blocker);
      await new Promise<void>((resolve) => setImmediate(resolve));
      remainedPending = !settled;
    } catch (error) {
      observationError = error;
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }

    const built = await building;
    await built.close();
    if (observationError !== undefined) throw observationError;
    expect(remainedPending).toBe(true);
  });
});

describe("when it may continue without one", () => {
  it("starts, and says so, with the security surface absent", async () => {
    // The feature-001 contract harness builds the app deliberately without a
    // security configuration and must keep working.
    const built = await buildApp({
      databaseUrl: postgres.connectionString,
      blobRoot,
      logger: false,
      refuseWithoutSecurity: false,
    });
    expect((await built.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    // The 404 that used to be the only symptom of an unprotected deployment.
    expect(
      (await built.app.inject({ method: "GET", url: "/v1/installation/status" })).statusCode,
    ).toBe(404);
    await built.close();
  });
});
