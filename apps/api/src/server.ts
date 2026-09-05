/**
 * API entry point. Binds to 127.0.0.1 only (no production exposure before
 * authentication).
 */
import process from "node:process";
import { buildApp } from "./app.ts";
import {
  createBackupDestination,
  fullBackupRoot,
  loadBackupConfig,
} from "./backup/backup-config.ts";
import { FullBackupService } from "./backup/full/service.ts";
import { BackupSchedule } from "./backup/schedule.ts";
import { loadDeploymentKey } from "./security/deployment-key.ts";

const databaseUrl =
  process.env["DATABASE_URL"] ??
  "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
const blobRoot = process.env["MYOWNNOTION_BLOB_ROOT"] ?? "./.dev-blobs";
const host = process.env["MYOWNNOTION_API_HOST"] ?? "127.0.0.1";
const port = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

const { app, close } = await buildApp({ databaseUrl, blobRoot });
const backupConfig = loadBackupConfig();
const archiveKey = () => loadDeploymentKey(process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"]).bytes;
const backupService = new FullBackupService({
  connectionString: databaseUrl,
  blobRoot,
  backupRoot: fullBackupRoot(backupConfig),
  key: archiveKey,
  ...(backupConfig.destination === "filesystem"
    ? {}
    : { remote: () => createBackupDestination(backupConfig) }),
});
const backupSchedule = new BackupSchedule({
  runBackup: async () => {
    await backupService.runScheduled(backupConfig.hour, backupConfig.timeZone);
    await backupService.prune(backupConfig.retentionDays);
  },
  lastVerifiedFullBackupAt: () => backupService.lastVerifiedAt(),
  maintenance: async () => {
    await backupService.retryRemote();
  },
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
