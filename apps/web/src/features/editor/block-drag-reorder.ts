/** Side-menu block reorder that never HTML-roundtrips page mentions or nests into tables. */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorBlock, EditorInstance } from "./blocknote-schema.ts";

export interface EditorDropPlacement {
  readonly referenceId: string;
  readonly placement: "before" | "after";
}

export interface DropCursorRemap {
  readonly pos: number;
  readonly orientation: "block-horizontal";
}

function isTableStructureType(type: string): boolean {
  return type === "table" || type === "tableRow" || type === "tableCell";
}

export function atomicDropHostId(
  getBlock: (id: string) => Pick<EditorBlock, "id" | "type"> | undefined,
  getParent: (id: string) => Pick<EditorBlock, "id" | "type"> | undefined,
  blockId: string,
): string {
  let current = getBlock(blockId);
  while (current !== undefined && (current.type === "tableRow" || current.type === "tableCell")) {
    const parent = getParent(current.id);
    if (parent === undefined) return current.id;
    current = parent;
  }
  return current?.id ?? blockId;
}

export function dropPlacementFromPoint(
  clientY: number,
  rect: Pick<DOMRect, "top" | "height">,
): "before" | "after" {
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function blockIdFromOuter(element: HTMLElement): string | null {
  const direct = element.getAttribute("data-id") || element.id;
  if (direct !== "") return direct;
  const inner = element.querySelector(":scope > .bn-block");
  if (!(inner instanceof HTMLElement)) return null;
  const nested = inner.getAttribute("data-id") || inner.id;
  return nested === "" ? null : nested;
}

function dropHostElement(clientX: number, clientY: number): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.classList.contains("bn-drag-preview")) continue;
    const tableOuter = node.closest<HTMLElement>(".bn-block-outer:has(> .bn-block > .node-table)");
    if (tableOuter !== null) return tableOuter;
    const outer = node.closest<HTMLElement>(".bn-block-outer");
    if (outer !== null) return outer;
  }
  return null;
}

export function resolveEditorDropPlacement(
  editor: EditorInstance,
  clientX: number,
  clientY: number,
  draggedBlockId: string,
): EditorDropPlacement | null {
  const host = dropHostElement(clientX, clientY);
  if (host === null) return null;
  const rawId = blockIdFromOuter(host);
  if (rawId === null) return null;
  const referenceId = atomicDropHostId(
    (id) => editor.getBlock(id) as Pick<EditorBlock, "id" | "type"> | undefined,
    (id) => editor.getParentBlock(id) as Pick<EditorBlock, "id" | "type"> | undefined,
    rawId,
  );
  if (referenceId === draggedBlockId) return null;
  const reference = editor.getBlock(referenceId);
  if (reference === undefined) return null;
  const placement = dropPlacementFromPoint(clientY, host.getBoundingClientRect());
  if (isAdjacentNoOpPlacement(editor, draggedBlockId, referenceId, placement)) return null;
  return { referenceId, placement };
}

function siblingIds(editor: EditorInstance, blockId: string): readonly string[] {
  const parent = editor.getParentBlock(blockId);
  const siblings = parent === undefined ? editor.document : (parent.children as EditorBlock[]);
  return siblings.map((block) => block.id);
}

export function isAdjacentNoOpPlacement(
  editor: EditorInstance,
  draggedBlockId: string,
  referenceId: string,
  placement: "before" | "after",
): boolean {
  const ids = siblingIds(editor, draggedBlockId);
  const index = ids.indexOf(draggedBlockId);
  if (index < 0) return false;
  return (
    (placement === "after" && ids[index - 1] === referenceId) ||
    (placement === "before" && ids[index + 1] === referenceId)
  );
}

function findBlockContainer(
  doc: ProseMirrorNode,
  blockId: string,
): { readonly pos: number; readonly node: ProseMirrorNode } | null {
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "blockContainer" && node.attrs["id"] === blockId) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  return found;
}

function blockContainerAroundPos(
  doc: ProseMirrorNode,
  pos: number,
  onlyTable = false,
): { readonly pos: number; readonly size: number } | null {
  const resolved = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name !== "blockContainer") continue;
    if (onlyTable && node.firstChild?.type.name !== "table") continue;
    return { pos: resolved.before(depth), size: node.nodeSize };
  }
  return null;
}

function tableContainerAroundPos(
  doc: ProseMirrorNode,
  pos: number,
): { readonly pos: number; readonly size: number } | null {
  return blockContainerAroundPos(doc, pos, true);
}

