import type { ConflictRecordRow, LegacySyncRecoveryRow } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { legacyDraftExport } from "../src/features/sync/legacy-recovery-list.tsx";
import {
  syncStatusDetails,
  WorkspaceSyncStatus,
} from "../src/features/sync/workspace-sync-status.tsx";
import type { LocalContentService, LocalContentSnapshot } from "../src/services/local-content.ts";

function snapshot(overrides: Partial<LocalContentSnapshot> = {}): LocalContentSnapshot {
  return {
    syncState: "synced",
    pendingCount: 0,
    filePendingCount: 0,
    conflictCount: 0,
    attentionCount: 0,
    recoveryPendingCount: 0,
    quarantinedRecoveryCount: 0,
    storagePersisted: true,
    ...overrides,
  };
}

function serviceFor(value: LocalContentSnapshot): LocalContentService {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => value,
    realtimePageSync: {
      state: "ready",
      subscribe: () => () => undefined,
    },
  } as unknown as LocalContentService;
}

describe("workspace synchronization status", () => {
  it("counts pending recovery, active decisions and old drafts with distinct labels", () => {
    expect(
      syncStatusDetails(
        snapshot({
          pendingCount: 2,
          conflictCount: 1,
          attentionCount: 4,
          recoveryPendingCount: 2,
          quarantinedRecoveryCount: 3,
        }),
      ),
    ).toBe(" (2 changements à synchroniser · 1 décision · 3 anciens brouillons à récupérer)");
  });

  it("names pending file bytes separately from document changes", () => {
    expect(syncStatusDetails(snapshot({ pendingCount: 3, filePendingCount: 2 }))).toBe(
      " (1 changement à synchroniser · 2 fichiers à transférer)",
    );
  });

  it("renders denied persistent storage as a neutral advisory, never as a conflict", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSyncStatus, {
        service: serviceFor(snapshot({ storagePersisted: false })),
      }),
    );

    expect(html).toContain('data-testid="sync-status"');
    expect(html).toContain('data-state="synced"');
    expect(html).toContain('data-testid="storage-persistence-advisory"');
    expect(html).toContain('data-state="storage-advisory"');
    expect(html).toContain("Protection locale non garantie par ce navigateur");
    expect(html).not.toContain("durable storage was not granted");
    expect(html).not.toContain('data-state="conflict"');
  });

  it("labels a quarantined historical draft as attention without calling it a live conflict", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSyncStatus, {
        service: serviceFor(
          snapshot({
            syncState: "conflict",
            attentionCount: 1,
            quarantinedRecoveryCount: 1,
          }),
        ),
      }),
    );

    expect(html).toContain("Une intervention est nécessaire");
    expect(html).toContain("1 ancien brouillon à récupérer");
    expect(html.toLocaleLowerCase("fr-FR")).not.toContain("conflit");
  });
});

describe("historical draft export", () => {
  it("exports the complete retained document without unrelated conflict metadata", () => {
    const mutationId = generateUuidV7();
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const row: LegacySyncRecoveryRow = {
      mutationId,
      pageId,
      status: "quarantined",
      reasonCode: "legacy-recovery.diff-unprovable",
      branchId: null,
      attemptCount: 1,
      capturedAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T11:00:00.000Z",
    };
    const document = {
      format: "myownnotion.document+json",
      formatVersion: 3,
      body: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "privé" }] }] },
    };
    const conflict: ConflictRecordRow = {
      mutationId,
      commandType: "page.document.replace",
      payload: { itemId: pageId, document, secretTransportField: "excluded" },
      baseRevisionIds: [generateUuidV7()],
      localRevisionIds: [],
      competingRevisionIds: [generateUuidV7()],
      capturedAt: row.capturedAt,
      errorCode: "revision.stale-base",
    };

    expect(legacyDraftExport(row, conflict)).toEqual({
      format: "myownnotion.legacy-draft-export+json",
      formatVersion: 1,
      mutationId,
      pageId,
      capturedAt: row.capturedAt,
      reasonCode: row.reasonCode,
      document,
    });
  });
});
