/**
 * Wrapping-key rotation, end to end (T083, US5, FR-017, FR-025, FR-027).
 *
 * One property is worth more than every other test in this file:
 *
 * **A record sealed before the rotation opens after it, under the new key, and
 * only under the new key.**
 *
 * That single assertion catches nearly everything a wrong implementation does.
 * A rotation that rewrapped nothing passes a "no error" test and fails this
 * one. A rotation that re-derived the root key instead of rewrapping it makes
 * the old records unreadable and fails this one. A rotation that left some
 * workspace behind fails this one for that workspace.
 *
 * The rest of the file is about interruption, because a rotation that works
 * when nothing goes wrong is not the interesting case. What matters is that
 * stopping halfway leaves an installation that is still readable, still
 * resumable, and honest about which state it is in.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  findCurrentWrappingKeyVersion,
  findRotationPolicy,
  findRunningRotation,
  findWrappingKeyVersion,
  schema,
} from "@myownnotion/database";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXIT_CODES } from "../src/admin/command-output.ts";
import { parseCommand } from "../src/admin/command-parser.ts";
import { rotationWrappingKeyCommand } from "../src/admin/commands/rotation-wrapping-key.ts";
import { KeyHierarchy } from "../src/security/key-hierarchy.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;
let keyDirectory: string;
let currentKeyFile: string;
let nextKeyFile: string;
let currentKeyBytes: Buffer;
let nextKeyBytes: Buffer;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const OTHER_WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000bb";
const NOW = new Date("2026-09-01T00:00:00.000Z");
const SECRET = "the safe combination is 19-04-77";

const bytes = (value: string) => new Uint8Array(Buffer.from(value, "utf8"));
const text = (value: Uint8Array) => Buffer.from(value).toString("utf8");

/** A hierarchy bound to one workspace, reading whichever key is passed. */
function hierarchyWith(key: Buffer, workspaceId = WORKSPACE_ID): KeyHierarchy {
  return new KeyHierarchy({
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId,
    deploymentKey: () => key,
    now: () => NOW,
  });
}

function recordsWith(keys: KeyHierarchy, workspaceId = WORKSPACE_ID): ProtectedRecordService {
  return new ProtectedRecordService({
    db: handle.db,
    keys,
    installationId: INSTALLATION_ID,
    workspaceId,
    now: () => NOW,
  });
}

function deps(overrides: { deploymentKeyFile?: string | undefined } = {}) {
  return {
    db: handle.db,
    installationId: INSTALLATION_ID,
    deploymentKeyFile:
      "deploymentKeyFile" in overrides ? overrides.deploymentKeyFile : currentKeyFile,
    now: () => new Date(),
    // The fixtures live in a temp directory whose mode the test controls; the
    // permission rule itself is covered by the deployment-key tests.
    enforceKeyPermissions: false,
  };
}

function command(argv: string[]) {
  return parseCommand(["security", "rotation", "wrapping-key", ...argv]);
}

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-wrap-rot-"));
  currentKeyFile = path.join(keyDirectory, "current-key");
  nextKeyFile = path.join(keyDirectory, "next-key");
  currentKeyBytes = randomBytes(32);
  nextKeyBytes = randomBytes(32);
  writeFileSync(currentKeyFile, currentKeyBytes.toString("base64"), { mode: 0o600 });
  writeFileSync(nextKeyFile, nextKeyBytes.toString("base64"), { mode: 0o600 });
}, 180_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
  rmSync(keyDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  await handle.db.execute(sql`
    TRUNCATE rotation_checkpoints, rotation_operations, rotation_policies,
      protected_envelopes, data_key_generations, workspace_root_keys,
      wrapping_key_versions, installations CASCADE
  `);
  await createInstallation(handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  await handle.db.insert(schema.rotationPolicies).values({
    id: randomUUID(),
    installationId: INSTALLATION_ID,
    kind: "wrapping-key",
    mode: "scheduled",
    dueIntervalDays: 365,
    dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    writeBlockAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    currentGeneration: 1,
    state: "due",
  });
});