/** The drop line’s document position, mapped back to a whole-block move. */
export function blockDropTargetAtCursor(
  doc: ProseMirrorNode,
  pos: number,
): EditorDropPlacement | null {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const resolved = doc.resolve(clamped);
  const next = resolved.nodeAfter;
  const after = next?.type.name === "blockGroup" ? next.firstChild : next;
  if (after?.type.name === "blockContainer" && typeof after.attrs["id"] === "string") {
    return { referenceId: after.attrs["id"], placement: "before" };
  }
  const previous = resolved.nodeBefore;
  const before = previous?.type.name === "blockGroup" ? previous.lastChild : previous;
  if (before?.type.name === "blockContainer" && typeof before.attrs["id"] === "string") {
    return { referenceId: before.attrs["id"], placement: "after" };
  }
  return null;
}

/** Drop strokes are always between blocks, never inside a paragraph’s line. */
export function snapDropCursorToBlockEdge(
  doc: ProseMirrorNode,
  pos: number,
  clientY: number,
  hostRect: Pick<DOMRect, "top" | "height"> | null,
): DropCursorRemap {
  const host = tableContainerAroundPos(doc, pos) ?? blockContainerAroundPos(doc, pos);
  if (host === null) return { pos, orientation: "block-horizontal" };
  if (hostRect === null) return { pos: host.pos, orientation: "block-horizontal" };
  return {
    pos: dropPlacementFromPoint(clientY, hostRect) === "before" ? host.pos : host.pos + host.size,
    orientation: "block-horizontal",
  };
}

export function isNoOpDropPosition(
  doc: ProseMirrorNode,
  pos: number,
  draggedBlockId: string,
): boolean {
  const source = findBlockContainer(doc, draggedBlockId);
  if (source === null) return false;
  return (
    (pos >= source.pos && pos <= source.pos + source.node.nodeSize) ||
    blockDropTargetAtCursor(doc, pos)?.referenceId === draggedBlockId
  );
}

function blockContainerIdAtSelection(editor: EditorInstance): string | null {
  const $from = editor.prosemirrorState.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "blockContainer" && typeof node.attrs["id"] === "string") {
      return node.attrs["id"];
    }
  }
  return null;
}

function draggedBlockIdForCursor(editor: EditorInstance): string | null {
  return activeReorder?.blockId ?? blockContainerIdAtSelection(editor);
}

function readingColumnRect(editor: EditorInstance): DOMRect {
  // Other tab sessions stay mounted with zero-size hidden DOM. Their column
  // must never supply the active drag's geometry.
  const editorDOM = editor.prosemirrorView.dom;
  const sample = editorDOM.querySelector<HTMLElement>(
    ":scope > .bn-block-group > .bn-block-outer:not(:has(> .bn-block > .node-table))",
  );
  if (sample !== null) return sample.getBoundingClientRect();
  const editorRect = editorDOM.getBoundingClientRect();
  const styles = getComputedStyle(editorDOM);
  const padStart = Number.parseFloat(styles.paddingInlineStart) || 0;
  const padEnd = Number.parseFloat(styles.paddingInlineEnd) || 0;
  return new DOMRect(
    editorRect.left + padStart,
    editorRect.top,
    Math.max(0, editorRect.width - padStart - padEnd),
    editorRect.height,
  );
}

const DROP_CURSOR_SELECTOR = [
  ".prosemirror-dropcursor-block-horizontal",
  ".prosemirror-dropcursor-block",
  ".prosemirror-dropcursor-inline",
  ".prosemirror-dropcursor-vertical",
  ".prosemirror-dropcursor-block-vertical-left",
  ".prosemirror-dropcursor-block-vertical-right",
].join(", ");

function activeDropCursor(): HTMLElement | null {
  // BlockNote mounts its overlay in this view's offsetParent. Scope to that
  // host so a hidden tab's leftover cursor cannot steal this drag's preview.
  const host = activeReorder?.editor.prosemirrorView.dom.offsetParent;
  return host?.querySelector<HTMLElement>(DROP_CURSOR_SELECTOR) ?? null;
}

/** Keep the drop stroke on the reading column, not the table’s 100cqi breakout. */
export function alignDropCursorToReadingColumn(): void {
  if (activeReorder === null) return;
  const cursor = activeDropCursor();
  const column = readingColumnRect(activeReorder.editor);
  if (cursor === null) return;
  const parent = cursor.offsetParent;
  const parentLeft = parent instanceof HTMLElement ? parent.getBoundingClientRect().left : 0;
  const nextLeft = `${column.left - parentLeft}px`;
  const nextWidth = `${column.width}px`;
  cursor.style.display = "";
  if (cursor.style.left === nextLeft && cursor.style.width === nextWidth) return;
  cursor.style.left = nextLeft;
  cursor.style.width = nextWidth;
}

