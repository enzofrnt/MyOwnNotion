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
 */

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";

let postgres: DisposablePostgres;
let blobRoot: string;
const originalNodeEnv = process.env["NODE_ENV"];

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  blobRoot = mkdtempSync(path.join(os.tmpdir(), "mon-startup-"));
}, 180_000);

afterAll(async () => {
  await postgres?.stop();
  rmSync(blobRoot, { recursive: true, force: true });
});

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env["NODE_ENV"];
  } else {
    process.env["NODE_ENV"] = originalNodeEnv;
  }
  delete process.env["MYOWNNOTION_PUBLIC_ORIGIN"];
  delete process.env["MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE"];
});

describe("in production", () => {
  it("refuses to start when the security configuration is invalid", async () => {
    // Exactly the shipped Compose defaults: an http loopback origin with the
    // named exception switched off. `loadSecurityConfig` rightly refuses it,
    // and the process must not carry on regardless.
    process.env["NODE_ENV"] = "production";
    process.env["MYOWNNOTION_PUBLIC_ORIGIN"] = "http://127.0.0.1:5173";
    process.env["MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE"] = "0";

    await expect(
      buildApp({ databaseUrl: postgres.connectionString, blobRoot, logger: false }),
    ).rejects.toThrow();
  });

  it("refuses to start when nothing is configured at all", async () => {
    process.env["NODE_ENV"] = "production";
    await expect(
      buildApp({ databaseUrl: postgres.connectionString, blobRoot, logger: false }),
    ).rejects.toThrow();
  });

  it("starts when the configuration is valid", async () => {
    // The refusal must be about the configuration, not about production.
    process.env["NODE_ENV"] = "production";
    process.env["MYOWNNOTION_PUBLIC_ORIGIN"] = "https://notes.example.test";
    const built = await buildApp({
      databaseUrl: postgres.connectionString,
      blobRoot,
      logger: false,
    });
    const response = await built.app.inject({ method: "GET", url: "/v1/installation/status" });
    expect(response.statusCode).toBe(200);
    await built.close();
  });
});

describe("outside production", () => {
  it("still starts without a security configuration", async () => {
    // The feature-001 contract harness builds the app deliberately without
    // one and must keep working.
    delete process.env["NODE_ENV"];
    const built = await buildApp({
      databaseUrl: postgres.connectionString,
      blobRoot,
      logger: false,
    });
    // Content routes are there; the security surface is not.
    expect((await built.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect(
      (await built.app.inject({ method: "GET", url: "/v1/installation/status" })).statusCode,
    ).toBe(404);
    await built.close();
  });
});
