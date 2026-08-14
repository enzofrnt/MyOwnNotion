/**
 * Rotation evaluation and the write block (T085, US5, FR-025 – FR-027, SC-009).
 *
 * Two things are being protected here, and they pull against each other.
 *
 * An overdue key must eventually force the operator's hand, or the requirement
 * is advisory. But the same mechanism must never make existing content
 * unreadable: reads are answered under whatever generation sealed them, and a
 * rotation being late says nothing about that. A block that stopped reads
 * would be an outage caused by a calendar.
 *
 * So: writes blocked at a deadline the operator has had a year and a grace
 * period to notice, reads never.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallation, schema } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/security/password-service.ts";
import {
  RotationPolicyService,
  RotationWriteBlockedError,
} from "../src/security/rotation-policy-service.ts";
import { RotationScheduler } from "../src/security/rotation-scheduler.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const NOW = new Date("2026-06-01T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-rotation-key-"));
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
  await harness.built.database.db.execute(
    sql`TRUNCATE rotation_checkpoints, rotation_operations, rotation_policies, sessions, password_credential_versions, authorized_devices, owners, installations CASCADE`,
  );
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

async function seedPolicy(
  kind: "wrapping-key" | "data-key",
  offsets: { dueInDays: number; blockInDays: number },
  /**
   * What the offsets are relative to.
   *
   * The service tests pin a fixed clock, but the routes run on the
   * application clock. A policy seeded against the fixed instant is already
   * long past its write block by the time a route reads it, which is how this
   * first showed up: a status route reporting writes blocked on a policy the
   * test had made healthy.
   */
  from: Date = NOW,
): Promise<void> {
  await harness.built.database.db.insert(schema.rotationPolicies).values({
    id: randomUUID(),
    installationId: INSTALLATION_ID,
    kind,
    mode: "scheduled",
    dueIntervalDays: 365,
    dueAt: new Date(from.getTime() + offsets.dueInDays * DAY),
    writeBlockAt: new Date(from.getTime() + offsets.blockInDays * DAY),
    currentGeneration: 1,
    state: "pre-due",
  });
}

const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";
const PASSWORD = "correct horse battery staple";
const COOKIE = "mn_dev_session";
const CSRF_HEADER = "x-csrf-token";