let alignFrame = 0;
let alignFrameFollowUp = 0;

function cancelScheduledDropCursorAlign(): void {
  if (typeof cancelAnimationFrame === "undefined") return;
  cancelAnimationFrame(alignFrame);
  cancelAnimationFrame(alignFrameFollowUp);
  alignFrame = 0;
  alignFrameFollowUp = 0;
}

function scheduleDropCursorAlign(): void {
  if (activeReorder === null || typeof requestAnimationFrame === "undefined") return;
  cancelScheduledDropCursorAlign();
  alignFrame = requestAnimationFrame(() => {
    alignDropCursorToReadingColumn();
    alignFrameFollowUp = requestAnimationFrame(alignDropCursorToReadingColumn);
  });
}

let dropCursorObserver: MutationObserver | null = null;

function startDropCursorWatch(): void {
  stopDropCursorWatch();
  dropCursorObserver = new MutationObserver(() => {
    alignDropCursorToReadingColumn();
  });
  dropCursorObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style"],
  });
}

function stopDropCursorWatch(): void {
  dropCursorObserver?.disconnect();
  dropCursorObserver = null;
}

/** Hide leftover drop strokes. BlockNote may miss drop/dragend when we intercept the HTML drop. */
export function hideEditorDropCursors(): void {
  if (typeof document === "undefined") return;
  for (const node of document.querySelectorAll<HTMLElement>(DROP_CURSOR_SELECTOR)) {
    node.style.display = "none";
  }
}

function hostRectForPos(editor: EditorInstance, pos: number): DOMRect | null {
  const host =
    tableContainerAroundPos(editor.prosemirrorState.doc, pos) ??
    blockContainerAroundPos(editor.prosemirrorState.doc, pos);
  if (host === null) return null;
  const node = editor.prosemirrorView.nodeDOM(host.pos);
  if (node instanceof HTMLElement) return node.getBoundingClientRect();
  return node?.parentElement?.getBoundingClientRect() ?? null;
}

export function computeEditorDropCursor(context: {
  readonly editor: EditorInstance;
  readonly event: DragEvent;
  readonly defaultPosition: { readonly pos: number; readonly orientation?: string } | null;
}): DropCursorRemap | null {
  if (activeReorder !== null && activeReorder.editor !== context.editor) return null;
  if (context.defaultPosition === null) {
    pendingDropCursor = null;
    return null;
  }
  const doc = context.editor.prosemirrorState.doc;
  // At an outer edge, WebKit's caret position can point to the following block
  // or to the whole group. A side-menu move follows the hovered block geometry;
  // preview and commit then share that same document position.
  const host =
    activeReorder === null ? null : dropHostElement(context.event.clientX, context.event.clientY);
  const rawId = host === null ? null : blockIdFromOuter(host);
  const referenceId =
    rawId === null
      ? null
      : atomicDropHostId(
          (id) => context.editor.getBlock(id),
          (id) => context.editor.getParentBlock(id),
          rawId,
        );
  const reference =
    referenceId === null || host === null || !context.editor.prosemirrorView.dom.contains(host)
      ? null
      : findBlockContainer(doc, referenceId);
  const candidate: DropCursorRemap =
    reference !== null && host !== null
      ? {
          pos:
            dropPlacementFromPoint(context.event.clientY, host.getBoundingClientRect()) === "before"
              ? reference.pos
              : reference.pos + reference.node.nodeSize,
          orientation: "block-horizontal",
        }
      : snapDropCursorToBlockEdge(
          doc,
          context.defaultPosition.pos,
          context.event.clientY,
          hostRectForPos(context.editor, context.defaultPosition.pos),
        );
  const placement = blockDropTargetAtCursor(doc, candidate.pos);
  const destination = placement === null ? null : findBlockContainer(doc, placement.referenceId);
  if (destination === null || placement === null) {
    pendingDropCursor = null;
    return null;
  }
  const remapped: DropCursorRemap = {
    pos:
      placement.placement === "before"
        ? destination.pos
        : destination.pos + destination.node.nodeSize,
    orientation: "block-horizontal",
  };
  const draggedId = draggedBlockIdForCursor(context.editor);
  if (draggedId !== null && isNoOpDropPosition(doc, remapped.pos, draggedId)) {
    pendingDropCursor = null;
    return null;
  }
  pendingDropCursor = remapped;
  scheduleDropCursorAlign();
  return remapped;
}