/** Establishes a workspace and seals one record in it. */
async function sealRecord(workspaceId: string, payload: string): Promise<string> {
  const keys = hierarchyWith(currentKeyBytes, workspaceId);
  await handle.db.transaction(async (tx) => {
    await keys.initialize(tx);
  });
  const recordId = randomUUID();
  await handle.db.transaction(async (tx) => {
    await recordsWith(keys, workspaceId).write(tx, {
      entityType: "item",
      entityId: recordId,
      recordVersion: 1,
      payload: bytes(payload),
    });
  });
  return recordId;
}

async function readRecord(key: Buffer, workspaceId: string, recordId: string): Promise<string> {
  const keys = hierarchyWith(key, workspaceId);
  const opened = await recordsWith(keys, workspaceId).read(handle.db, {
    entityType: "item",
    entityId: recordId,
  });
  return opened === null ? "" : text(opened);
}

describe("what a completed rotation guarantees", () => {
  it("keeps a record sealed before the rotation readable under the new key alone", async () => {
    const recordId = await sealRecord(WORKSPACE_ID, SECRET);

    const result = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--yes"]),
      deps(),
      { execute: true },
    );
    expect(result.code, result.message).toBe(EXIT_CODES.ok);

    // The point of the whole feature: the record is untouched, and the new key
    // reaches it through a root key that was rewrapped rather than replaced.
    expect(await readRecord(nextKeyBytes, WORKSPACE_ID, recordId)).toBe(SECRET);

    // And the old key no longer opens anything. A rotation after which the
    // retired key still works has not reduced anyone's exposure.
    await expect(readRecord(currentKeyBytes, WORKSPACE_ID, recordId)).rejects.toThrow();
  });

  it("leaves the sealed ciphertext byte-for-byte unchanged", async () => {
    const recordId = await sealRecord(WORKSPACE_ID, SECRET);
    const before = await handle.db
      .select()
      .from(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityId, recordId));

    await rotationWrappingKeyCommand(command(["--new-key-file", nextKeyFile, "--yes"]), deps(), {
      execute: true,
    });

    const after = await handle.db
      .select()
      .from(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityId, recordId));
    // This is the economy the four-level hierarchy buys. If a rotation rewrote
    // envelopes, rotating a large installation would take hours and would have
    // a window where records are half-rotated.
    expect(after[0]?.ciphertext).toEqual(before[0]?.ciphertext);
  });

  it("rewraps every workspace, not only the first", async () => {
    const first = await sealRecord(WORKSPACE_ID, SECRET);
    const second = await sealRecord(OTHER_WORKSPACE_ID, "a different secret");

    const result = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--yes"]),
      deps(),
      { execute: true },
    );
    expect(result.data?.["rewrappedWorkspaces"]).toBe(2);
    expect(await readRecord(nextKeyBytes, WORKSPACE_ID, first)).toBe(SECRET);
    expect(await readRecord(nextKeyBytes, OTHER_WORKSPACE_ID, second)).toBe("a different secret");
  });

  it("promotes the new version and retires the old one", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    await rotationWrappingKeyCommand(command(["--new-key-file", nextKeyFile, "--yes"]), deps(), {
      execute: true,
    });

    const current = await findCurrentWrappingKeyVersion(handle.db, INSTALLATION_ID);
    expect(current?.version).toBe(2);
    const previous = await findWrappingKeyVersion(handle.db, {
      installationId: INSTALLATION_ID,
      version: 1,
    });
    // `previous`, not `revoked`: the row is the record that the rotation
    // happened, and an operator reading it later needs to see a retired
    // version rather than a repudiated one.
    expect(previous?.state).toBe("previous");
  });

  it("schedules the next rotation and clears the running operation", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    await rotationWrappingKeyCommand(command(["--new-key-file", nextKeyFile, "--yes"]), deps(), {
      execute: true,
    });

    const policy = await findRotationPolicy(handle.db, {
      installationId: INSTALLATION_ID,
      kind: "wrapping-key",
    });
    expect(policy?.state).toBe("complete");
    expect(policy?.dueAt.getTime()).toBeGreaterThan(Date.now());
    expect(
      await findRunningRotation(handle.db, {
        installationId: INSTALLATION_ID,
        kind: "wrapping-key",
      }),
    ).toBeNull();
  });
});

