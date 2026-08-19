/** The destructive restoration command, with simulation and explicit consent (T028). */

import type { ContentStore } from "@myownnotion/blob-store";
import {
  clearWorkspaceForRestore,
  createDatabaseRestoreTarget,
} from "../../backup/database-restore-target.ts";
import { applyArchive, type RestoreScope } from "../../backup/restore-service.ts";
import type { ProtectedContent } from "../../security/protected-content.ts";
import type { CommandResult } from "../command-output.ts";
import { type RestoreRunnerDeps, runRestore } from "./restore-runner.ts";

export interface RestoreApplyDeps extends RestoreRunnerDeps {
  readonly contentStore: ContentStore;
  readonly protectedContent?: ProtectedContent;
  readonly safetyBackup: () => Promise<string | null>;
}

export async function restoreApplyCommand(
  deps: RestoreApplyDeps,
  options: {
    readonly id: string;
    readonly dryRun: boolean;
    readonly yes: boolean;
    readonly terminalAvailable: boolean;
    readonly askForConfirmation?: (scope: RestoreScope) => Promise<boolean> | boolean;
  },
): Promise<CommandResult> {
  let shownScope: RestoreScope | null = null;
  return await runRestore(deps, {
    selector: { id: options.id },
    kind: "destructive",
    dryRun: options.dryRun,
    showScope: (scope) => {
      shownScope = scope;
      return true;
    },
    safetyBackup: deps.safetyBackup,
    confirm: async () => {
      if (options.yes) {
        return true;
      }
      if (
        !options.terminalAvailable ||
        options.askForConfirmation === undefined ||
        shownScope === null
      ) {
        return false;
      }
      return await options.askForConfirmation(shownScope);
    },
    apply: async (archive) =>
      deps.db.transaction(async (tx) => {
        await clearWorkspaceForRestore(tx, deps.workspaceId);
        return await applyArchive(
          archive,
          createDatabaseRestoreTarget({
            tx,
            workspaceId: deps.workspaceId,
            contentStore: deps.contentStore,
            ...(deps.protectedContent === undefined
              ? {}
              : { protectedContent: deps.protectedContent }),
          }),
        );
      }),
  });
}
