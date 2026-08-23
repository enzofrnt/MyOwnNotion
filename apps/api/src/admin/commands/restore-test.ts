/** A real restoration in a disposable database, needing no confirmation (T032). */

import { randomBytes } from "node:crypto";
import { ContentStore, FilesystemBlobStore } from "@myownnotion/blob-store";
import { createInstallation, getOrCreateWorkspace, schema } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { decodeBackupArchive } from "../../backup/archive-format.ts";
import { createDatabaseRestoreTarget } from "../../backup/database-restore-target.ts";
import { createDisposableWorkspace } from "../../backup/disposable-workspace.ts";
import {
  pageOperationArchiveDeviceReferences,
  readPageOperationArchive,
} from "../../backup/page-operation-archive.ts";
import { applyArchive } from "../../backup/restore-service.ts";
import { PageOperationCrypto } from "../../page-state/page-operation-crypto.ts";
import {
  createProtectedContentRuntime,
  INSTALLATION_ID,
} from "../../security/protected-content-runtime.ts";
import type { CommandResult } from "../command-output.ts";
import { type RestoreRunnerDeps, runRestore } from "./restore-runner.ts";

export interface RestoreTestDeps extends RestoreRunnerDeps {
  readonly databaseUrl: string;
  readonly deploymentKey?: () => Buffer;
}

export async function restoreTestCommand(
  deps: RestoreTestDeps,
  selector: { readonly id?: string; readonly latest?: boolean },
): Promise<CommandResult> {
  return await runRestore(deps, {
    selector,
    kind: "test",
    dryRun: false,
    showScope: () => true,
    safetyBackup: async () => null,
    confirm: () => false,
    apply: async (archive) => {
      const rehearsal = await createDisposableWorkspace(deps.databaseUrl);
      try {
        const workspace = await getOrCreateWorkspace(rehearsal.handle.db);
        await createInstallation(rehearsal.handle.db, {
          id: INSTALLATION_ID,
          sourceLineageId: INSTALLATION_ID,
          schemaVersion: workspace.schemaVersion,
        });
        const ownerId = generateUuidV7();
        await rehearsal.handle.db.insert(schema.owners).values({
          id: ownerId,
          installationId: INSTALLATION_ID,
          state: "active",
        });
        await rehearsal.handle.db
          .update(schema.installations)
          .set({ state: "ready", ownerId, workspaceId: workspace.id })
          .where(eq(schema.installations.id, INSTALLATION_ID));

        const decoded = decodeBackupArchive(archive);
        if (decoded.operationalState !== null) {
          const operational = readPageOperationArchive(JSON.parse(decoded.operationalState));
          const devices = pageOperationArchiveDeviceReferences(operational);
          if (devices.length > 0) {
            await rehearsal.handle.db.insert(schema.authorizedDevices).values(
              devices.map((device) => ({
                id: device.id,
                ownerId,
                deviceBindingId: `restore-rehearsal-${device.id}`,
                name: "Restored device reference",
                state: device.state,
                ...(device.state === "revoked" ? { revokedAt: new Date() } : {}),
              })),
            );
          }
        }
        const rehearsalDeploymentKey = deps.deploymentKey?.() ?? randomBytes(32);
        const protectedRuntime = createProtectedContentRuntime({
          db: rehearsal.handle.db,
          workspaceId: workspace.id,
          deploymentKey: () => rehearsalDeploymentKey,
        });
        const pageOperationCrypto = new PageOperationCrypto(protectedRuntime.records);
        const contentStore = new ContentStore(new FilesystemBlobStore(rehearsal.blobRoot));
        return await rehearsal.handle.db.transaction(async (tx) =>
          applyArchive(
            archive,
            createDatabaseRestoreTarget({
              tx,
              workspaceId: workspace.id,
              contentStore,
              protectedContent: protectedRuntime.content,
              pageOperationCrypto,
            }),
          ),
        );
      } finally {
        await rehearsal.release();
      }
    },
  });
}
