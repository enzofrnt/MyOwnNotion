/** A committed backup remains restorable across every format/schema path we support. */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ContentStore, FilesystemBlobStore } from "@myownnotion/blob-store";
import { createInstallation, getOrCreateWorkspace, schema } from "@myownnotion/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectBackupArchive } from "../../../apps/api/src/backup/archive-format.ts";
import { createDatabaseRestoreTarget } from "../../../apps/api/src/backup/database-restore-target.ts";
import { createDisposableWorkspace } from "../../../apps/api/src/backup/disposable-workspace.ts";
import { applyArchive, preflight } from "../../../apps/api/src/backup/restore-service.ts";
import { createProtectedContentRuntime } from "../../../apps/api/src/security/protected-content-runtime.ts";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

const REFERENCE_BACKUPS = [
  {
    file: "v1-schema1.tar",
    schemaVersion: 1,
    recordFormatVersion: 1,
    itemNames: ["Reference folder", "Reference page", "reference.txt"],
  },
] as const;

let context: IntegrationContext;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

describe.each(REFERENCE_BACKUPS)("reference backup $file", (reference) => {
  it("passes compatibility checks and restores all canonical content", async () => {
    const archive = readFileSync(
      path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "tests",
        "fixtures",
        "backups",
        reference.file,
      ),
    );
    const inspected = inspectBackupArchive(archive);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) {
      return;
    }
    expect(inspected.manifest).toMatchObject({
      schemaVersion: reference.schemaVersion,
      recordFormatVersion: reference.recordFormatVersion,
    });
    const checked = await preflight({
      openArchive: async () => archive,
      installation: { schemaVersion: 1, recordFormatVersion: 1 },
      showScope: () => true,
      safetyBackup: async () => null,
      confirm: () => false,
      kind: "test",
    });
    expect(checked.ok).toBe(true);

    const restored = await createDisposableWorkspace(context.postgres.connectionString);
    try {
      const workspace = await getOrCreateWorkspace(restored.handle.db);
      const installationId = "018f2b7c-2000-7000-8000-000000000001";
      await createInstallation(restored.handle.db, {
        id: installationId,
        sourceLineageId: installationId,
        schemaVersion: workspace.schemaVersion,
      });
      const deploymentKey = randomBytes(32);
      const protectedContent = createProtectedContentRuntime({
        db: restored.handle.db,
        installationId,
        workspaceId: workspace.id,
        deploymentKey: () => deploymentKey,
      }).content;
      const contentStore = new ContentStore(new FilesystemBlobStore(restored.blobRoot));
      const result = await restored.handle.db.transaction(async (tx) =>
        applyArchive(
          archive,
          createDatabaseRestoreTarget({
            tx,
            workspaceId: workspace.id,
            contentStore,
            protectedContent,
          }),
        ),
      );
      expect(result).toEqual({ restoredItemCount: 3, restoredFileCount: 1 });
      const names = (
        await restored.handle.db.select({ name: schema.items.name }).from(schema.items)
      )
        .map((row) => row.name)
        .sort();
      expect(names).toEqual([...reference.itemNames].sort());
      expect(await restored.handle.db.select().from(schema.relationships)).toHaveLength(1);
      expect(await restored.handle.db.select().from(schema.revisions)).toHaveLength(3);
      expect(await restored.handle.db.select().from(schema.logicalFiles)).toHaveLength(1);
      // Three titles, one page body, one relationship metadata object. A live
      // restore must not bring readable content back without recreating the
      // protected copies that the secured read path prefers.
      expect(await restored.handle.db.select().from(schema.protectedEnvelopes)).toHaveLength(5);
    } finally {
      await restored.release();
    }
  });
});
