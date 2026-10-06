import type { EditorInstance } from "./blocknote-schema.ts";

export interface BlockDragOrigin {
  readonly clientX: number;
  readonly clientY: number;
}

let disposePreview: (() => void) | null = null;

export function endDatabaseDragPreview(): void {
  disposePreview?.();
  disposePreview = null;
}

/** Show the existing clone in the viewport; native bitmap bounds can differ. */
export function beginDatabaseDragPreview(
  editor: EditorInstance,
  blockId: string,
  event: Pick<DragEvent, "dataTransfer" | "clientX" | "clientY">,
  origin: BlockDragOrigin,
): void {
  endDatabaseDragPreview();
  if (event.dataTransfer === null) return;
  const view = editor.prosemirrorView;
  const window = view.dom.ownerDocument.defaultView;
  if (window === null) return;
  const selector = `.bn-block-outer[data-id="${CSS.escape(blockId)}"] .editor-database-view-block`;
  const source = view.dom.querySelector(selector);
  const preview = view.root.querySelector<HTMLElement>(".bn-drag-preview");
  const clonedSource = preview?.querySelector(selector) ?? null;
  if (source === null || preview === null || clonedSource === null) return;

  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width === 0) return;

  // Size the visible clone before measuring its grab anchor: reflow must not
  // change the cursor's offset, or reuse the native preview's compact width.
  preview.classList.add("editor-database-drag-preview");
  preview.style.width = `${sourceRect.width}px`;
  const previewRect = preview.getBoundingClientRect();
  const clonedRect = clonedSource.getBoundingClientRect();

  const anchorX = clonedRect.left - previewRect.left + origin.clientX - sourceRect.left;
  const anchorY = clonedRect.top - previewRect.top + origin.clientY - sourceRect.top;
  const followPointer = (point: Pick<DragEvent, "clientX" | "clientY">): void => {
    preview.style.transform = `translate3d(${point.clientX - anchorX}px, ${point.clientY - anchorY}px, 0)`;
  };
  const followDrag = (point: DragEvent): void => {
    // Firefox leaves source drag coordinates at zero; dragover still works.
    if (point.clientX !== 0 || point.clientY !== 0) followPointer(point);
  };

  // Suppress only the OS bitmap. BlockNote still owns this clone and the drop.
  const emptyImage = view.dom.ownerDocument.createElement("canvas");
  emptyImage.width = 1;
  emptyImage.height = 1;
  emptyImage.style.cssText = "position:fixed;left:0;top:0;pointer-events:none";
  preview.parentNode?.appendChild(emptyImage);
  event.dataTransfer.setDragImage(emptyImage, 0, 0);

  followPointer(event);
  window.addEventListener("drag", followDrag, true);
  window.addEventListener("dragover", followPointer, true);
  window.addEventListener("drop", endDatabaseDragPreview, true);
  window.addEventListener("dragend", endDatabaseDragPreview, true);
  window.addEventListener("pagehide", endDatabaseDragPreview);
  disposePreview = () => {
    window.removeEventListener("drag", followDrag, true);
    window.removeEventListener("dragover", followPointer, true);
    window.removeEventListener("drop", endDatabaseDragPreview, true);
    window.removeEventListener("dragend", endDatabaseDragPreview, true);
    window.removeEventListener("pagehide", endDatabaseDragPreview);
    emptyImage.remove();
    // Do not remove the clone: BlockNote's dragend will remove its own node.
    preview.style.visibility = "hidden";
  };
}
