/** The read-only update diagnosis names every fact an operator needs (T036, T041). */

import {
  backupsWithVerification,
  createInstallation,
  recordApplicationUpdate,
  recordBackup,
  recordInitialApplicationVersion,
  recordVerification,
  schema,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { versionInspectCommand } from "../src/admin/commands/version-inspect.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";

beforeAll(async () => {
  harness = await createApiHarness();
  await createInstallation(harness.built.context.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: harness.built.context.schemaVersion,
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

describe("version inspect", () => {
  it("reports both versions, pending migrations and a matching verified backup", async () => {
    await recordInitialApplicationVersion(harness.built.context.db, {
      installationId: INSTALLATION_ID,
      applicationVersion: "0.1.0",
    });
    const backupId = generateUuidV7();
    await recordBackup(harness.built.context.db, {
      id: backupId,
      workspaceId: harness.built.context.workspaceId,
      cursor: "12",
      applicationVersion: "0.1.0",
      schemaVersion: 1,
      recordFormatVersion: 1,
      byteLength: 128,
      digest: `sha256:${"a".repeat(64)}`,
      reason: "pre-update",
      destination: "filesystem",
      remoteName: "version-inspect.bin",
    });
    await recordVerification(harness.built.context.db, {
      id: generateUuidV7(),
      backupId,
      stage: "after-transfer",
      outcome: "passed",
    });
    expect(await harness.built.context.db.select().from(schema.backupVerifications)).toEqual([
      expect.objectContaining({ backupId, stage: "after-transfer", outcome: "passed" }),
    ]);
    expect(
      await backupsWithVerification(harness.built.context.db, harness.built.context.workspaceId),
    ).toEqual([
      expect.objectContaining({
        id: backupId,
        applicationVersion: "0.1.0",
        verifiedAtDestination: true,
      }),
    ]);

    const result = await versionInspectCommand({
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      runningVersion: "0.2.0",
      pendingMigrations: ["0007_example"],
    });

    expect(result.code).toBe(0);
    expect(result.data).toMatchObject({
      runningApplicationVersion: "0.2.0",
      recordedApplicationVersion: "0.1.0",
      schemaVersion: 1,
      migrationPending: true,
      pendingMigrations: ["0007_example"],
      verifiedBackupForRecordedVersion: true,
    });

    await recordApplicationUpdate(harness.built.context.db, {
      installationId: INSTALLATION_ID,
      from: "0.1.0",
      to: "sha-current",
      backupId,
      schemaVersion: 1,
    });
    const rollback = await versionInspectCommand({
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      runningVersion: "sha-current",
      pendingMigrations: [],
    });
    expect(rollback.data).toMatchObject({
      previousApplicationVersion: "0.1.0",
      previousImageTag: "0.1.0",
      previousBackupId: backupId,
      previousSchemaVersion: 1,
      previousRecordFormatVersion: 1,
    });
  });

  it("still exits successfully when there is no pending migration or backup", async () => {
    const result = await versionInspectCommand({
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      runningVersion: "sha-current",
      pendingMigrations: [],
    });
    expect(result.code).toBe(0);
    expect(result.data).toMatchObject({
      migrationPending: false,
      pendingMigrations: [],
    });
  });
});
