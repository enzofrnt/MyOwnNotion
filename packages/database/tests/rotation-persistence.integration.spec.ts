/**
 * Rotation persistence (T083, US5, FR-017, FR-018).
 *
 * What is being protected here is a rotation that gets interrupted — a
 * restart, a crash, an operator stopping the process. The failure modes are
 * asymmetric, and only one of them is quiet:
 *
 *   - replaying work already done is wasteful but safe;
 *   - **skipping work never done is silent data loss**, discovered only when
 *     the old key version retires and a record cannot be opened.
 *
 * So the checkpoint and the cursor move together, in one transaction, and the
 * checkpoint table is append-only: it is the only record of whether a restart
 * resumed or quietly began again.
 */

import { randomUUID } from "node:crypto";
import {
  createInstallation,
  findLatestCheckpoint,
  findRotationPolicy,
  findRunningRotation,
  finishRotationOperation,
  RotationRepositoryError,
  recordRotationCheckpoint,
  schema,
  startRotationOperation,
} from "@myownnotion/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSecurityIntegrationContext,
  type SecurityIntegrationContext,
} from "./helpers/security-db.ts";

let context: SecurityIntegrationContext;

beforeAll(async () => {
  context = await createSecurityIntegrationContext();
  await createInstallation(context.handle.db, {
    id: context.installation.installationId,
    sourceLineageId: context.installation.installationId,
    schemaVersion: 1,
  });
}, 180_000);

afterAll(async () => {
  await context?.close();
});

beforeEach(async () => {
  await context.handle.db.delete(schema.rotationCheckpoints);
  await context.handle.db.delete(schema.rotationOperations);
  await context.handle.db.delete(schema.rotationPolicies);
});

async function seedPolicy(kind: "wrapping-key" | "data-key"): Promise<string> {
  const id = randomUUID();
  const now = context.clock.now();
  await context.handle.db.insert(schema.rotationPolicies).values({
    id,
    installationId: context.installation.installationId,
    kind,
    mode: "scheduled",
    dueIntervalDays: kind === "wrapping-key" ? 365 : 365,
    dueAt: new Date(now.getTime() + 365 * 24 * 3_600_000),
    writeBlockAt: new Date(now.getTime() + 372 * 24 * 3_600_000),
    currentGeneration: 1,
    state: "pre-due",
  });
  return id;
}

async function start(kind: "wrapping-key" | "data-key", policyId: string) {
  return await context.handle.db.transaction(async (tx) =>
    startRotationOperation(tx, {
      id: randomUUID(),
      installationId: context.installation.installationId,
      policyId,
      kind,
      mode: "scheduled",
      fromVersionOrGeneration: 1,
      toVersionOrGeneration: 2,
      totalCount: 3,
    }),
  );
}

describe("the two policies are independent", () => {
  it("keeps a separate policy per kind", async () => {
    await seedPolicy("wrapping-key");
    await seedPolicy("data-key");

    const wrapping = await findRotationPolicy(context.handle.db, {
      installationId: context.installation.installationId,
      kind: "wrapping-key",
    });
    const data = await findRotationPolicy(context.handle.db, {
      installationId: context.installation.installationId,
      kind: "data-key",
    });
    expect(wrapping?.kind).toBe("wrapping-key");
    expect(data?.kind).toBe("data-key");
    expect(wrapping?.id).not.toBe(data?.id);
  });

  it("lets one rotate while the other is running", async () => {
    // A leaked deployment key is remedied by rewrapping one row per workspace.
    // Making it wait for a data-key rotation, which re-encrypts content, would
    // make the cheap remedy as slow as the expensive one.
    const wrappingPolicy = await seedPolicy("wrapping-key");
    const dataPolicy = await seedPolicy("data-key");
    await start("wrapping-key", wrappingPolicy);

    const other = await start("data-key", dataPolicy);
    expect(other.kind).toBe("data-key");
  });
});

describe("only one rotation of a kind at a time", () => {
  it("refuses a second operation while one is unfinished", async () => {
    // Two concurrent rotations of one key would interleave their cursors and
    // leave a state neither could resume from.
    const policyId = await seedPolicy("wrapping-key");
    await start("wrapping-key", policyId);

    await expect(start("wrapping-key", policyId)).rejects.toMatchObject({
      code: "rotation_in_progress",
    });
  });

  it("allows a new one once the previous finished", async () => {
    const policyId = await seedPolicy("wrapping-key");
    const first = await start("wrapping-key", policyId);
    await context.handle.db.transaction(async (tx) =>
      finishRotationOperation(tx, {
        operationId: first.id,
        phase: "complete",
        now: context.clock.now(),
      }),
    );

    const second = await start("wrapping-key", policyId);
    expect(second.id).not.toBe(first.id);
  });

  it("allows a new one after a failure, so a failed rotation is not terminal", async () => {
    // A failed rotation that blocked every future attempt would turn a
    // transient error into a permanent inability to rotate.
    const policyId = await seedPolicy("wrapping-key");
    const first = await start("wrapping-key", policyId);
    await context.handle.db.transaction(async (tx) =>
      finishRotationOperation(tx, {
        operationId: first.id,
        phase: "failed",
        now: context.clock.now(),
      }),
    );

    await expect(start("wrapping-key", policyId)).resolves.toBeDefined();
  });
});

