/** Local administrative entrypoint for security, backup, restore and updates. */

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { ContentStore, FilesystemBlobStore, PartialUploadStore } from "@myownnotion/blob-store";
import { createDatabase, getOrCreateWorkspace, migrationInventory } from "@myownnotion/database";
import { APPLICATION_VERSION } from "../application-version.ts";
import { openBackupArchive, sealBackupArchiveFile } from "../backup/archive-crypto.ts";
import { createBackupDestination, loadBackupConfig } from "../backup/backup-config.ts";
import { BACKUP_RECORD_FORMAT_VERSION, BackupService } from "../backup/backup-service.ts";
import { PageOperationArchiveService } from "../backup/page-operation-archive.ts";
import { PageOperationCrypto } from "../page-state/page-operation-crypto.ts";
import { loadDeploymentKey } from "../security/deployment-key.ts";
import { createProtectedContentRuntime } from "../security/protected-content-runtime.ts";
import { runBackupAdminCommand } from "./backup-admin-commands.ts";
import { type CommandResult, EXIT_CODES, exitCodeFor, renderResult } from "./command-output.ts";
import { parseCommand, wantsJson } from "./command-parser.ts";
import { runCli as runSecurityCli } from "./security-cli.ts";

export const ADMIN_HELP = `myownnotion — local administration

  backup run [--destination filesystem|google-drive] [--json]
  backup verify (--id ID | --latest) [--json]
  restore test (--id ID | --latest) [--json]
  restore apply --id ID [--dry-run | --yes] [--json]
  version inspect [--json]
  security ...

Restore apply shows the archive scope, makes a safety backup, and requires
confirmation. With no terminal it refuses unless --yes was supplied.
Secrets are read from mounted files and are never accepted as arguments.`;

async function askForRestore(scope: {
  readonly createdAt: string;
  readonly itemCount: number;
  readonly fileCount: number;
}): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `Restore ${scope.itemCount} item(s) and ${scope.fileCount} file(s) from ${scope.createdAt}? Type RESTORE to continue: `,
    );
    return answer.trim() === "RESTORE";
  } finally {
    terminal.close();
  }
}

export async function runAdminCli(
  argv: readonly string[],
  print: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") {
    print(ADMIN_HELP);
    return EXIT_CODES.ok;
  }
  if (argv[0] === "security") {
    return await runSecurityCli(argv, print);
  }

  let json = false;
  let database: ReturnType<typeof createDatabase> | null = null;
  try {
    const command = parseCommand(argv);
    json = wantsJson(command);
    const databaseUrl =
      process.env["DATABASE_URL"] ??
      "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
    const config = loadBackupConfig();
    const destinationOption = command.options["destination"];
    const destination = createBackupDestination(
      config,
      typeof destinationOption === "string" ? destinationOption : undefined,
    );
    database = createDatabase(databaseUrl);
    const workspace = await getOrCreateWorkspace(database.db);
    const blobRoot = process.env["MYOWNNOTION_BLOB_ROOT"]?.trim() || "./.dev-blobs";
    const contentStore = new ContentStore(new FilesystemBlobStore(blobRoot));
    const deploymentKey = (): Buffer | null => {
      try {
        return Buffer.from(loadDeploymentKey(process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"]).bytes);
      } catch {
        return null;
      }
    };
    const protectedRuntime = createProtectedContentRuntime({
      db: database.db,
      workspaceId: workspace.id,
      deploymentKey,
    });
    const pageOperationCrypto = new PageOperationCrypto(protectedRuntime.records);
    const pageOperationArchive = new PageOperationArchiveService({
      workspaceId: workspace.id,
      crypto: pageOperationCrypto,
    });
    const context = {
      db: database.db,
      workspaceId: workspace.id,
      schemaVersion: workspace.schemaVersion,
      contentStore,
      partialUploads: new PartialUploadStore(blobRoot),
      protectedContent: protectedRuntime.content,
      pageOperationArchive,
    };
    const key = () => {
      const value = deploymentKey();
      if (value === null) {
        return Buffer.from(loadDeploymentKey(process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"]).bytes);
      }
      return Buffer.from(value);
    };
    const service = new BackupService({
      context,
      destination,
      applicationVersion: APPLICATION_VERSION,
      seal: async (plaintextPath, sealedPath) =>
        await sealBackupArchiveFile(key(), plaintextPath, sealedPath),
    });
    const inventory = await migrationInventory(databaseUrl);
    const result = await runBackupAdminCommand(command, {
      db: database.db,
      databaseUrl,
      workspaceId: workspace.id,
      service,
      destination,
      contentStore,
      protectedContent: protectedRuntime.content,
      pageOperationCrypto,
      deploymentKey: key,
      open: async (ciphertext) => openBackupArchive(key(), ciphertext),
      schemaVersion: workspace.schemaVersion,
      recordFormatVersion: BACKUP_RECORD_FORMAT_VERSION,
      runningVersion: APPLICATION_VERSION,
      pendingMigrations: inventory.pending,
      terminalAvailable: process.stdin.isTTY === true && process.stdout.isTTY === true,
      confirmRestore: askForRestore,
    });
    print(renderResult(result, { json }));
    return result.code;
  } catch (error) {
    const failure: CommandResult = {
      code: exitCodeFor(error),
      message: error instanceof Error ? error.message : "command failed",
    };
    print(renderResult(failure, { json }));
    return failure.code;
  } finally {
    await database?.close();
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.filename === process.argv[1];
if (isDirectRun) {
  runAdminCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = EXIT_CODES.unexpected;
    });
}