/** Seeds a committed owner with a password, so a session can be issued. */
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
    INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
    VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, 'rotation-binding', 'Laptop', 'active')
  `);
  const hashed = await hashPassword(PASSWORD);
  await db.execute(sql`
    INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
    VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${hashed.encoded}, 'scrypt', 'active')
  `);
}

async function authenticate(): Promise<{ cookie: string; csrf: string }> {
  await seedOwner();
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/auth/login/password",
    payload: { password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  const match = /mn_dev_session=([^;]*)/.exec(String(value ?? ""));
  return { cookie: match?.[1] ?? "", csrf: response.json().csrfToken as string };
}

function authHeaders(auth: { cookie: string; csrf: string }): Record<string, string> {
  return { cookie: `${COOKIE}=${auth.cookie}`, [CSRF_HEADER]: auth.csrf };
}

function service(): RotationPolicyService {
  return new RotationPolicyService({
    db: harness.built.database.db,
    installationId: INSTALLATION_ID,
    now: () => NOW,
  });
}

/** A logger that records rather than prints, so warnings are assertable. */
function recordingLogger() {
  const entries: { level: string; message: string }[] = [];
  const record =
    (level: string) =>
    (_context: unknown, message?: string): void => {
      entries.push({ level, message: message ?? "" });
    };
  return {
    entries,
    logger: {
      warn: record("warn"),
      fatal: record("fatal"),
      error: record("error"),
      info: record("info"),
      debug: record("debug"),
      trace: record("trace"),
    } as never,
  };
}

describe("both policies are always read", () => {
  it("reports each kind separately", async () => {
    await seedPolicy("wrapping-key", { dueInDays: 100, blockInDays: 107 });
    await seedPolicy("data-key", { dueInDays: -5, blockInDays: 2 });

    const health = await service().health();
    expect(health.wrappingKey?.state).toBe("pre-due");
    expect(health.dataKey?.state).not.toBe("pre-due");
  });

  it("reports an unconfigured policy as absent rather than healthy", async () => {
    // An installation that never configured rotation has not satisfied FR-025.
    // A green answer would hide that.
    await seedPolicy("wrapping-key", { dueInDays: 100, blockInDays: 107 });
    const health = await service().health();
    expect(health.dataKey).toBeNull();
  });
});

describe("the write block", () => {
  it("allows writes before the block instant", async () => {
    await seedPolicy("wrapping-key", { dueInDays: -1, blockInDays: 6 });
    const health = await service().health();
    // Overdue, and still writable: the grace period is the point.
    expect(health.writesAllowed).toBe(true);
    await expect(service().assertWritesAllowed(harness.built.database.db)).resolves.toBeUndefined();
  });

  it("blocks writes once the instant has passed", async () => {
    await seedPolicy("wrapping-key", { dueInDays: -10, blockInDays: -1 });
    const health = await service().health();
    expect(health.writesAllowed).toBe(false);
    await expect(service().assertWritesAllowed(harness.built.database.db)).rejects.toBeInstanceOf(
      RotationWriteBlockedError,
    );
  });

  it("blocks when either policy is blocked, not only both", async () => {
    // A write permitted because the *other* key is healthy would be exactly
    // the write the block exists to prevent.
    await seedPolicy("wrapping-key", { dueInDays: 100, blockInDays: 107 });
    await seedPolicy("data-key", { dueInDays: -10, blockInDays: -1 });

    const health = await service().health();
    expect(health.wrappingKey?.writesAllowed).toBe(true);
    expect(health.writesAllowed).toBe(false);
  });

  it("names the kind that blocked, so the operator knows what to rotate", async () => {
    await seedPolicy("wrapping-key", { dueInDays: 100, blockInDays: 107 });
    await seedPolicy("data-key", { dueInDays: -10, blockInDays: -1 });

    await expect(service().assertWritesAllowed(harness.built.database.db)).rejects.toMatchObject({
      kind: "data-key",
    });
  });

  it("does not block when no policy exists at all", async () => {
    // Unconfigured is a warning, not a reason to refuse writes: an
    // installation would otherwise be unusable before its first rotation was
    // ever set up.
    const health = await service().health();
    expect(health.writesAllowed).toBe(true);
  });
});

describe("what the scheduler says", () => {
  it("warns about an overdue key", async () => {
    await seedPolicy("wrapping-key", { dueInDays: -3, blockInDays: 4 });
    const { entries, logger } = recordingLogger();

    await new RotationScheduler({ policies: service(), logger }).evaluate();
    expect(entries.some((entry) => entry.level === "warn")).toBe(true);
  });

  it("raises a reached write block above a warning", async () => {
    // An installation refusing protected writes is not a "warn" an operator
    // finds next week.
    await seedPolicy("wrapping-key", { dueInDays: -10, blockInDays: -1 });
    const { entries, logger } = recordingLogger();

    await new RotationScheduler({ policies: service(), logger }).evaluate();
    expect(entries.some((entry) => entry.level === "fatal")).toBe(true);
  });

  it("says nothing about a healthy key", async () => {
    // Noise here would train the operator to ignore the channel that carries
    // the write-block warning.
    await seedPolicy("wrapping-key", { dueInDays: 200, blockInDays: 207 });
    await seedPolicy("data-key", { dueInDays: 200, blockInDays: 207 });
    const { entries, logger } = recordingLogger();

    await new RotationScheduler({ policies: service(), logger }).evaluate();
    expect(entries).toHaveLength(0);
  });

  it("warns that a policy is missing entirely", async () => {
    const { entries, logger } = recordingLogger();
    await new RotationScheduler({ policies: service(), logger }).evaluate();
    expect(entries.filter((entry) => entry.level === "warn")).toHaveLength(2);
  });

  it("evaluates at startup rather than waiting for the interval", async () => {
    // The failure this design exists to avoid: a server restarted every few
    // hours never reaches a 24-hour timer, so the check promised as daily
    // never runs at all.
    await seedPolicy("wrapping-key", { dueInDays: -10, blockInDays: -1 });
    const { entries, logger } = recordingLogger();
    const scheduler = new RotationScheduler({
      policies: service(),
      logger,
      intervalMs: 60_000,
    });

    await scheduler.start();
    scheduler.stop();
    expect(entries.some((entry) => entry.level === "fatal")).toBe(true);
  });

  it("starts no rotation of its own", async () => {
    // An expensive, irreversible operation must not begin at an hour nobody
    // chose. The scheduler reads and warns; starting is an explicit act.
    await seedPolicy("data-key", { dueInDays: -10, blockInDays: -1 });
    const { logger } = recordingLogger();

    await new RotationScheduler({ policies: service(), logger }).evaluate();
    const operations = await harness.built.database.db.select().from(schema.rotationOperations);
    expect(operations).toHaveLength(0);
  });
});

describe("starting a rotation is deliberate", () => {
  it("refuses without confirmation, even with everything else right", async () => {
    // The field has no default in the contract, and the handler refuses false
    // rather than reading it as consent. A client that forgets it cannot start
    // a rotation that rewrites data.
    await seedPolicy("data-key", { dueInDays: -10, blockInDays: -1 });
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/security/rotation",
      headers: authHeaders(auth),
      payload: {
        kind: "data-key",
        mode: "scheduled",
        reason: "annual rotation",
        dryRun: false,
        confirmation: false,
      },
    });
    expect(response.statusCode).toBe(400);

    const operations = await harness.built.database.db.select().from(schema.rotationOperations);
    expect(operations).toHaveLength(0);
  });

  it("answers a dry run without starting anything", async () => {
    // An operator deciding whether to rotate at 2am deserves to see the shape
    // of the job first.
    await seedPolicy("data-key", { dueInDays: -10, blockInDays: -1 });
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/security/rotation",
      headers: authHeaders(auth),
      payload: {
        kind: "data-key",
        mode: "scheduled",
        reason: "checking the size",
        dryRun: true,
        confirmation: true,
      },
    });
    // 200, not 202: nothing has begun, and 202 would suggest otherwise.
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as { phase: string }).phase).toBe("planned");

    const operations = await harness.built.database.db.select().from(schema.rotationOperations);
    expect(operations).toHaveLength(0);
  });

  it("starts one when confirmed, and reports it as accepted rather than done", async () => {
    await seedPolicy("data-key", { dueInDays: -10, blockInDays: -1 });
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/security/rotation",
      headers: authHeaders(auth),
      payload: {
        kind: "data-key",
        mode: "scheduled",
        reason: "annual rotation",
        dryRun: false,
        confirmation: true,
      },
    });
    expect(response.statusCode, response.body).toBe(202);

    const operations = await harness.built.database.db.select().from(schema.rotationOperations);
    expect(operations).toHaveLength(1);
  });

  it("refuses a second rotation of the same kind", async () => {
    await seedPolicy("data-key", { dueInDays: -10, blockInDays: -1 });
    const auth = await authenticate();
    const start = () =>
      harness.built.app.inject({
        method: "POST",
        url: "/v1/security/rotation",
        headers: authHeaders(auth),
        payload: {
          kind: "data-key",
          mode: "scheduled",
          reason: "annual rotation",
          dryRun: false,
          confirmation: true,
        },
      });

    expect((await start()).statusCode).toBe(202);
    expect((await start()).statusCode).toBe(409);
  });

  it("lets any signed-in owner read the status without a fresh prompt", async () => {
    // This is how an owner discovers a rotation is overdue. A prompt in front
    // of it would discourage looking.
    await seedPolicy("wrapping-key", { dueInDays: -3, blockInDays: 4 }, new Date());
    const auth = await authenticate();
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/security/rotation",
      headers: authHeaders(auth),
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { policies: { kind: string }[]; writesAllowed: boolean };
    expect(body.policies.map((policy) => policy.kind)).toContain("wrapping-key");
    expect(body.writesAllowed).toBe(true);
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/security/rotation",
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(401);
  });
});
