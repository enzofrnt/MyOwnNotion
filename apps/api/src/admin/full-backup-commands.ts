/** Complete recovery commands deliberately run before current-schema initialization. */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UNKNOWN_SOURCE_VERSION } from "@myownnotion/domain";
import {
  createBackupDestination,
  fullBackupRoot,
  loadBackupConfig,
} from "../backup/backup-config.ts";
import { VerifiedFullArchive } from "../backup/full/archive.ts";
import { activateFullRestore, restoreFullBackup } from "../backup/full/restore.ts";
import { FullBackupService } from "../backup/full/service.ts";
import { loadDeploymentKey } from "../security/deployment-key.ts";
import { type CommandResult, EXIT_CODES, exitCodeFor } from "./command-output.ts";
import {
  CommandUsageError,
  type ParsedCommand,
  requireOption,
  shouldExecute,
} from "./command-parser.ts";

const COMMAND_FLAGS: Record<string, readonly string[]> = {
  "backup full run": ["json"],
  "backup full list": ["json"],
  "backup full inspect": ["file", "json"],
  "backup full verify": ["file", "json"],
  "restore full test": ["file", "json"],
  "restore full apply": ["file", "target-directory", "dry-run", "yes", "json"],
  "restore full activate": ["target-directory", "yes", "json"],
};

export function isFullBackupCommand(command: ParsedCommand): boolean {
  return ["backup", "restore"].includes(command.path[0] ?? "") && command.path[1] === "full";
}

export async function runFullBackupCommand(
  command: ParsedCommand,
  env: Record<string, string | undefined> = process.env,
): Promise<CommandResult> {
  const path = command.path.join(" ");
  const allowed = COMMAND_FLAGS[path];
  if (allowed === undefined) throw new CommandUsageError("Unknown complete-backup command.");
  for (const flag of Object.keys(command.options)) {
    if (!allowed.includes(flag))
      throw new CommandUsageError(`--${flag} is not supported by this command.`);
  }
  const archivePath = allowed.includes("file") ? requireOption(command, "file") : null;
  const targetDirectory = allowed.includes("target-directory")
    ? requireOption(command, "target-directory")
    : null;
  if (path === "restore full activate" && !shouldExecute(command))
    return { code: EXIT_CODES.refused, message: "Restoration activation requires --yes." };
  if (
    path === "restore full apply" &&
    !shouldExecute(command) &&
    command.options["dry-run"] !== true
  )
    return {
      code: EXIT_CODES.refused,
      message: "Choose --dry-run or authorize the empty target with --yes.",
    };
  const targetConnectionString = env["MYOWNNOTION_RESTORE_DATABASE_URL"];
  if (targetDirectory !== null && !targetConnectionString)
    throw new CommandUsageError(
      "MYOWNNOTION_RESTORE_DATABASE_URL must explicitly identify the empty restore target.",
    );

  let key: Buffer | undefined;
  let readKeys: Buffer[] = [];
  let workingDirectory: string | undefined;
  try {
    const config = loadBackupConfig(env);
    const connectionString =
      env["DATABASE_URL"] ?? "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
    key = Buffer.from(loadDeploymentKey(env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"]).bytes);
    const archiveKey = key;
    const service = new FullBackupService({
      connectionString,
      blobRoot: env["MYOWNNOTION_BLOB_ROOT"] || "./.dev-blobs",
      backupRoot: fullBackupRoot(config),
      historicalKeyFiles: config.historicalKeyFiles,
      key: () => archiveKey,
      ...(config.destination === "filesystem"
        ? {}
        : { remote: () => createBackupDestination(config) }),
    });
    if (path === "backup full run") {
      const result = await service.run("manual");
      return {
        code: EXIT_CODES.ok,
        message: "Complete backup verified locally.",
        data: {
          ...result.receipt,
          sourceVersionLabel: result.manifest.source.applicationVersion ?? UNKNOWN_SOURCE_VERSION,
        },
      };
    }
    if (path === "backup full list") {
      const scan = await service.receipts.scan();
      const verified = await service.verifiedReceipts();
      let names: string[] = [];
      try {
        names = await readdir(fullBackupRoot(config));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return {
        code: EXIT_CODES.ok,
        message: "Complete local recovery inventory.",
        data: {
          backups: verified.map((receipt) => ({
            ...receipt,
            sourceVersionLabel: receipt.sourceVersion ?? UNKNOWN_SOURCE_VERSION,
          })),
          unavailableArtifacts: scan.receipts.length - verified.length,
          invalidReceipts: scan.invalidCount,
          uncataloguedArtifacts: names.filter(
            (name) =>
              name.endsWith(".monfull") &&
              !scan.receipts.some((receipt) => name === `${receipt.backupId}.monfull`),
          ),
        },
      };
    }
    if (path === "restore full activate" && targetDirectory !== null && targetConnectionString) {
      const result = await activateFullRestore({ targetDirectory, targetConnectionString, key });
      return {
        code: EXIT_CODES.ok,
        message: "Restoration activated; fresh owner authentication is required.",
        data: result,
      };
    }
    if (archivePath === null) throw new CommandUsageError("An archive file is required.");
    if (path === "restore full test") {
      return {
        code: EXIT_CODES.ok,
        message: "Complete restoration rehearsed in an isolated database.",
        data: await service.rehearseArchive(archivePath),
      };
    }
    workingDirectory = await mkdtemp(join(tmpdir(), "mon-full-command-"));
    if (path === "restore full apply" && targetDirectory !== null && targetConnectionString) {
      const result = await restoreFullBackup({
        archivePath,
        workingDirectory,
        targetDirectory,
        targetConnectionString,
        activeConnectionString: connectionString,
        activeDirectory: env["MYOWNNOTION_BLOB_ROOT"] || "./.dev-blobs",
        key,
        dryRun: command.options["dry-run"] === true,
      });
      return {
        code: EXIT_CODES.ok,
        message: result.dryRun
          ? "Complete restoration preflight passed; no target data was written."
          : "Complete data restored; explicit security activation is still required.",
        data: result,
      };
    }
    readKeys = service.readKeys();
    const archive = await VerifiedFullArchive.open(
      archivePath,
      key,
      workingDirectory,
      readKeys.slice(1),
    );
    try {
      return {
        code: EXIT_CODES.ok,
        message: "Every complete-backup component authenticated and verified.",
        data: {
          backupId: archive.manifest.backupId,
          createdAt: archive.manifest.createdAt,
          source: archive.manifest.source,
          sourceVersionLabel: archive.manifest.source.applicationVersion ?? UNKNOWN_SOURCE_VERSION,
          componentCount: archive.manifest.components.length,
          totalPlaintextBytes: archive.manifest.components.reduce(
            (total, component) => total + component.byteLength,
            0,
          ),
        },
      };
    } finally {
      await archive.close();
    }
  } catch (error) {
    const code = exitCodeFor(error);
    return {
      code:
        code === EXIT_CODES.unexpected &&
        ["backup full inspect", "backup full verify"].includes(path)
          ? EXIT_CODES.integrityFailure
          : code,
      message:
        "Complete recovery command failed; no success is recorded. Check the key, PostgreSQL tools and target storage.",
    };
  } finally {
    key?.fill(0);
    for (const candidate of readKeys) candidate.fill(0);
    if (workingDirectory !== undefined)
      await rm(workingDirectory, { recursive: true, force: true });
  }
}
