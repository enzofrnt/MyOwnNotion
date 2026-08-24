/**
 * What the owner sees about the copy that protects this machine (T020).
 *
 * The status is seeded at the database boundary because this journey is about
 * the interface reading recorded truth. Archive production and transfer have
 * their own contract suites; reproducing those through a browser would test a
 * scheduler by waiting for a clock.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from "@myownnotion/domain";
import pg from "pg";
import { sealBackupArchive } from "../../apps/api/src/backup/archive-crypto.ts";
import { encodeBackupArchive } from "../../apps/api/src/backup/archive-format.ts";
import { expect, test } from "./fixtures.ts";
import { openSettingsSection, openWorkspace } from "./helpers.ts";

function connectionString(): string {
  return (
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion"
  );
}

async function seedVerifiedBackup(checkedAt: Date): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const workspace = await client.query<{ id: string }>("SELECT id FROM workspaces LIMIT 1");
    const workspaceId = workspace.rows[0]?.id;
    if (workspaceId === undefined) {
      throw new Error("the backup journey has no workspace to protect");
    }
    const backupId = randomUUID();
    const remoteName = `seeded-${backupId}.tar`;
    const canonicalExport = JSON.stringify({ items: [], relationships: [], revisions: [] });
    const digest = (bytes: Uint8Array) =>
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const archive = encodeBackupArchive({
      manifest: {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: checkedAt.toISOString(),
        cursor: "42",
        applicationVersion: "0.1.0",
        schemaVersion: 1,
        recordFormatVersion: 1,
        canonicalExportDigest: digest(Buffer.from(canonicalExport)),
        files: [],
        itemCount: 0,
        fileCount: 0,
      },
      canonicalExport,
      files: new Map(),
    });
    const keyPath =
      process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"] ??
      path.resolve("secrets", "deployment-key.e2e");
    const key = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
    const sealed = sealBackupArchive(key, archive);
    const backupRoot = process.env["MYOWNNOTION_BACKUP_ROOT"] ?? path.resolve(".dev-backups-e2e");
    await mkdir(backupRoot, { recursive: true });
    await writeFile(path.join(backupRoot, remoteName), sealed);
    await client.query(
      `INSERT INTO backups
         (id, workspace_id, cursor, application_version, schema_version,
          record_format_version, byte_length, digest, destination, remote_name, reason)
       VALUES ($1, $2, '42', '0.1.0', 1, 1, $3, $4,
               'filesystem', $5, 'scheduled')`,
      [backupId, workspaceId, sealed.byteLength, digest(sealed), remoteName],
    );
    await client.query(
      `INSERT INTO backup_verifications
         (id, backup_id, stage, checked_at, outcome)
       VALUES ($1, $2, 'after-transfer', $3, 'passed')`,
      [randomUUID(), backupId, checkedAt],
    );
  } finally {
    await client.end();
  }
}

async function makeLastVerificationStale(): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    await client.query(
      "UPDATE backup_verifications SET checked_at = now() - interval '27 hours' WHERE stage = 'after-transfer'",
    );
  } finally {
    await client.end();
  }
}

test("a verified backup is visible, and becomes a plain warning after 26 hours", async ({
  page,
}) => {
  await seedVerifiedBackup(new Date());
  await openWorkspace(page);

  await openSettingsSection(page, "backups");
  await expect(page.getByTestId("backup-last-verified")).toContainText("Last verified backup:");
  await expect(page.getByTestId("backup-stale")).toHaveCount(0);

  await makeLastVerificationStale();
  await page.getByTestId("back-to-workspace").click();
  const workspaceWarning = page.getByTestId("workspace-backup-stale");
  await expect(workspaceWarning).toBeVisible();
  await expect(workspaceWarning).toContainText("Aucune sauvegarde vérifiée depuis plus d’un jour");
  await workspaceWarning.getByRole("button", { name: "Vérifier les sauvegardes" }).click();

  const warning = page.getByTestId("backup-stale");
  await expect(warning).toHaveAttribute("role", "alert");
  await expect(warning).toContainText("No verified backup in more than a day");
  await expect(warning).toContainText("not currently protected against losing this machine");
});

test("the owner can rehearse the latest backup without touching the live workspace", async ({
  page,
}) => {
  await seedVerifiedBackup(new Date());
  await openWorkspace(page);
  await openSettingsSection(page, "backups");

  await page.getByTestId("run-rehearsal").click();
  await expect(page.getByTestId("rehearsal-result")).toContainText(
    "restored successfully in isolation",
  );
  await expect(page.getByTestId("backup-last-rehearsal")).toContainText("succeeded");
  await expect(page.getByTestId("rehearsal-due")).toHaveCount(0);
});
