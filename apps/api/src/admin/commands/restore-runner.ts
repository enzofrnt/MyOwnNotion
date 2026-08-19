/** Shared, recorded restoration orchestration (T026, T028, T032). */

import { createHash, randomUUID } from "node:crypto";
import {
  backupsWithVerification,
  type Database,
  finishRestoration,
  startRestoration,
} from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import type { BackupDestination } from "../../backup/destinations/destination.ts";
import { preflight, type RestoreResult, type RestoreScope } from "../../backup/restore-service.ts";
import { type CommandResult, EXIT_CODES } from "../command-output.ts";

export interface RestoreRunnerDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly destination: BackupDestination;
  readonly open: (ciphertext: Buffer) => Promise<Buffer>;
  readonly installation: { readonly schemaVersion: number; readonly recordFormatVersion: number };
  readonly now?: () => Date;
}

export interface RestoreRunOptions {
  readonly selector: { readonly id?: string; readonly latest?: boolean };
  readonly kind: "test" | "destructive";
  readonly dryRun: boolean;
  readonly showScope: (scope: RestoreScope) => Promise<boolean> | boolean;
  readonly safetyBackup: () => Promise<string | null>;
  readonly confirm: () => Promise<boolean> | boolean;
  readonly apply: (archive: Buffer) => Promise<RestoreResult>;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

export async function runRestore(
  deps: RestoreRunnerDeps,
  options: RestoreRunOptions,
): Promise<CommandResult> {
  const backups = await backupsWithVerification(deps.db, deps.workspaceId);
  const selected =
    options.selector.id !== undefined
      ? backups.find((backup) => backup.id === options.selector.id)
      : options.selector.latest === true
        ? backups.find((backup) => backup.verifiedAtDestination)
        : undefined;
  if (selected === undefined) {
    return { code: EXIT_CODES.usage, message: "no such backup" };
  }
  if (!selected.verifiedAtDestination || selected.remoteName === null) {
    return {
      code: EXIT_CODES.refused,
      message: "that backup was not verified at its destination and will not be restored",
      data: { backupId: selected.id },
    };
  }

  const stored = await deps.destination.read(selected.remoteName);
  if (stored === null) {
    return {
      code: EXIT_CODES.integrityFailure,
      message: "the destination no longer holds that backup",
      data: { backupId: selected.id },
    };
  }
  const ciphertext = await readAll(stored);
  const storedDigest = `sha256:${createHash("sha256").update(ciphertext).digest("hex")}`;
  if (ciphertext.byteLength !== selected.byteLength || storedDigest !== selected.digest) {
    return {
      code: EXIT_CODES.integrityFailure,
      message: "the backup at the destination does not match its recorded size and digest",
      data: { backupId: selected.id },
    };
  }
  let opened: Buffer | null = null;
  try {
    opened = await deps.open(ciphertext);
  } catch {
    // `preflight` owns the safe explanation and its exit-code mapping below.
    opened = null;
  }

  const attemptId = randomUUID() as Uuid;
  if (!options.dryRun) {
    await startRestoration(deps.db, {
      id: attemptId,
      backupId: selected.id,
      kind: options.kind,
      startedAt: (deps.now ?? (() => new Date()))(),
    });
  }

  let scope: RestoreScope | null = null;
  try {
    const checked = await preflight({
      openArchive: async () => opened,
      installation: deps.installation,
      showScope: async (next) => {
        scope = next;
        return await options.showScope(next);
      },
      safetyBackup: options.dryRun ? async () => "dry-run-safety-backup" : options.safetyBackup,
      confirm: options.dryRun ? () => true : options.confirm,
      kind: options.kind,
    });
    if (!checked.ok) {
      if (!options.dryRun) {
        await finishRestoration(deps.db, {
          id: attemptId,
          outcome: "failed",
          detail: checked.reason,
          finishedAt: (deps.now ?? (() => new Date()))(),
        });
      }
      const code =
        checked.failedAt === "key-access"
          ? EXIT_CODES.keyUnavailable
          : checked.failedAt === "archive-integrity"
            ? EXIT_CODES.integrityFailure
            : EXIT_CODES.refused;
      return {
        code,
        message: checked.reason,
        data: { backupId: selected.id, failedAt: checked.failedAt },
      };
    }

    if (options.dryRun) {
      return {
        code: EXIT_CODES.ok,
        message: "the restoration checks passed; nothing was changed",
        data: { backupId: selected.id, scope },
      };
    }

    const result = await options.apply(opened as Buffer);
    await finishRestoration(deps.db, {
      id: attemptId,
      outcome: "succeeded",
      restoredItemCount: result.restoredItemCount,
      finishedAt: (deps.now ?? (() => new Date()))(),
    });
    return {
      code: EXIT_CODES.ok,
      message:
        options.kind === "test"
          ? "the backup was restored successfully in isolation; the live workspace was untouched"
          : "the backup was restored successfully",
      data: {
        backupId: selected.id,
        restoredItemCount: result.restoredItemCount,
        restoredFileCount: result.restoredFileCount,
      },
    };
  } catch (error) {
    if (!options.dryRun) {
      await finishRestoration(deps.db, {
        id: attemptId,
        outcome: "failed",
        detail: "the restoration stopped while applying the checked archive",
        finishedAt: (deps.now ?? (() => new Date()))(),
      });
    }
    return {
      code: EXIT_CODES.unexpected,
      message: "the restoration stopped while applying the checked archive",
      data: { backupId: selected.id, errorType: error instanceof Error ? error.name : "unknown" },
    };
  }
}
