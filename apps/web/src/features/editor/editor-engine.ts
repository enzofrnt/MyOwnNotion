/**
 * The single seam between the visible BlockNote surface and a page authority.
 *
 * Two engines implement it. The memory engine keeps today's behaviour: an
 * in-memory operational document whose only durability is the legacy save
 * bridge. The session engine delegates to a `PageEditingSession`, which makes
 * every transaction durable on this device before acknowledging it (FR-052).
 * Everything above this seam — adapter, menus, shortcuts, remote adoption —
 * is written against the interface, so switching a page from one authority to
 * the other changes nothing about how gestures are translated.
 */

import type { PageEditingSession } from "@myownnotion/client-core";
import type { BlockDocument, BlockDocumentV3, Uuid } from "@myownnotion/domain";
import { migrateDocumentV2ToV3 } from "@myownnotion/domain";
import type { PageCommand } from "@myownnotion/page-state";
import { OperationalPageDocument, PageUndoManager } from "@myownnotion/page-state";
import { ensureEditableDocument } from "./blocknote-conversion.ts";

export interface EditorEngineResult {
  readonly changed: boolean;
  readonly document: BlockDocumentV3;
}

export interface EditorEngine {
  /** The authoritative document, projected canonically. */
  snapshot(): BlockDocumentV3;
  apply(commands: readonly PageCommand[]): Promise<EditorEngineResult>;
  undo(): Promise<EditorEngineResult>;
  redo(): Promise<EditorEngineResult>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  canonicalBlockIdForIdentity(blockId: Uuid): Uuid | null;
}

/**
 * The part of a durable editing session the editor surface needs. Both the
 * active session and an offline semantic-branch session satisfy it, which is
 * what lets one editor mount over either authority without branching.
 */
export interface DurableEditorSession {
  read(): BlockDocumentV3;
  transact(commands: PageCommand | readonly PageCommand[]): Promise<{
    changed: boolean;
    document: BlockDocumentV3;
  }>;
  undo(): Promise<{ changed: boolean; document: BlockDocumentV3 }>;
  redo(): Promise<{ changed: boolean; document: BlockDocumentV3 }>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  canonicalBlockIdForIdentity(blockId: Uuid): Uuid | null;
}

function resultOf(changed: boolean, document: BlockDocumentV3): EditorEngineResult {
  return changed ? { changed: true, document } : { changed: false, document };
}

/**
 * The pre-session authority: correct in memory, durable only through the
 * legacy save bridge. Kept behind the same interface so pages that cannot
 * open a session yet (never activated, offline) stay editable exactly as
 * before, with no second code path in the editor itself.
 *
 * The caller owns the instance's lifetime: one engine per mounted surface,
 * created once, so a parent re-render never resets the operational history.
 */
export function createMemoryEditorEngine(pageId: Uuid, document: BlockDocument): EditorEngine {
  const operational = OperationalPageDocument.create({
    pageId,
    document: ensureEditableDocument(migrateDocumentV2ToV3(document)),
  });
  const history = new PageUndoManager(operational);
  return {
    snapshot: () => operational.snapshot(),
    apply: async (commands) => resultOf(history.execute(commands) !== null, operational.snapshot()),
    undo: async () => resultOf(history.undo() !== null, operational.snapshot()),
    redo: async () => resultOf(history.redo() !== null, operational.snapshot()),
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
    canonicalBlockIdForIdentity: (blockId) => operational.canonicalBlockIdForIdentity(blockId),
  };
}

/**
 * The durable authority: every applied command list becomes one encrypted,
 * atomically committed local transaction before the promise resolves
 * (FR-052). Undo and redo are transactions like any other, and a commit that
 * raced a remote merge resolves to the merged document, never to a stale
 * local-only view.
 */
export function createSessionEditorEngine(session: DurableEditorSession): EditorEngine {
  return {
    snapshot: () => session.read(),
    apply: async (commands) => {
      const result = await session.transact(commands);
      return resultOf(result.changed, result.document);
    },
    undo: async () => {
      const result = await session.undo();
      return resultOf(result.changed, result.document);
    },
    redo: async () => {
      const result = await session.redo();
      return resultOf(result.changed, result.document);
    },
    get canUndo() {
      return session.canUndo;
    },
    get canRedo() {
      return session.canRedo;
    },
    canonicalBlockIdForIdentity: (blockId) => session.canonicalBlockIdForIdentity(blockId),
  };
}

/** Narrowing helper: only the active session adopts remote merges. */
export function isActiveSession(session: unknown): session is PageEditingSession {
  return typeof session === "object" && session !== null && "adoptDurablePage" in session;
}
