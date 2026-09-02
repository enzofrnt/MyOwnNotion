import type { ProjectedItem } from "@myownnotion/client-core";
import type { BlockDocument, Uuid } from "@myownnotion/domain";
import { memo } from "react";
import type { CreateSubpage } from "./editor-menus/slash-menu.tsx";
import { PageEditor, type PageEditorHandle } from "./page-editor.tsx";

export type EditorSurfaceHandle = PageEditorHandle;

/**
 * Boundary between the page view and the editor surface.
 *
 * `session` present: every gesture is committed durably by the editing
 * session before it is acknowledged, and no save button exists. Absent: the
 * compatibility path keeps the legacy save bridge alive for pages that cannot
 * open a session yet.
 */
export const EditorSurface = memo(function EditorSurface({
  document,
  editable,
  handleRef,
  currentItemId,
  items,
  onCreateSubpage,
  onOpenPage,
  onSettlementChange,
  session,
  discoverable = true,
}: {
  readonly document: BlockDocument;
  readonly editable: boolean;
  readonly handleRef: React.RefObject<EditorSurfaceHandle | null>;
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
  readonly onCreateSubpage?: CreateSubpage | undefined;
  readonly onOpenPage?: ((itemId: string) => void) | undefined;
  readonly onSettlementChange?: ((settled: boolean) => void) | undefined;
  readonly session?: import("./editor-sync-status.tsx").EditorDurableSession | undefined;
  readonly discoverable?: boolean;
}) {
  return (
    <PageEditor
      pageId={currentItemId as Uuid}
      document={document}
      editable={editable}
      handleRef={handleRef}
      items={items}
      onCreateSubpage={onCreateSubpage}
      onOpenPage={onOpenPage}
      onSettlementChange={onSettlementChange}
      session={session}
      discoverable={discoverable}
    />
  );
});
