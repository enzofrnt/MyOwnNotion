/** A real restoration in a disposable database, needing no confirmation (T032). */

import { ContentStore, FilesystemBlobStore } from "@myownnotion/blob-store";
import { getOrCreateWorkspace } from "@myownnotion/database";
import { createDatabaseRestoreTarget } from "../../backup/database-restore-target.ts";
import { createDisposableWorkspace } from "../../backup/disposable-workspace.ts";
import { applyArchive } from "../../backup/restore-service.ts";
import type { CommandResult } from "../command-output.ts";
import { type RestoreRunnerDeps, runRestore } from "./restore-runner.ts";

export interface RestoreTestDeps extends RestoreRunnerDeps {
  readonly databaseUrl: string;
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
        const contentStore = new ContentStore(new FilesystemBlobStore(rehearsal.blobRoot));
        return await rehearsal.handle.db.transaction(async (tx) =>
          applyArchive(
            archive,
            createDatabaseRestoreTarget({ tx, workspaceId: workspace.id, contentStore }),
          ),
        );
      } finally {
        await rehearsal.release();
      }
    },
  });
}
