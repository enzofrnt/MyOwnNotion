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
import { AxeBuilder } from "@axe-core/playwright";
import {
  asUuid,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  buildCanonicalExport,
  canonicalExportString,
  canonicalStructuredDataString,
} from "@myownnotion/domain";
import pg from "pg";
import { sealBackupArchive } from "../../apps/api/src/backup/archive-crypto.ts";
import { encodeBackupArchive } from "../../apps/api/src/backup/archive-format.ts";
import { FullBackupReceipts } from "../../apps/api/src/backup/full/receipts.ts";
import { FullBackupService } from "../../apps/api/src/backup/full/service.ts";
import { expect, test } from "./fixtures.ts";
import { closeMobileNavigation, openSettingsSection, openWorkspace } from "./helpers.ts";

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
    const canonicalManifest = buildCanonicalExport({
      workspaceId: asUuid(workspaceId),
      schemaVersion: 1,
      exportedAt: checkedAt.toISOString(),
      changeCursor: "42",
      items: [],
      relationships: [],
      revisions: [],
    });
    const canonicalExport = canonicalExportString(canonicalManifest);
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
        databaseCount: canonicalManifest.databases.length,
        databaseEntryCount: canonicalManifest.databaseEntries.length,
        structuredDataDigest: digest(Buffer.from(canonicalStructuredDataString(canonicalManifest))),
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

async function fullBackupSetup() {
  const keyPath = process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"];
  const blobRoot = process.env["MYOWNNOTION_BLOB_ROOT"];
  const backupRoot = process.env["MYOWNNOTION_BACKUP_ROOT"];
  if (!keyPath || !blobRoot || !backupRoot)
    throw new Error("Full-backup journeys require isolated matrix paths.");
  const key = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
  const root = path.join(backupRoot, "full");
  return {
    service: new FullBackupService({
      connectionString: connectionString(),
      blobRoot,
      backupRoot: root,
      key: () => key,
    }),
    receipts: new FullBackupReceipts(root, () => key),
  };
}

async function makeLastVerificationStale(): Promise<void> {
  const full = await fullBackupSetup();
  for (const receipt of await full.receipts.list()) {
    await full.receipts.put({
      ...receipt,
      verifiedAt: new Date(Date.now() - 27 * 3_600_000).toISOString(),
    });
  }
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
}, testInfo) => {
  await seedVerifiedBackup(new Date());
  await (await fullBackupSetup()).service.run("manual");
  await openWorkspace(page);

  await openSettingsSection(page, "backups");
  await expect(page.getByTestId("full-backup-local-status")).toContainText(
    "Une copie complète récente",
  );
  await expect(page.getByTestId("full-backup-source-version")).toBeVisible();

  await makeLastVerificationStale();
  await page.getByTestId("back-to-workspace").click();
  const notices = page.getByTestId("workspace-notices-summary");
  await expect(notices).toBeVisible();
  await expect(notices).toContainText("1 alerte");
  const workspaceWarning = page.getByTestId("workspace-backup-stale");
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 1280]) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 720 });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const navigation = page.getByTestId("toggle-sidebar");
      if (width === 320) await expect(navigation).toBeVisible();
      for (const label of [
        page.locator(".workspace-page-header__kind"),
        page.getByTestId("active-item-heading"),
      ]) {
        await expect
          .poll(async () => {
            if (!(await navigation.isVisible())) return true;
            const control = await navigation.boundingBox();
            const text = await label.boundingBox();
            return (
              control !== null &&
              text !== null &&
              (control.x + control.width <= text.x ||
                text.x + text.width <= control.x ||
                control.y + control.height <= text.y ||
                text.y + text.height <= control.y)
            );
          })
          .toBe(true);
      }
      if (width === 320) {
        await navigation.click();
        await expect(page.getByTestId("close-mobile-nav")).toBeVisible();
        await closeMobileNavigation(page);
        await expect(page.getByTestId("close-mobile-nav")).toBeHidden();
        await expect(navigation).toBeFocused();
        await expect(notices).toBeVisible();
      }
      for (const open of [false, true]) {
        if (open) {
          await notices.focus();
          await page.keyboard.press("Enter");
          await expect(workspaceWarning).toBeVisible();
        } else {
          await expect(workspaceWarning).toBeHidden();
        }
        const report = await new AxeBuilder({ page }).include(".workspace-notices").analyze();
        expect(
          report.violations.filter((violation) =>
            ["serious", "critical"].includes(violation.impact ?? ""),
          ),
          `${theme}, ${width}px, ${open ? "open" : "closed"}`,
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`notices-${theme}-${width}-${open ? "open" : "closed"}.png`),
        });
      }
      await notices.click();
      await expect(workspaceWarning).toBeHidden();
    }
  }
  await notices.click();
  await expect(workspaceWarning).toBeVisible();
  await expect(workspaceWarning).toContainText("Aucune sauvegarde vérifiée depuis plus d’un jour");
  await workspaceWarning.getByRole("button", { name: "Vérifier les sauvegardes" }).click();

  const warning = page.getByTestId("full-backup-local-status");
  await expect(warning).toHaveAttribute("role", "alert");
  await expect(warning).toContainText("26 dernières heures");
  await page.getByText("Exports portables", { exact: true }).first().click();
  await expect(page.getByTestId("backup-stale")).toContainText("Aucun export portable");
});

test("the owner can rehearse the latest backup without touching the live workspace", async ({
  page,
}) => {
  await seedVerifiedBackup(new Date());
  await (await fullBackupSetup()).service.run("manual");
  await openWorkspace(page);
  await openSettingsSection(page, "backups");

  await page.getByTestId("run-full-rehearsal").click();
  await expect(page.getByTestId("full-rehearsal-result")).toContainText(
    "restauration complète a réussi",
    { timeout: 30_000 },
  );
  await page.getByText("Exports portables", { exact: true }).first().click();
  await page.getByTestId("run-rehearsal").click();
  await expect(page.getByTestId("rehearsal-result")).toContainText(
    "restaurée avec succès dans un environnement isolé",
  );
  await expect(page.getByTestId("backup-last-rehearsal")).toContainText("réussi");
  await expect(page.getByTestId("rehearsal-due")).toHaveCount(0);
});
