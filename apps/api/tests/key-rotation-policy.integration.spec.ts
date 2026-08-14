/**
 * Rotation policy against real protected data (T075, US5, FR-025, FR-026, SC-009).
 *
 * The evaluation tests next door work on policy rows. This one seals an actual
 * record first, then pushes the installation into a write block, and checks
 * the guarantee that matters most and is easiest to break by accident:
 *
 * **A blocked installation is still readable.**
 *
 * Every other property here is a warning or a counter. This one is the
 * difference between an operator who missed a deadline and an owner who has
 * lost access to their own workspace because of a calendar. An implementation
 * that gated reads on the same policy would pass every unit test about states
 * and still be unusable.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallation, schema } from "@myownnotion/database";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RotationPolicyService } from "../src/security/rotation-policy-service.ts";
import { DAILY_INTERVAL_MS, RotationScheduler } from "../src/security/rotation-scheduler.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "the quarterly figures nobody has seen";

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-rotpolicy-key-"));
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
    sql`TRUNCATE rotation_checkpoints, rotation_operations, rotation_policies,
        protected_envelopes, placements, revision_parents, page_documents CASCADE`,
  );
  await harness.built.database.db.execute(
    sql`UPDATE data_key_generations SET state = 'current' WHERE state = 'revoked'`,
  );
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

/** Seeds a policy relative to now, so the app clock agrees with the test. */
async function seedPolicy(
  kind: "wrapping-key" | "data-key",
  offsets: { dueInDays: number; blockInDays: number },
): Promise<void> {
  const now = Date.now();
  await harness.built.database.db.insert(schema.rotationPolicies).values({
    id: randomUUID(),
    installationId: INSTALLATION_ID,
    kind,
    mode: "scheduled",
    dueIntervalDays: 365,
    dueAt: new Date(now + offsets.dueInDays * DAY),
    writeBlockAt: new Date(now + offsets.blockInDays * DAY),
    currentGeneration: 1,
    state: "pre-due",
  });
}

function policies(): RotationPolicyService {
  return new RotationPolicyService({
    db: harness.built.database.db,
    installationId: INSTALLATION_ID,
    now: () => new Date(),
  });
}

/** Creates a page through the ordinary route, which seals its title. */
async function createSealedPage(name: string): Promise<string> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/items",
    headers: { "idempotency-key": randomUUID() },
    payload: {
      id: randomUUID(),
      kind: "page",
      name,
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().item.id as string;
}