describe("a checkpoint and the cursor move together", () => {
  it("advances both in one transaction", async () => {
    // A cursor moved without its checkpoint would skip work on restart, which
    // is the silent failure. The reverse merely replays.
    const policyId = await seedPolicy("wrapping-key");
    const operation = await start("wrapping-key", policyId);

    await context.handle.db.transaction(async (tx) =>
      recordRotationCheckpoint(tx, {
        id: randomUUID(),
        operationId: operation.id,
        sequence: 1,
        cursor: "workspace-1",
        processedCount: 1,
        totalCount: 3,
        checkpointDigest: "digest-1",
        idempotencyKey: `${operation.id}:1`,
        phase: "rewrapping",
        now: context.clock.now(),
      }),
    );

    const running = await findRunningRotation(context.handle.db, {
      installationId: context.installation.installationId,
      kind: "wrapping-key",
    });
    expect(running?.cursor).toBe("workspace-1");
    expect(running?.processedCount).toBe(1);
    expect(running?.phase).toBe("rewrapping");
  });

  it("keeps every checkpoint rather than overwriting one row", async () => {
    // The history is the only record of whether a restart resumed or quietly
    // began again, which is the first question after an interruption.
    const policyId = await seedPolicy("wrapping-key");
    const operation = await start("wrapping-key", policyId);

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await context.handle.db.transaction(async (tx) =>
        recordRotationCheckpoint(tx, {
          id: randomUUID(),
          operationId: operation.id,
          sequence,
          cursor: `workspace-${sequence}`,
          processedCount: sequence,
          totalCount: 3,
          checkpointDigest: `digest-${sequence}`,
          idempotencyKey: `${operation.id}:${sequence}`,
          phase: "rewrapping",
          now: context.clock.now(),
        }),
      );
    }

    const rows = await context.handle.db.select().from(schema.rotationCheckpoints);
    expect(rows).toHaveLength(3);

    const latest = await findLatestCheckpoint(context.handle.db, operation.id);
    expect(latest?.sequence).toBe(3);
    expect(latest?.cursor).toBe("workspace-3");
  });

  it("reports no checkpoint for an operation that never reached one", async () => {
    // Distinct from "reached checkpoint zero": a resume must start from the
    // beginning rather than assume progress that was never recorded.
    const policyId = await seedPolicy("wrapping-key");
    const operation = await start("wrapping-key", policyId);
    expect(await findLatestCheckpoint(context.handle.db, operation.id)).toBeNull();
  });

  it("refuses a duplicate checkpoint for the same step", async () => {
    // The idempotency key exists so a retried commit cannot record the same
    // step twice and inflate the processed count past the total.
    const policyId = await seedPolicy("wrapping-key");
    const operation = await start("wrapping-key", policyId);
    const checkpoint = {
      operationId: operation.id,
      sequence: 1,
      cursor: "workspace-1",
      processedCount: 1,
      totalCount: 3,
      checkpointDigest: "digest-1",
      idempotencyKey: `${operation.id}:1`,
      phase: "rewrapping" as const,
      now: context.clock.now(),
    };

    await context.handle.db.transaction(async (tx) =>
      recordRotationCheckpoint(tx, { id: randomUUID(), ...checkpoint }),
    );
    await expect(
      context.handle.db.transaction(async (tx) =>
        recordRotationCheckpoint(tx, { id: randomUUID(), ...checkpoint }),
      ),
    ).rejects.toThrow();
  });
});

describe("a finished rotation", () => {
  it("is no longer reported as running", async () => {
    const policyId = await seedPolicy("wrapping-key");
    const operation = await start("wrapping-key", policyId);
    await context.handle.db.transaction(async (tx) =>
      finishRotationOperation(tx, {
        operationId: operation.id,
        phase: "complete",
        now: context.clock.now(),
      }),
    );

    expect(
      await findRunningRotation(context.handle.db, {
        installationId: context.installation.installationId,
        kind: "wrapping-key",
      }),
    ).toBeNull();
  });

  it("keeps its checkpoints after completion", async () => {
    // Deleting them would erase the evidence that the rotation covered
    // everything it claimed to.
    const policyId = await seedPolicy("wrapping-key");
    const operation = await start("wrapping-key", policyId);
    await context.handle.db.transaction(async (tx) =>
      recordRotationCheckpoint(tx, {
        id: randomUUID(),
        operationId: operation.id,
        sequence: 1,
        cursor: "workspace-1",
        processedCount: 1,
        totalCount: 1,
        checkpointDigest: "digest",
        idempotencyKey: `${operation.id}:1`,
        phase: "committing",
        now: context.clock.now(),
      }),
    );
    await context.handle.db.transaction(async (tx) =>
      finishRotationOperation(tx, {
        operationId: operation.id,
        phase: "complete",
        now: context.clock.now(),
      }),
    );

    expect(await findLatestCheckpoint(context.handle.db, operation.id)).not.toBeNull();
  });
});

describe("errors", () => {
  it("raises a typed refusal rather than a bare error", async () => {
    const policyId = await seedPolicy("wrapping-key");
    await start("wrapping-key", policyId);
    await expect(start("wrapping-key", policyId)).rejects.toBeInstanceOf(RotationRepositoryError);
  });
});
