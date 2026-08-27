import type { PageSyncState } from "@myownnotion/client-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type EditorDurableSession,
  EditorSyncStatus,
} from "../src/features/editor/editor-sync-status.tsx";

function session(sync: PageSyncState): EditorDurableSession {
  return {
    sync,
    recoveryBuffer: null,
    subscribe: () => () => undefined,
  } as unknown as EditorDurableSession;
}

describe("editor synchronization status placement", () => {
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
