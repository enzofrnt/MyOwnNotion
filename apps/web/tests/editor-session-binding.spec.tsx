import type {
  PageEditingSession,
  PageSessionChange,
  PageSyncState,
} from "@myownnotion/client-core";
import { generateUuidV7, type PageCommand } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryEditorEngine,
  createSessionEditorEngine,
} from "../src/features/editor/editor-engine.ts";
import {
  BLOCKED_REASON_COPY,
  EditorSyncStatus,
  editorSyncLabel,
} from "../src/features/editor/editor-sync-status.tsx";

const PAGE_ID = generateUuidV7();

function syncState(overrides: Partial<PageSyncState>): PageSyncState {
  return {
    kind: "local-saved",
    synchronizationKind: "local-saved",
    pendingCount: 0,
    attentionCount: 0,
    locallyDurable: true,
    ...overrides,
  };
}

interface FakeSessionSetup {
  readonly session: PageEditingSession;
  readonly emit: (change: PageSessionChange) => void;
  readonly transact: ReturnType<typeof vi.fn>;
  readonly undo: ReturnType<typeof vi.fn>;
  readonly redo: ReturnType<typeof vi.fn>;
}

function fakeSession(sync: PageSyncState = syncState({})): FakeSessionSetup {
  const listeners = new Set<(change: PageSessionChange) => void>();
  const document = { blocks: [] };
  const locallyBlocked = sync.synchronizationKind === "blocked" && !sync.locallyDurable;
  const session = {
    get pageId() {
      return PAGE_ID;
    },
    get sync() {
      return sync;
    },
    get recoveryBuffer() {
      return locallyBlocked
        ? {
            pageId: PAGE_ID,
            updateId: generateUuidV7(),
            document,
            reason: "quota" as const,
            failedAt: new Date().toISOString(),
          }
        : null;
    },
    get canUndo() {
      return true;
    },
    get canRedo() {
      return false;
    },
    read: () => document,
    canonicalBlockIdForIdentity: () => null,
    subscribe: (listener: (change: PageSessionChange) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    transact: vi.fn(async () => ({ changed: true, updateId: generateUuidV7(), document })),
    undo: vi.fn(async () => ({ changed: true, document })),
    redo: vi.fn(async () => ({ changed: false, document })),
    retryBlockedCommit: vi.fn(async () => {
      throw new Error("not blocked");
    }),
  } as unknown as PageEditingSession & {
    transact: FakeSessionSetup["transact"];
    undo: FakeSessionSetup["undo"];
    redo: FakeSessionSetup["redo"];
  };
  return {
    session,
    emit: (change) => {
      for (const listener of listeners) listener(change);
    },
    transact: session.transact as FakeSessionSetup["transact"],
    undo: session.undo as FakeSessionSetup["undo"],
    redo: session.redo as FakeSessionSetup["redo"],
  };
}

describe("session editor engine", () => {
  it("commits every applied command list through the durable session", async () => {
    const { session, transact } = fakeSession();
    const engine = createSessionEditorEngine(session);
    const commands: PageCommand[] = [
      { type: "replace-text", blockId: generateUuidV7(), from: 0, to: 0, text: "Bonjour" },
    ];

    const result = await engine.apply(commands);

    expect(transact).toHaveBeenCalledWith(commands);
    expect(result.changed).toBe(true);
    expect(result.document).toEqual({ blocks: [] });
  });

  it("routes undo and redo through the session history", async () => {
    const { session, undo, redo } = fakeSession();
    const engine = createSessionEditorEngine(session);

    const undone = await engine.undo();
    const redone = await engine.redo();

    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();
    expect(undone.changed).toBe(true);
    expect(redone.changed).toBe(false);
    expect(engine.canUndo).toBe(true);
    expect(engine.canRedo).toBe(false);
  });

  it("keeps the memory engine authoritative in memory for the compatibility path", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const engine = createMemoryEditorEngine(pageId, {
      blocks: [{ type: "paragraph", id: blockId, content: [{ text: "Premier" }] }],
    });

    const before = engine.snapshot();
    await engine.apply([{ type: "replace-text", blockId, from: 7, to: 7, text: " ajouté" }]);

    expect(before.blocks[0]).toMatchObject({ id: blockId });
    expect(engine.snapshot().blocks[0]).toMatchObject({
      id: blockId,
      content: [{ text: "Premier ajouté" }],
    });
    expect(engine.canUndo).toBe(true);
    await engine.undo();
    expect(engine.snapshot().blocks[0]).toMatchObject({
      content: [{ text: "Premier" }],
    });
  });
});

