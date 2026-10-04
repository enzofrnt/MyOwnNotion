import { derivePageSyncState } from "@myownnotion/client-core";
import type { BlockDocumentV3 } from "@myownnotion/domain";
import { OperationalPageDocument, PageUndoManager } from "@myownnotion/page-state";
import type { DurableEditorSession } from "../features/editor/editor-engine.ts";
import type { EditorDurableSession } from "../features/editor/editor-sync-status.tsx";
import { reviewId } from "./ui-lab-review-fixtures.ts";

/** A V3 authority in memory: no repository, encryption key or server API. */
export function createReviewEditorSession(document: BlockDocumentV3): EditorDurableSession {
  const operational = OperationalPageDocument.create({ pageId: reviewId(42), document });
  const history = new PageUndoManager(operational);
  const authority: DurableEditorSession = {
    read: () => operational.snapshot(),
    transact: async (commands) => ({
      changed: history.execute(Array.isArray(commands) ? commands : [commands]) !== null,
      document: operational.snapshot(),
    }),
    undo: async () => ({ changed: history.undo() !== null, document: operational.snapshot() }),
    redo: async () => ({ changed: history.redo() !== null, document: operational.snapshot() }),
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
    canonicalBlockIdForIdentity: (id) => operational.canonicalBlockIdForIdentity(id),
  };
  return Object.assign(authority, {
    sync: derivePageSyncState({
      localCommit: "idle",
      online: false,
      importingRemote: false,
      operationState: null,
      updates: [],
      ambiguities: [],
    }),
    recoveryBuffer: null,
    subscribe: () => () => undefined,
  }) as unknown as EditorDurableSession;
}