export function moveEditorBlock(
  editor: EditorInstance,
  blockId: string,
  referenceId: string,
  placement: "before" | "after",
): boolean {
  if (blockId === referenceId) return false;
  const sourceBlock = editor.getBlock(blockId);
  const referenceBlock = editor.getBlock(referenceId);
  if (sourceBlock === undefined || referenceBlock === undefined) return false;
  if (isTableStructureType(sourceBlock.type) && sourceBlock.type !== "table") return false;
  if (isTableStructureType(referenceBlock.type) && referenceBlock.type !== "table") {
    return false;
  }

  return editor.transact((tr) => {
    const source = findBlockContainer(tr.doc, blockId);
    if (source === null) return false;
    const moved = source.node;
    tr.delete(source.pos, source.pos + moved.nodeSize);
    const destination = findBlockContainer(tr.doc, referenceId);
    if (destination === null) return false;
    const insertPos =
      placement === "before" ? destination.pos : destination.pos + destination.node.nodeSize;
    tr.insert(insertPos, moved);
    return true;
  });
}

let activeReorder: { readonly editor: EditorInstance; readonly blockId: string } | null = null;
let pendingDropCursor: DropCursorRemap | null = null;

const BLOCK_GRABBING_ATTRIBUTE = "data-block-grabbing";

function setBlockGrabCursor(active: boolean): void {
  if (typeof document === "undefined") return;
  if (active) document.documentElement.setAttribute(BLOCK_GRABBING_ATTRIBUTE, "true");
  else document.documentElement.removeAttribute(BLOCK_GRABBING_ATTRIBUTE);
}

function isActiveEditorTarget(event: DragEvent): boolean {
  return (
    event.target instanceof Node &&
    activeReorder?.editor.prosemirrorView.dom.contains(event.target) === true
  );
}

function isSideMenuBlockDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("blocknote/html") === true;
}

function onWindowDragOver(event: DragEvent): void {
  if (activeReorder === null || !isSideMenuBlockDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
  // The editor's bubbling dragover validates its destination. Leaving that
  // editor invalidates the earlier preview, including a drop into another tab.
  if (!isActiveEditorTarget(event)) pendingDropCursor = null;
  scheduleDropCursorAlign();
}

function onWindowDrop(event: DragEvent): void {
  const current = activeReorder;
  if (current === null || !isSideMenuBlockDrag(event)) return;
  // Always swallow BlockNote’s HTML drop: it pastes into the paragraph and
  // stacks mentions on the same line instead of moving the whole block.
  event.preventDefault();
  event.stopImmediatePropagation();
  const preview = pendingDropCursor;
  const target =
    // A native dragleave can remove BlockNote's painted overlay before drop.
    // Firefox may also report different dragover/drop coordinates at an edge.
    // The active editor owns the validated destination, never the overlay's DOM.
    preview !== null && isActiveEditorTarget(event)
      ? blockDropTargetAtCursor(current.editor.prosemirrorState.doc, preview.pos)
      : null;
  if (target !== null && target.referenceId !== current.blockId) {
    moveEditorBlock(current.editor, current.blockId, target.referenceId, target.placement);
  }
  endSideMenuBlockReorder();
}

function onWindowDragEnd(): void {
  if (activeReorder === null) return;
  endSideMenuBlockReorder();
}

function notifyEditorDragEnded(editor: EditorInstance): void {
  editor.prosemirrorView.dom.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
}

export function beginSideMenuBlockReorder(editor: EditorInstance, blockId: string): void {
  endSideMenuBlockReorder();
  activeReorder = { editor, blockId };
  pendingDropCursor = null;
  setBlockGrabCursor(true);
  startDropCursorWatch();
  window.addEventListener("dragover", onWindowDragOver, true);
  window.addEventListener("drop", onWindowDrop, true);
  window.addEventListener("dragend", onWindowDragEnd, true);
}

export function endSideMenuBlockReorder(): void {
  const current = activeReorder;
  activeReorder = null;
  pendingDropCursor = null;
  setBlockGrabCursor(false);
  cancelScheduledDropCursorAlign();
  stopDropCursorWatch();
  hideEditorDropCursors();
  window.removeEventListener("dragover", onWindowDragOver, true);
  window.removeEventListener("drop", onWindowDrop, true);
  window.removeEventListener("dragend", onWindowDragEnd, true);
  if (current === null) return;
  notifyEditorDragEnded(current.editor);
}