describe("editor sync status copy", () => {
  it("never calls a keystroke synced before the server confirmed it", () => {
    expect(editorSyncLabel(syncState({ kind: "local-saving" }))).toBe("Enregistrement…");
    expect(editorSyncLabel(syncState({ kind: "local-saved" }))).toBe("Enregistré sur cet appareil");
    expect(editorSyncLabel(syncState({ kind: "pending", pendingCount: 1 }))).toContain(
      "en attente d’envoi",
    );
    expect(editorSyncLabel(syncState({ kind: "pending", pendingCount: 3 }))).toContain(
      "3 modifications en attente",
    );
    expect(editorSyncLabel(syncState({ kind: "syncing" }))).toBe("Synchronisation…");
    expect(editorSyncLabel(syncState({ kind: "synced" }))).toBe("Synchronisé");
    expect(editorSyncLabel(syncState({ kind: "offline" }))).toContain("hors ligne");
  });

  it("names semantic attention without hiding the transport state", () => {
    expect(editorSyncLabel(syncState({ kind: "attention", attentionCount: 1 }))).toContain(
      "une ambiguïté",
    );
    expect(editorSyncLabel(syncState({ kind: "attention", attentionCount: 4 }))).toContain(
      "4 ambiguïtés",
    );
    expect(editorSyncLabel(syncState({ kind: "blocked" }))).toBe("Enregistrement interrompu");
  });

  it("explains every blocked reason instead of showing a bare refusal", () => {
    for (const reason of Object.keys(BLOCKED_REASON_COPY)) {
      expect(
        BLOCKED_REASON_COPY[reason as keyof typeof BLOCKED_REASON_COPY].length,
      ).toBeGreaterThan(10);
    }
  });
});

describe("editor sync status rendering", () => {
  it("renders the current state with an explicit durability flag", () => {
    const { session } = fakeSession(syncState({ kind: "synced" }));
    const html = renderToStaticMarkup(createElement(EditorSyncStatus, { session }));
    expect(html).toContain('data-state="synced"');
    expect(html).toContain('data-durable="true"');
    expect(html).toContain("Synchronisé");
  });

  it("does not acknowledge visible input before the editor pipeline settles", () => {
    const { session } = fakeSession(syncState({ kind: "synced" }));
    const html = renderToStaticMarkup(
      createElement(EditorSyncStatus, { session, editorSettled: false }),
    );
    expect(html).toContain('data-state="local-saving"');
    expect(html).toContain('data-durable="false"');
    expect(html).toContain("Enregistrement…");
    expect(html).not.toContain(">Synchronisé<");
  });

  it("offers exactly one recovery action when a commit is blocked", () => {
    const blocked = syncState({
      kind: "blocked",
      synchronizationKind: "blocked",
      locallyDurable: false,
      blockedReason: "quota",
    });
    const { session } = fakeSession(blocked);
    const html = renderToStaticMarkup(createElement(EditorSyncStatus, { session }));
    expect(html).toContain('data-state="blocked"');
    expect(html).toContain('data-durable="false"');
    expect(html).toContain("Réessayer l’enregistrement");
    expect(html).toContain(BLOCKED_REASON_COPY.quota);
  });
});