describe("the dry run", () => {
  it("reports the work and changes nothing", async () => {
    const recordId = await sealRecord(WORKSPACE_ID, SECRET);

    const result = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--dry-run"]),
      deps(),
      { execute: false },
    );

    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.data?.["wouldRewrapWorkspaces"]).toBe(1);
    expect(result.data?.["toVersion"]).toBe(2);
    // Still on version one, still opening under the old key: an operator who
    // previews a rotation has not performed one.
    expect((await findCurrentWrappingKeyVersion(handle.db, INSTALLATION_ID))?.version).toBe(1);
    expect(await readRecord(currentKeyBytes, WORKSPACE_ID, recordId)).toBe(SECRET);
  });

  it("reports the new key's fingerprint without the key", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    const result = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--dry-run"]),
      deps(),
      { execute: false },
    );

    const fingerprint = String(result.data?.["newKeyFingerprint"]);
    expect(fingerprint.length).toBeGreaterThan(0);
    // The fingerprint is what confirms *which* file was mounted. It must not
    // be the file's contents in any encoding.
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain(nextKeyBytes.toString("base64"));
    expect(serialized).not.toContain(nextKeyBytes.toString("hex"));
  });
});

describe("refusals", () => {
  it("refuses the currently mounted key as the new key", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    await expect(
      rotationWrappingKeyCommand(command(["--new-key-file", currentKeyFile, "--yes"]), deps(), {
        execute: true,
      }),
    ).rejects.toThrow(/must differ/);
  });

  it("refuses when no deployment key is configured", async () => {
    const result = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--yes"]),
      deps({ deploymentKeyFile: undefined }),
      { execute: true },
    );
    // The current key is what unwraps. Without it a "rotation" would be a
    // request to overwrite readable rows with unreadable ones.
    expect(result.code).toBe(EXIT_CODES.keyUnavailable);
  });

  it("refuses an unreadable new key without starting anything", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    const result = await rotationWrappingKeyCommand(
      command(["--new-key-file", path.join(keyDirectory, "absent"), "--yes"]),
      deps(),
      { execute: true },
    );
    expect(result.code).toBe(EXIT_CODES.keyUnavailable);
    expect((await findCurrentWrappingKeyVersion(handle.db, INSTALLATION_ID))?.version).toBe(1);
    expect(
      await findRunningRotation(handle.db, {
        installationId: INSTALLATION_ID,
        kind: "wrapping-key",
      }),
    ).toBeNull();
  });

  it("refuses without a configured policy", async () => {
    await handle.db.execute(sql`TRUNCATE rotation_policies CASCADE`);
    await sealRecord(WORKSPACE_ID, SECRET);
    const result = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--yes"]),
      deps(),
      { execute: true },
    );
    expect(result.code).toBe(EXIT_CODES.refused);
  });

  it("requires --new-key-file", async () => {
    await expect(
      rotationWrappingKeyCommand(command(["--yes"]), deps(), { execute: true }),
    ).rejects.toThrow(/--new-key-file is required/);
  });
});

