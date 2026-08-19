/**
 * API entry point. Binds to 127.0.0.1 only (no production exposure before
 * authentication).
 */
import process from "node:process";
import { backupsWithVerification } from "@myownnotion/database";
import { pruneBackupsCommand, runBackupCommand } from "./admin/commands/backup-commands.ts";
import { buildApp } from "./app.ts";
import { APPLICATION_VERSION } from "./application-version.ts";
import { sealBackupArchiveFile } from "./backup/archive-crypto.ts";
import { createBackupDestination, loadBackupConfig } from "./backup/backup-config.ts";
import { BackupService } from "./backup/backup-service.ts";
import { BackupSchedule } from "./backup/schedule.ts";
import { loadDeploymentKey } from "./security/deployment-key.ts";

const databaseUrl =
  process.env["DATABASE_URL"] ??
  "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
const blobRoot = process.env["MYOWNNOTION_BLOB_ROOT"] ?? "./.dev-blobs";
const host = process.env["MYOWNNOTION_API_HOST"] ?? "127.0.0.1";
const port = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

const { app, close, context } = await buildApp({ databaseUrl, blobRoot });
const backupConfig = loadBackupConfig();
const backupDestination = createBackupDestination(backupConfig);
const archiveKey = () => loadDeploymentKey(process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"]).bytes;
const backupService = new BackupService({
  context,
  destination: backupDestination,
  applicationVersion: APPLICATION_VERSION,
  seal: async (plaintextPath, sealedPath) =>
    await sealBackupArchiveFile(archiveKey(), plaintextPath, sealedPath),
});
const backupDeps = {
  db: context.db,
  workspaceId: context.workspaceId,
  service: backupService,
  destination: backupDestination,
  retainDays: backupConfig.retentionDays,
};
const backupSchedule = new BackupSchedule({
  runBackup: async () => {
    const result = await runBackupCommand(backupDeps, "scheduled");
    if (result.code !== 0) {
      throw new Error("the scheduled backup did not verify");
    }
    await pruneBackupsCommand(backupDeps);
  },
  lastScheduledRunAt: async () =>
    (await backupsWithVerification(context.db, context.workspaceId)).find(
      (backup) => backup.reason === "scheduled",
    )?.createdAt ?? null,
  hour: backupConfig.hour,
  timeZone: backupConfig.timeZone,
  logger: app.log,
});
backupSchedule.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    backupSchedule.stop();
    void close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
