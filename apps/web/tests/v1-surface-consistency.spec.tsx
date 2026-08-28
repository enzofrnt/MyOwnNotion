import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AsyncState } from "../src/ui/primitives/async-state.tsx";

const MIGRATED_SURFACES = [
  "../src/features/auth/bootstrap-page.tsx",
  "../src/features/auth/login-page.tsx",
  "../src/features/search/search-dialog.tsx",
  "../src/features/search/search-results.tsx",
  "../src/features/search/search-filters.tsx",
  "../src/features/files/file-preview.tsx",
  "../src/features/files/storage-panel.tsx",
  "../src/features/files/transfer-state.tsx",
  "../src/features/attachments/attachment-panel.tsx",
  "../src/features/databases/database-page.tsx",
  "../src/features/databases/database-toolbar.tsx",
  "../src/features/databases/table-view.tsx",
  "../src/features/databases/board-view.tsx",
  "../src/features/databases/calendar-view.tsx",
  "../src/features/databases/gallery-view.tsx",
  "../src/features/databases/list-view.tsx",
  "../src/features/backup/backup-panel.tsx",
  "../src/features/backup/restore-rehearsal.tsx",
  "../src/features/history/revision-restore.tsx",
  "../src/features/security/security-settings.tsx",
  "../src/features/security/device-panel.tsx",
  "../src/features/security/session-panel.tsx",
  "../src/features/security/key-rotation-panel.tsx",
  "../src/features/security/recovery-kit-panel.tsx",
  "../src/features/editor/page-editor.tsx",
] as const;

describe("V1 surface consistency", () => {
  it.each([
    ["loading", "Chargement…", "status", "true"],
    ["empty", "Aucun contenu", "status", null],
    ["offline", "Hors ligne", "status", null],
    ["error", "Une erreur est survenue", "alert", null],
    ["success", "Terminé", "status", null],
    ["conflict", "Une décision est nécessaire", "alert", null],
  ] as const)(
    "renders the %s state through one stable contract",
    (kind, expectedTitle, expectedRole, expectedBusy) => {
      const markup = renderToStaticMarkup(
        createElement(AsyncState, {
          kind,
          description: "Le contenu déjà enregistré reste disponible.",
        }),
      );

      expect(markup).toContain(`data-state="${kind}"`);
      expect(markup).toContain(`role="${expectedRole}"`);
      expect(markup).toContain(expectedTitle);
      expect(markup).toContain("Le contenu déjà enregistré reste disponible.");
      if (expectedBusy === null) expect(markup).not.toContain("aria-busy");
      else expect(markup).toContain(`aria-busy="${expectedBusy}"`);
    },
  );

  it("keeps migrated feature states on the shared primitives", () => {
    for (const relativePath of MIGRATED_SURFACES) {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      expect(source, relativePath).not.toMatch(/className="(?:status-banner|empty-state)"/u);
      expect(source, relativePath).not.toMatch(/className=\{[^}]*"status-banner"/u);
    }
  });

  it("routes destructive confirmations through the shared dialog", () => {
    const confirmationSurfaces = [
      "../src/features/hierarchy/hierarchy-explorer.tsx",
      "../src/features/files/delete-file.tsx",
      "../src/features/security/device-panel.tsx",
    ] as const;

    for (const relativePath of confirmationSurfaces) {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      expect(source, relativePath).toContain("<ConfirmDialog");
      expect(source, relativePath).not.toContain("window.confirm");
    }
  });

  it("uses the official French BlockNote catalog with application-owned styling", () => {
    const source = readFileSync(
      new URL("../src/features/editor/page-editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("dictionary: fr");
    expect(source).toContain("defaultStyles: false");
    expect(source).toContain("theme={resolvedTheme}");
    expect(source).toContain("<AsyncState");
    expect(source).not.toContain('className="status-banner"');
  });
});