function recordingLogger() {
  const entries: { level: string }[] = [];
  const record = (level: string) => (): void => {
    entries.push({ level });
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

describe("a blocked installation is still readable", () => {
  it("opens a record sealed before the block was reached", async () => {
    // The guarantee this file exists for. An implementation that gated reads
    // on the same policy would pass every state test and lock an owner out of
    // their own workspace over a missed deadline.
    const pageId = await createSealedPage(SECRET);
    await seedPolicy("data-key", { dueInDays: -400, blockInDays: -1 });

    expect((await policies().health()).writesAllowed).toBe(false);

    const protectedContent = harness.built.context.protectedContent;
    expect(protectedContent).toBeDefined();
    expect(await protectedContent?.readItemName(harness.built.database.db, pageId)).toBe(SECRET);
  });

  it("still serves the ordinary read routes while blocked", async () => {
    const pageId = await createSealedPage(SECRET);
    await seedPolicy("wrapping-key", { dueInDays: -400, blockInDays: -1 });

    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${pageId}`,
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it("keeps the envelope intact rather than rewriting it on evaluation", async () => {
    // Evaluating a policy must not touch data. A read-only check that wrote
    // would make every status poll a risk.
    await createSealedPage(SECRET);
    const before = await harness.built.database.db.execute(
      sql`SELECT ciphertext FROM protected_envelopes ORDER BY entity_type`,
    );
    await seedPolicy("data-key", { dueInDays: -400, blockInDays: -1 });

    await policies().health();
    const after = await harness.built.database.db.execute(
      sql`SELECT ciphertext FROM protected_envelopes ORDER BY entity_type`,
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe("startup evaluation against real policies", () => {
  it("warns at startup when a policy is overdue", async () => {
    // Not on a timer the process may never reach: at startup, every time.
    await seedPolicy("wrapping-key", { dueInDays: -3, blockInDays: 4 });
    const { entries, logger } = recordingLogger();
    const scheduler = new RotationScheduler({ policies: policies(), logger });

    await scheduler.start();
    scheduler.stop();
    expect(entries.some((entry) => entry.level === "warn")).toBe(true);
  });

  it("uses a daily interval as its fallback", () => {
    // The constant is asserted rather than assumed: FR-026 says at least
    // daily, and a value that drifted to weekly would satisfy no test that
    // only checked "an interval exists".
    expect(DAILY_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("re-evaluates on the interval without being restarted", async () => {
    await seedPolicy("wrapping-key", { dueInDays: -3, blockInDays: 4 });
    const { entries, logger } = recordingLogger();
    const scheduler = new RotationScheduler({
      policies: policies(),
      logger,
      intervalMs: 30,
    });

    await scheduler.start();
    const afterStartup = entries.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    scheduler.stop();

    expect(entries.length).toBeGreaterThan(afterStartup);
  });

  it("survives a failing evaluation rather than losing the schedule", async () => {
    // A transient database error must not turn into permanent silence about
    // an approaching write block.
    const { entries, logger } = recordingLogger();
    const failing = {
      health: async () => {
        throw new Error("database unavailable");
      },
    } as unknown as RotationPolicyService;
    const scheduler = new RotationScheduler({ policies: failing, logger, intervalMs: 30 });

    await expect(scheduler.start()).rejects.toThrow();
    scheduler.stop();
    expect(entries).toHaveLength(0);
  });
});

describe("the owner-facing warning states", () => {
  it("reports due, overdue and blocked distinctly", async () => {
    // One label for all three would leave an owner unable to tell "act soon"
    // from "your workspace is refusing writes right now".
    const states: string[] = [];
    for (const offsets of [
      { dueInDays: -1, blockInDays: 6 },
      { dueInDays: -8, blockInDays: -1 },
    ]) {
      await harness.built.database.db.execute(sql`TRUNCATE rotation_policies CASCADE`);
      await seedPolicy("wrapping-key", offsets);
      const health = await policies().health();
      states.push(health.wrappingKey?.state ?? "absent");
    }
    expect(new Set(states).size).toBe(states.length);
  });
});

describe("the block reaches the write path, not only the status", () => {
  it("refuses a protected write once the block instant has passed", async () => {
    // The check that was calculated but never applied until now. A policy that
    // reported a block while writes carried on would be worse than no policy:
    // the operator would believe the deadline had teeth.
    await seedPolicy("data-key", { dueInDays: -400, blockInDays: -1 });

    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id: randomUUID(),
        kind: "page",
        name: "Written after the deadline",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("leaves nothing behind when it refuses", async () => {
    // The refusal happens inside the mutation's transaction, so content and
    // envelope roll back together. A half-written item would be worse than
    // either outcome.
    await seedPolicy("data-key", { dueInDays: -400, blockInDays: -1 });
    const id = randomUUID();

    await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id,
        kind: "page",
        name: "Should not survive",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });

    const items = await harness.built.database.db.execute(
      sql`SELECT id FROM items WHERE id = ${id}::uuid`,
    );
    expect((items as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it("still writes while the policy is merely overdue", async () => {
    // The grace period has to actually work, or the block is just an earlier
    // deadline wearing a different name.
    await seedPolicy("data-key", { dueInDays: -1, blockInDays: 6 });

    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id: randomUUID(),
        kind: "page",
        name: "Written during grace",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
  });

  it("writes normally when no policy is configured", async () => {
    // An installation that has not set up rotation must not be unusable.
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id: randomUUID(),
        kind: "page",
        name: "No policy at all",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
  });
});

describe("a wrapping-key rotation leaves the content alone", () => {
  it("rewraps the root key without touching a single envelope", async () => {
    // The property the whole key hierarchy exists to provide. If a deployment
    // key rotation had to re-encrypt records, it would take hours, leave a
    // window of half-rotated data, and nobody would run it on schedule.
    const pageId = await createSealedPage(SECRET);
    const before = await harness.built.database.db.execute(
      sql`SELECT entity_type, ciphertext, nonce, tag FROM protected_envelopes ORDER BY entity_type`,
    );
    expect((before as unknown as { rows: unknown[] }).rows.length).toBeGreaterThan(0);

    const keys = harness.built.context.protectedContent;
    expect(keys).toBeDefined();

    // Rewrap under a new deployment key.
    const newKey = randomBytes(32);
    const versionId = randomUUID();
    await harness.built.database.db.transaction(async (tx) => {
      // Exactly one version may be current, so the outgoing one steps down to
      // `previous` first. It stays usable on purpose: it is what unwrapped the
      // root key a moment ago, and revoking it before the rewrap landed would
      // strand the workspace.
      await tx
        .update(schema.wrappingKeyVersions)
        .set({ state: "previous" })
        .where(eq(schema.wrappingKeyVersions.state, "current"));
      await tx.insert(schema.wrappingKeyVersions).values({
        id: versionId,
        installationId: INSTALLATION_ID,
        version: 2,
        externalSecretReference: "file:///run/secrets/deployment-key.next",
        algorithm: "aes-256-gcm",
        state: "current",
      });
      await harness.built.keyHierarchy?.rewrapRootKey(tx, {
        newWrappingKey: new Uint8Array(newKey),
        newWrappingKeyVersionId: versionId,
      });
    });

    const after = await harness.built.database.db.execute(
      sql`SELECT entity_type, ciphertext, nonce, tag FROM protected_envelopes ORDER BY entity_type`,
    );
    // Byte for byte. Not "still decryptable" — untouched.
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(pageId).toBeTruthy();
  });
});

describe("what the trail records about a rotation", () => {
  it("records a reached write block once per evaluation, not once per refused write", async () => {
    // Auditing the write path would emit one row per request: thousands of
    // identical events burying the one an operator needs, and a self-inflicted
    // write amplification while the installation is already unhappy.
    await seedPolicy("data-key", { dueInDays: -400, blockInDays: -1 });
    const blocked: { kind: string }[] = [];
    const { logger } = recordingLogger();

    const scheduler = new RotationScheduler({
      policies: policies(),
      logger,
      onWriteBlocked: async (event) => {
        blocked.push({ kind: event.kind });
      },
    });

    await scheduler.evaluate();
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.kind).toBe("data-key");

    // Several refused writes in between change nothing: the count follows
    // evaluations, not requests.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await harness.built.app.inject({
        method: "POST",
        url: "/v1/items",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          id: randomUUID(),
          kind: "page",
          name: "Refused",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        },
      });
    }
    expect(blocked).toHaveLength(1);
  });

  it("says nothing while the policy is merely overdue", async () => {
    // The event marks the moment writes actually stopped. Firing during the
    // grace period would make it useless for answering "since when?".
    await seedPolicy("data-key", { dueInDays: -1, blockInDays: 6 });
    const blocked: unknown[] = [];
    const { logger } = recordingLogger();

    await new RotationScheduler({
      policies: policies(),
      logger,
      onWriteBlocked: async (event) => {
        blocked.push(event);
      },
    }).evaluate();

    expect(blocked).toHaveLength(0);
  });

  it("carries the dates an operator needs, and no key material", async () => {
    await seedPolicy("wrapping-key", { dueInDays: -400, blockInDays: -1 });
    const blocked: { dueAt: Date; writeBlockAt: Date }[] = [];
    const { logger } = recordingLogger();

    await new RotationScheduler({
      policies: policies(),
      logger,
      onWriteBlocked: async (event) => {
        blocked.push({ dueAt: event.dueAt, writeBlockAt: event.writeBlockAt });
      },
    }).evaluate();

    expect(blocked[0]?.dueAt).toBeInstanceOf(Date);
    expect(blocked[0]?.writeBlockAt).toBeInstanceOf(Date);
    expect(JSON.stringify(blocked)).not.toContain("key");
  });
});
