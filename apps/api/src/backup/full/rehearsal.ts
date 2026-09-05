/** A full SQL restore into an empty disposable database, with actual file reads. */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { VerifiedFullArchive } from "./archive.ts";
import { restoreFullBackup } from "./restore.ts";
import { fullArchiveDigest } from "./service.ts";

export async function rehearseFullBackup(input: {
  archivePath: string;
  connectionString: string;
  activeDirectory: string;
  key: Uint8Array;
}): Promise<{ backupId: string; databaseRestored: true; filesVerified: number }> {
  const directory = await mkdtemp(join(tmpdir(), "mon-full-rehearsal-"));
  const admin = new pg.Client({
    connectionString: input.connectionString,
    connectionTimeoutMillis: 15_000,
  });
  const databaseName = `mon_full_rehearsal_${randomBytes(12).toString("hex")}`;
  let created = false;
  try {
    // Authenticate before creating even a disposable database.
    const archive = await VerifiedFullArchive.open(input.archivePath, input.key, directory);
    try {
      await admin.connect();
      await admin.query(`CREATE DATABASE ${databaseName} TEMPLATE template0`);
      created = true;
      const targetUrl = new URL(input.connectionString);
      targetUrl.pathname = `/${databaseName}`;
      const targetDirectory = join(directory, "restored");
      const result = await restoreFullBackup({
        archivePath: input.archivePath,
        workingDirectory: directory,
        targetDirectory,
        targetConnectionString: targetUrl.toString(),
        activeConnectionString: input.connectionString,
        activeDirectory: input.activeDirectory,
        key: input.key,
      });
      let filesVerified = 0;
      for (const component of archive.manifest.components) {
        if (component.kind === "database") continue;
        const digest = await fullArchiveDigest(join(targetDirectory, component.path));
        if (digest.byteLength !== component.byteLength || digest.sha256 !== component.sha256)
          throw new Error("A restored file failed the complete-backup rehearsal.");
        filesVerified += 1;
      }
      return { backupId: result.backupId, databaseRestored: true, filesVerified };
    } finally {
      await archive.close();
    }
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    } finally {
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
