import type { PageSyncState } from "@myownnotion/client-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type EditorDurableSession,
  EditorSyncStatus,
} from "../src/features/editor/editor-sync-status.tsx";
import type { LocalContentService, LocalContentSnapshot } from "../src/services/local-content.ts";

function session(sync: PageSyncState): EditorDurableSession {
  return {
    sync,
    recoveryBuffer: null,
    subscribe: () => () => undefined,
  } as unknown as EditorDurableSession;
}

describe("editor synchronization status placement", () => {
  it("keeps workspace synchronization details inside the page information control", () => {
    const snapshot: LocalContentSnapshot = {
      syncState: "pending",
      pendingCount: 1,
      filePendingCount: 0,
      conflictCount: 0,
      attentionCount: 0,
      recoveryPendingCount: 0,
      quarantinedRecoveryCount: 0,
      storagePersisted: true,
    };
    const service = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      realtimePageSync: {
        state: "ready",
        subscribe: () => () => undefined,
      },
    } as unknown as LocalContentService;
    const html = renderToStaticMarkup(
      createElement(EditorSyncStatus, {
        service,
        session: session({
          kind: "saved",
          synchronizationKind: "synced",
          pendingCount: 0,
          attentionCount: 0,
          locallyDurable: true,
        }),
      }),
    );

    expect(html).toContain('data-testid="editor-sync-control"');
    expect(html).toContain('data-testid="sync-status"');
    expect(html).toContain('data-state="pending"');
    expect(html.indexOf('data-testid="sync-status"')).toBeGreaterThan(html.indexOf("<details"));
  });

  it("stays a closed compact control even when a decision is required", () => {
    const html = renderToStaticMarkup(
      createElement(EditorSyncStatus, {
        session: session({
          kind: "attention",
          synchronizationKind: "synced",
          pendingCount: 0,
          attentionCount: 2,
          locallyDurable: true,
        }),
      }),
    );

    expect(html).toContain('data-placement="viewport-bottom"');
    expect(html).toContain('data-requires-action="true"');
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/u);
    expect(html).toContain("Décision requise");
  });
});