describe("interruption", () => {
  it("resumes a failed rotation towards the same version and finishes it", async () => {
    // This is the case that a rotation driven by its *operation* rather than
    // by its rows gets wrong. The first attempt rewraps one workspace and
    // fails on the other. A resume that started fresh would target a third
    // version and try to unwrap the already-rewrapped row with the old key,
    // which cannot open it — turning a recoverable interruption into a
    // permanently half-rotated installation.
    const first = await sealRecord(WORKSPACE_ID, SECRET);
    const second = await sealRecord(OTHER_WORKSPACE_ID, "a different secret");

    const intact = await handle.db
      .select()
      .from(schema.workspaceRootKeys)
      .where(eq(schema.workspaceRootKeys.workspaceId, OTHER_WORKSPACE_ID));
    const original = intact[0];
    expect(original).toBeDefined();

    // Break the second workspace's root key so the first attempt stops there.
    await handle.db
      .update(schema.workspaceRootKeys)
      .set({ wrappedRootKey: "AAAA.BBBB.CCCC" })
      .where(eq(schema.workspaceRootKeys.workspaceId, OTHER_WORKSPACE_ID));

    const failed = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--yes"]),
      deps(),
      { execute: true },
    );
    expect(failed.code).toBe(EXIT_CODES.integrityFailure);
    expect(failed.data?.["resumable"]).toBe(true);

    // Repair the row and resume with the same pair of key files.
    await handle.db
      .update(schema.workspaceRootKeys)
      .set({ wrappedRootKey: original?.wrappedRootKey ?? "" })
      .where(eq(schema.workspaceRootKeys.workspaceId, OTHER_WORKSPACE_ID));

    const resumed = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--yes"]),
      deps(),
      { execute: true },
    );
    expect(resumed.code, resumed.message).toBe(EXIT_CODES.ok);
    // Version two, not three: the resume adopted the version the failed
    // attempt had already started rewrapping towards.
    expect(resumed.data?.["toVersion"]).toBe(2);
    expect((await findCurrentWrappingKeyVersion(handle.db, INSTALLATION_ID))?.version).toBe(2);
    expect(await readRecord(nextKeyBytes, WORKSPACE_ID, first)).toBe(SECRET);
    expect(await readRecord(nextKeyBytes, OTHER_WORKSPACE_ID, second)).toBe("a different secret");
  });

  it("keeps the failed attempt in the operation history", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    await handle.db
      .update(schema.workspaceRootKeys)
      .set({ wrappedRootKey: "AAAA.BBBB.CCCC" })
      .where(eq(schema.workspaceRootKeys.workspaceId, WORKSPACE_ID));
    await rotationWrappingKeyCommand(command(["--new-key-file", nextKeyFile, "--yes"]), deps(), {
      execute: true,
    });

    const operations = await handle.db.select().from(schema.rotationOperations);
    // The failed attempt stays. Overwriting it on a resume would erase the
    // record that an attempt failed, which is exactly what an operator asks
    // about after an interruption.
    expect(operations).toHaveLength(1);
    expect(operations[0]?.phase).toBe("failed");
  });

  it("records one checkpoint per rewrapped workspace", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    await sealRecord(OTHER_WORKSPACE_ID, "a different secret");

    await rotationWrappingKeyCommand(command(["--new-key-file", nextKeyFile, "--yes"]), deps(), {
      execute: true,
    });

    const checkpoints = await handle.db.select().from(schema.rotationCheckpoints);
    // Append-only, one per workspace, in sequence: this is what makes an
    // interrupted rotation resumable rather than merely restartable.
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints.map((row) => row.sequence).sort()).toEqual([1, 2]);
    expect(new Set(checkpoints.map((row) => row.cursor)).size).toBe(2);
  });

  it("marks the operation failed without moving the due date", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    const before = await findRotationPolicy(handle.db, {
      installationId: INSTALLATION_ID,
      kind: "wrapping-key",
    });

    // A root key row whose ciphertext the current key cannot open: the rewrap
    // must fail rather than write something derived from garbage.
    await handle.db
      .update(schema.workspaceRootKeys)
      .set({ wrappedRootKey: "AAAA.BBBB.CCCC" })
      .where(eq(schema.workspaceRootKeys.workspaceId, WORKSPACE_ID));

    const result = await rotationWrappingKeyCommand(
      command(["--new-key-file", nextKeyFile, "--yes"]),
      deps(),
      { execute: true },
    );

    expect(result.code).toBe(EXIT_CODES.integrityFailure);
    expect(result.data?.["resumable"]).toBe(true);
    const after = await findRotationPolicy(handle.db, {
      installationId: INSTALLATION_ID,
      kind: "wrapping-key",
    });
    expect(after?.state).toBe("failed");
    // Unchanged, deliberately. A failed attempt rotated nothing, so nothing
    // about *when* the key must be rotated has changed; extending the deadline
    // would let a repeatedly failing installation postpone the block forever.
    expect(after?.dueAt.getTime()).toBe(before?.dueAt.getTime());
    expect(after?.writeBlockAt.getTime()).toBe(before?.writeBlockAt.getTime());
  });

  it("keeps version one current when the rotation fails", async () => {
    await sealRecord(WORKSPACE_ID, SECRET);
    await handle.db
      .update(schema.workspaceRootKeys)
      .set({ wrappedRootKey: "AAAA.BBBB.CCCC" })
      .where(eq(schema.workspaceRootKeys.workspaceId, WORKSPACE_ID));

    await rotationWrappingKeyCommand(command(["--new-key-file", nextKeyFile, "--yes"]), deps(), {
      execute: true,
    });

    // The promotion happens only after every workspace is rewrapped. A failed
    // rotation that promoted anyway would leave new writes referencing a
    // version some root key is not wrapped under.
    expect((await findCurrentWrappingKeyVersion(handle.db, INSTALLATION_ID))?.version).toBe(1);
  });
});
