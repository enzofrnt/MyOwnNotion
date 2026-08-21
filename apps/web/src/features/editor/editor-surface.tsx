import type { ProjectedItem } from "@myownnotion/client-core";
import type { BlockDocument, Uuid } from "@myownnotion/domain";
import { PageEditor, type PageEditorHandle } from "./page-editor.tsx";

export type EditorSurfaceHandle = PageEditorHandle;

/** Compatibility boundary kept while the legacy v2 save path remains active. */
export function EditorSurface({
  document,
  editable,
  handleRef,
  currentItemId,
  items,
  onOpenPage,
}: {
  readonly document: BlockDocument;
  readonly editable: boolean;
  readonly handleRef: React.RefObject<EditorSurfaceHandle | null>;
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
  readonly onOpenPage?: ((itemId: string) => void) | undefined;
}) {
  return (
    <PageEditor
      pageId={currentItemId as Uuid}
      document={document}
      editable={editable}
      handleRef={handleRef}
      items={items}
      onOpenPage={onOpenPage}
    />
  );
}
