/**
 * The audit trail a rotation leaves behind (T087, US5, FR-022, FR-023, FR-035).
 *
 * A rotation is the longest-running thing this installation does, it moves key
 * material, and it can be interrupted. The trail is therefore not a formality:
 * it is the only account of what happened available to an operator arriving
 * afterwards, which is usually the situation they arrive in.
 *
 * Two properties are tested harder than the rest, because both are silently
 * broken by implementations that otherwise look right:
 *
 *   1. **A rolled-back batch leaves no audit row.** An event that survived its
 *      own transaction would claim progress that did not happen, and on a
 *      resumable operation a phantom checkpoint is worse than none, because
 *      the resume trusts it.
 *   2. **No row contains key material.** Not the deployment key, not a data
 *      key, in any encoding.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  schema,
} from "@myownnotion/database";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCommand } from "../src/admin/command-parser.ts";
import type { RotationAudit } from "../src/admin/commands/rotation-audit.ts";
import { rotationDataKeyCommand } from "../src/admin/commands/rotation-data-key.ts";
import { AuditService, newCorrelationId } from "../src/security/audit-service.ts";
import { KeyHierarchy } from "../src/security/key-hierarchy.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const KEY = Buffer.from(randomBytes(32));

const bytes = (value: string) => new Uint8Array(Buffer.from(value, "utf8"));

function keys(): KeyHierarchy {
  return new KeyHierarchy({
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    deploymentKey: () => KEY,
    now: () => new Date(),
  });
}

function journal(): RotationAudit {
  return {
    audit: new AuditService(handle.db),
    context: {
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      correlationId: newCorrelationId(),
      actorClass: "hosting-admin",
    },
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    deploymentKey: () => KEY,
    now: () => new Date(),
    audit: journal(),
    ...overrides,
  };
}

async function events(): Promise<(typeof schema.securityAuditEvents.$inferSelect)[]> {
  return await handle.db.select().from(schema.securityAuditEvents);
}

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
}, 180_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
});

beforeEach(async () => {
  await handle.db.execute(sql`
    TRUNCATE security_audit_events, rotation_checkpoints, rotation_operations,
      rotation_policies, protected_envelopes, data_key_generations,
      workspace_root_keys, wrapping_key_versions, installations CASCADE
  `);
  await createInstallation(handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  await handle.db.insert(schema.rotationPolicies).values({
    id: randomUUID(),
    installationId: INSTALLATION_ID,
    kind: "data-key",
    mode: "scheduled",
    dueIntervalDays: 180,
    dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    writeBlockAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
    currentGeneration: 1,
    state: "due",
  });
  await handle.db.transaction(async (tx) => {
    await keys().initialize(tx);
  });
});

async function seed(count: number): Promise<void> {
  const service = new ProtectedRecordService({
    db: handle.db,
    keys: keys(),
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    now: () => new Date(),
  });
  for (let index = 0; index < count; index += 1) {
    await handle.db.transaction(async (tx) => {
      await service.write(tx, {
        entityType: "item",
        entityId: randomUUID(),
        recordVersion: 1,
        payload: bytes(`secret ${index}`),
      });
    });
  }
}

function command(argv: string[] = []) {
  return parseCommand(["security", "rotation", "data-key", ...argv]);
}

describe("what a completed rotation records", () => {
  it("records start, a checkpoint per batch, and completion", async () => {
    await seed(4);
    await rotationDataKeyCommand(command(["--yes"]), deps({ batchSize: 2 }), { execute: true });

    const recorded = await events();
    const types = recorded.map((row) => row.eventType);
    expect(types).toContain("rotation.started");
    expect(types).toContain("rotation.completed");
    expect(types.filter((type) => type === "rotation.checkpoint")).toHaveLength(2);
  });

  it("records the generation minted and the one retired as separate events", async () => {
    await seed(1);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const recorded = await events();
    const created = recorded.find((row) => row.eventType === "key.generation-created");
    const retired = recorded.find((row) => row.eventType === "key.generation-retired");
    // Separate rows, indexed by the generation each is about. An operator
    // asking what happened to generation one must find it under one, not
    // buried in the row for two.
    expect(created?.objectId).toBe("2");
    expect(retired?.objectId).toBe("1");
  });

  it("carries the total count on the start event", async () => {
    await seed(3);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const started = (await events()).find((row) => row.eventType === "rotation.started");
    // Without it a later checkpoint is uninterpretable: "412 of 8000" says
    // something, "412" does not.
    expect((started?.metadata as Record<string, unknown> | undefined)?.["totalCount"]).toBe(3);
  });

  it("ties every event of one rotation to a single correlation id", async () => {
    await seed(4);
    await rotationDataKeyCommand(command(["--yes"]), deps({ batchSize: 2 }), { execute: true });

    const ids = new Set((await events()).map((row) => row.correlationId));
    // The trail is only navigable if one operator action is one thread.
    expect(ids.size).toBe(1);
  });

  it("attributes the rotation to the hosting administrator, never the owner", async () => {
    await seed(1);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    // These run on the host, as whoever can already read the mounted key.
    // Recording them as `owner` would blur the one boundary FR-019 draws.
    for (const row of await events()) {
      expect(row.actorClass).toBe("hosting-admin");
    }
  });
});

describe("what a failed rotation records", () => {
  it("records the failure with how far it reached", async () => {
    await seed(2);
    // Break a record so the first batch cannot be re-encrypted.
    const rows = await handle.db.select().from(schema.protectedEnvelopes).limit(1);
    await handle.db
      .update(schema.protectedEnvelopes)
      .set({ ciphertext: "AAAA" })
      .where(eq(schema.protectedEnvelopes.id, rows[0]?.id ?? ""));

    const result = await rotationDataKeyCommand(command(["--yes"]), deps({ batchSize: 1 }), {
      execute: true,
    });
    expect(result.code).not.toBe(0);

    const failed = (await events()).find((row) => row.eventType === "rotation.failed");
    expect(failed).toBeDefined();
    // Stated in the row: the next operator to read this needs to know whether
    // they are looking at a recoverable interruption or a disaster.
    expect((failed?.metadata as Record<string, unknown> | undefined)?.["resumable"]).toBe(true);
  });

  it("leaves no checkpoint event for a batch that rolled back", async () => {
    await seed(2);
    const rows = await handle.db.select().from(schema.protectedEnvelopes).limit(1);
    await handle.db
      .update(schema.protectedEnvelopes)
      .set({ ciphertext: "AAAA" })
      .where(eq(schema.protectedEnvelopes.id, rows[0]?.id ?? ""));

    await rotationDataKeyCommand(command(["--yes"]), deps({ batchSize: 2 }), { execute: true });

    const checkpoints = (await events()).filter((row) => row.eventType === "rotation.checkpoint");
    // The whole batch rolled back, so its checkpoint must have rolled back
    // with it. A surviving row would claim progress that did not happen — and
    // a resume would trust it.
    expect(checkpoints).toHaveLength(0);
    expect(await handle.db.select().from(schema.rotationCheckpoints)).toHaveLength(0);
  });
});

describe("what the trail must never contain", () => {
  it("holds no key material in any encoding", async () => {
    await seed(3);
    await rotationDataKeyCommand(command(["--yes"]), deps({ batchSize: 1 }), { execute: true });

    const serialized = JSON.stringify(await events());
    for (const encoding of ["base64", "base64url", "hex"] as const) {
      expect(serialized).not.toContain(KEY.toString(encoding));
    }
  });

  it("holds no plaintext from the records it rewrote", async () => {
    await seed(2);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const serialized = JSON.stringify(await events());
    // The rotation decrypts every record on its way through. That plaintext
    // must never reach a row that exists to be read by an operator later.
    expect(serialized).not.toContain("secret 0");
    expect(serialized).not.toContain("secret 1");
  });
});

describe("auditing is optional", () => {
  it("rotates normally with no journal wired", async () => {
    await seed(2);
    const result = await rotationDataKeyCommand(
      command(["--yes"]),
      { ...deps(), audit: undefined },
      { execute: true },
    );
    // A rotation must not fail for want of a logger, and a unit test must not
    // have to build an audit context to drive one.
    expect(result.code, result.message).toBe(0);
    expect(await events()).toHaveLength(0);
  });
});
