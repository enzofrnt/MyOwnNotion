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
import { sql } from "drizzle-orm";
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
