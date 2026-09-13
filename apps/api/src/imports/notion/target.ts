import { ContentStore, PartialUploadStore } from "@myownnotion/blob-store";
import {
  createDatabase,
  migrationInventory,
  schema,
  type Transaction,
} from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { assertFullRestoreActivated } from "../../backup/full/restore-state.ts";
import { FullBackupService } from "../../backup/full/service.ts";
import type { AppContext } from "../../context.ts";
import { createProtectedFileRuntime } from "../../files/protected-file-runtime.ts";
import { AuditService } from "../../security/audit-service.ts";
import { loadDeploymentKey } from "../../security/deployment-key.ts";
import { RotationPolicyService } from "../../security/rotation-policy-service.ts";
import { NotionImportError } from "./source.ts";

export interface NotionTargetOptions {
  connectionString: string;
  blobRoot: string;
  keyFile: string;
  backupRoot: string;
}
export async function openNotionTarget(options: NotionTargetOptions) {
  await assertFullRestoreActivated(options.blobRoot);
  const database = createDatabase(options.connectionString);
  try {
    const inventory = await migrationInventory(options.connectionString);
    if (inventory.pending.length) throw new NotionImportError("import.pending-migrations");
    const [installation] = await database.db.select().from(schema.installations).limit(1);
    if (installation?.state !== "ready" || !installation.ownerId || !installation.workspaceId)
      throw new NotionImportError("import.target-not-ready");
    const [workspace] = await database.db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, installation.workspaceId));
    if (!workspace) throw new NotionImportError("import.target-not-ready");
    const key = () => Buffer.from(loadDeploymentKey(options.keyFile).bytes);
    const runtime = createProtectedFileRuntime({
      db: database.db,
      journalDb: database.journalDb,
      workspaceId: installation.workspaceId,
      installationId: installation.id,
      blobRoot: options.blobRoot,
      deploymentKey: key,
    });
    const policies = new RotationPolicyService({
      db: database.db,
      installationId: installation.id,
      now: () => new Date(),
    });
    const audit = new AuditService(database.db);
    const context: AppContext = {
      db: database.db,
      workspaceId: installation.workspaceId as Uuid,
      schemaVersion: workspace.schemaVersion,
      contentStore: new ContentStore(runtime.blobs),
      partialUploads: new PartialUploadStore(options.blobRoot),
      protectedContent: runtime.content,
      protectedFiles: runtime.files,
      rotationPolicies: policies,
    };
    const ready = async (tx: Transaction) => {
      await assertFullRestoreActivated(options.blobRoot);
      const [current] = await tx
        .select()
        .from(schema.installations)
        .where(eq(schema.installations.id, installation.id));
      const [owner] = await tx
        .select()
        .from(schema.owners)
        .where(eq(schema.owners.id, installation.ownerId ?? ""));
      if (
        current?.state !== "ready" ||
        current.workspaceId !== context.workspaceId ||
        owner?.state !== "active"
      )
        throw new NotionImportError("import.target-not-ready");
      await runtime.keys.dataKey(tx, { writable: true });
      await policies.assertWritesAllowed(tx);
    };
    const backups = new FullBackupService({
      connectionString: options.connectionString,
      blobRoot: options.blobRoot,
      backupRoot: options.backupRoot,
      key,
    });
    return {
      database,
      context,
      runtime,
      audit,
      installationId: installation.id,
      ready,
      backup: async () => (await backups.run("manual")).receipt,
      close: () => database.close(),
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}
export type NotionTarget = Awaited<ReturnType<typeof openNotionTarget>>;
