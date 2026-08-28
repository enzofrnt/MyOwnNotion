import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const V1_SURFACES = [
  "../src/features/auth/bootstrap-page.tsx",
  "../src/features/auth/login-page.tsx",
  "../src/features/search/search-dialog.tsx",
  "../src/features/search/search-results.tsx",
  "../src/features/search/search-filters.tsx",
  "../src/features/files/file-preview.tsx",
  "../src/features/files/storage-panel.tsx",
  "../src/features/files/transfer-state.tsx",
  "../src/features/attachments/attachment-panel.tsx",
  "../src/features/backup/backup-panel.tsx",
  "../src/features/backup/restore-rehearsal.tsx",
  "../src/features/history/revision-restore.tsx",
  "../src/features/security/security-settings.tsx",
  "../src/features/security/device-panel.tsx",
  "../src/features/security/session-panel.tsx",
  "../src/features/security/key-rotation-panel.tsx",
  "../src/features/security/recovery-kit-panel.tsx",
] as const;

const FORBIDDEN_VISIBLE_COPY = [
  "Set up this installation",
  "Create the owner passkey",
  "Sign in",
  "Use your passkey",
  "Use your password",
  "Search the workspace",
  "Search results",
  "Filter by type",
  "Whole workspace",
  "Reset filters",
  "Load more results",
  "Device storage",
  "Backups",
  "Revision history",
  "Save password",
  "Save name",
  "Active sessions",
  "Recovery kit",
] as const;

function executableSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

describe("French V1 copy", () => {
  it("does not leave the known English interface behind on migrated surfaces", () => {
    for (const path of V1_SURFACES) {
      const source = executableSource(path);
      for (const phrase of FORBIDDEN_VISIBLE_COPY) {
        expect(source, `${path} still exposes “${phrase}”`).not.toContain(phrase);
      }
    }
  });

  it("keeps operational panels outside the current document", () => {
    const workspace = executableSource("../src/features/hierarchy/hierarchy-explorer.tsx");
    for (const forbiddenImport of [
      "StoragePanel",
      "SecuritySettings",
      "DevicePanel",
      "SessionPanel",
      "BackupPanel",
      "RevisionRestore",
      "DiagnosticsPanel",
    ]) {
      expect(workspace).not.toContain(`<${forbiddenImport}`);
    }
  });
});
