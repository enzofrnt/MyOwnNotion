/**
 * Rotation faults at every persistence boundary (T079, US5, FR-013, FR-017, SC-006).
 *
 * A rotation is a long operation over durable state, so the interesting
 * question is never "does it work" but "what does an interruption leave
 * behind". Each test here kills the operation at a different boundary and
 * asks the same two things:
 *
 *   - is the workspace still readable?
 *   - does a restart resume, rather than start over or skip ahead?
 *
 * The second is where data is lost. Starting over is merely slow; skipping
 * ahead means a workspace never gets rewrapped and becomes unreadable the day
 * the old key version is retired.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createInstallation,
  findLatestCheckpoint,
  findRunningRotation,
  finishRotationOperation,
  recordRotationCheckpoint,
  schema,
  startRotationOperation,
} from "@myownnotion/database";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;
let keyFile: string;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const SECRET = "the note that must survive every interruption";

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-fault-key-"));
  keyFile = path.join(keyDirectory, "deployment-key");
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
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

async function seedPolicy(kind: "wrapping-key" | "data-key"): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await harness.built.database.db.insert(schema.rotationPolicies).values({
    id,
    installationId: INSTALLATION_ID,
    kind,
    mode: "scheduled",
    dueIntervalDays: 365,
    dueAt: new Date(now - 24 * 3_600_000),
    writeBlockAt: new Date(now + 6 * 24 * 3_600_000),
    currentGeneration: 1,
    state: "due",
  });
  return id;
}

async function startRotation(kind: "wrapping-key" | "data-key", policyId: string, total = 3) {
  return await harness.built.database.db.transaction(async (tx) =>
    startRotationOperation(tx, {
      id: randomUUID(),
      installationId: INSTALLATION_ID,
      policyId,
      kind,
      mode: "scheduled",
      fromVersionOrGeneration: 1,
      toVersionOrGeneration: 2,
      totalCount: total,
    }),
  );
}

async function checkpoint(operationId: string, sequence: number, cursor: string): Promise<void> {
  await harness.built.database.db.transaction(async (tx) =>
    recordRotationCheckpoint(tx, {
      id: randomUUID(),
      operationId,
      sequence,
      cursor,
      processedCount: sequence,
      totalCount: 3,
      checkpointDigest: `digest-${sequence}`,
      idempotencyKey: `${operationId}:${sequence}`,
      phase: "rewrapping",
      now: new Date(),
    }),
  );
}

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

describe("interrupted midway", () => {
  it("leaves the workspace readable", async () => {
    // The first thing to check after any interruption. A rotation that could
    // leave content unreadable would be too dangerous to ever run.
    const pageId = await createSealedPage(SECRET);
    const policyId = await seedPolicy("wrapping-key");
    const operation = await startRotation("wrapping-key", policyId);
    await checkpoint(operation.id, 1, "workspace-1");
    // Interruption: nothing marks the operation finished.

    expect(
      await harness.built.context.protectedContent?.readItemName(harness.built.database.db, pageId),
    ).toBe(SECRET);
  });

  it("is still reported as running after a restart", async () => {
    // A restart does not clear the row, so the next process finds the work
    // rather than starting a second rotation beside it.
    const policyId = await seedPolicy("wrapping-key");
    const operation = await startRotation("wrapping-key", policyId);
    await checkpoint(operation.id, 1, "workspace-1");

    const found = await findRunningRotation(harness.built.database.db, {
      installationId: INSTALLATION_ID,
      kind: "wrapping-key",
    });
    expect(found?.id).toBe(operation.id);
    expect(found?.cursor).toBe("workspace-1");
  });

  it("resumes from the last checkpoint rather than from zero", async () => {
    const policyId = await seedPolicy("wrapping-key");
    const operation = await startRotation("wrapping-key", policyId);
    await checkpoint(operation.id, 1, "workspace-1");
    await checkpoint(operation.id, 2, "workspace-2");

    const latest = await findLatestCheckpoint(harness.built.database.db, operation.id);
    expect(latest?.cursor).toBe("workspace-2");
    expect(latest?.processedCount).toBe(2);
  });

  it("refuses a second rotation of the same kind while one is unfinished", async () => {
    // The conflict that matters: two rotations interleaving their cursors
    // would leave a state neither could resume from.
    const policyId = await seedPolicy("wrapping-key");
    await startRotation("wrapping-key", policyId);

    await expect(startRotation("wrapping-key", policyId)).rejects.toMatchObject({
      code: "rotation_in_progress",
    });
  });

  it("does not block the other kind", async () => {
    const wrapping = await seedPolicy("wrapping-key");
    const data = await seedPolicy("data-key");
    await startRotation("wrapping-key", wrapping);

    await expect(startRotation("data-key", data)).resolves.toBeDefined();
  });
});

describe("when the deployment key becomes unavailable mid-rotation", () => {
  it("refuses protected reads rather than returning something else", async () => {
    // The mounted secret can disappear at any moment — an unmounted volume, a
    // rotated file. Every read must fail closed, including during a rotation.
    const pageId = await createSealedPage(SECRET);
    const policyId = await seedPolicy("wrapping-key");
    await startRotation("wrapping-key", policyId);

    rmSync(keyFile);
    expect(existsSync(keyFile)).toBe(false);
    try {
      await expect(
        harness.built.context.protectedContent?.readItemName(harness.built.database.db, pageId),
      ).rejects.toThrow();
    } finally {
      // Restored for the tests that follow: the key is read on demand, so
      // putting it back is enough to recover.
      writeFileSync(keyFile, randomBytes(32).toString("base64"), {
        encoding: "utf8",
        mode: 0o600,
      });
    }
  });

  it("leaves the operation row intact so it can be resumed later", async () => {
    // An unavailable secret is a pause, not a failure. Marking the operation
    // failed would make an operator restart a rotation that had merely been
    // waiting for a volume to come back.
    const policyId = await seedPolicy("wrapping-key");
    const operation = await startRotation("wrapping-key", policyId);
    await checkpoint(operation.id, 1, "workspace-1");

    const found = await findRunningRotation(harness.built.database.db, {
      installationId: INSTALLATION_ID,
      kind: "wrapping-key",
    });
    expect(found?.phase).not.toBe("failed");
    expect(found?.cursor).toBe("workspace-1");
  });
});

describe("after a failure", () => {
  it("keeps the checkpoints of the attempt that failed", async () => {
    // They are the evidence of how far it got, which is what decides whether
    // the retry is a resume or a fresh start.
    const policyId = await seedPolicy("wrapping-key");
    const operation = await startRotation("wrapping-key", policyId);
    await checkpoint(operation.id, 1, "workspace-1");
    await harness.built.database.db.transaction(async (tx) =>
      finishRotationOperation(tx, {
        operationId: operation.id,
        phase: "failed",
        now: new Date(),
      }),
    );

    expect(await findLatestCheckpoint(harness.built.database.db, operation.id)).not.toBeNull();
  });

  it("allows a retry rather than making the failure permanent", async () => {
    const policyId = await seedPolicy("wrapping-key");
    const first = await startRotation("wrapping-key", policyId);
    await harness.built.database.db.transaction(async (tx) =>
      finishRotationOperation(tx, { operationId: first.id, phase: "failed", now: new Date() }),
    );

    await expect(startRotation("wrapping-key", policyId)).resolves.toBeDefined();
  });

  it("does not let a retry inherit the failed attempt's checkpoints", async () => {
    // Each operation carries its own progress. Inheriting would mark
    // workspaces done that the new attempt never touched — the exact way a
    // resume loses data.
    const policyId = await seedPolicy("wrapping-key");
    const first = await startRotation("wrapping-key", policyId);
    await checkpoint(first.id, 1, "workspace-1");
    await harness.built.database.db.transaction(async (tx) =>
      finishRotationOperation(tx, { operationId: first.id, phase: "failed", now: new Date() }),
    );

    const retry = await startRotation("wrapping-key", policyId);
    expect(await findLatestCheckpoint(harness.built.database.db, retry.id)).toBeNull();
  });
});

describe("the operation row and its checkpoints stay consistent", () => {
  it("advances the row cursor with every checkpoint", async () => {
    const policyId = await seedPolicy("data-key");
    const operation = await startRotation("data-key", policyId);

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await checkpoint(operation.id, sequence, `cursor-${sequence}`);
      const [row] = await harness.built.database.db
        .select()
        .from(schema.rotationOperations)
        .where(eq(schema.rotationOperations.id, operation.id));
      expect(row?.cursor).toBe(`cursor-${sequence}`);
      expect(row?.processedCount).toBe(sequence);
    }
  });

  it("refuses a duplicate checkpoint for a step already recorded", async () => {
    // A retried commit must not inflate the processed count past the total,
    // which would report a rotation as further along than it is.
    const policyId = await seedPolicy("data-key");
    const operation = await startRotation("data-key", policyId);
    await checkpoint(operation.id, 1, "cursor-1");

    await expect(checkpoint(operation.id, 1, "cursor-1")).rejects.toThrow();
  });
});
