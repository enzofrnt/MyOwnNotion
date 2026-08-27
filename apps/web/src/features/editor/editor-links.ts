import { isUuid } from "@myownnotion/domain";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorInstance } from "./blocknote-schema.ts";

interface EditorLinkBase {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export type EditorLinkDescriptor =
  | (EditorLinkBase & { readonly kind: "page"; readonly target: string })
  | (EditorLinkBase & { readonly kind: "external"; readonly target: string });

interface PageLinkNode {
  readonly from: number;
  readonly node: ProseMirrorNode;
}

function pageLinkNodeAtPosition(editor: EditorInstance, position: number): PageLinkNode | null {
  const size = editor.prosemirrorState.doc.content.size;
  if (!Number.isFinite(position) || position < 0 || position > size) return null;
  let found: PageLinkNode | null = null;
  editor.prosemirrorState.doc.descendants((node, from) => {
    if (
      found === null &&
      node.type.name === "pageLink" &&
      position >= from &&
      position <= from + node.nodeSize
    ) {
      found = { from, node };
      return false;
    }
    return found === null;
  });
  return found;
}

function pageLinkDescriptor(value: PageLinkNode): EditorLinkDescriptor | null {
  const target = value.node.attrs["targetItemId"];
  if (typeof target !== "string") return null;
  return {
    kind: "page",
    target,
    text: value.node.textContent,
    from: value.from,
    to: value.from + value.node.nodeSize,
  };
}

export function editorLinkAtPosition(
  editor: EditorInstance,
  position: number,
): EditorLinkDescriptor | null {
  const pageLink = pageLinkNodeAtPosition(editor, position);
  if (pageLink !== null) return pageLinkDescriptor(pageLink);
  const size = editor.prosemirrorState.doc.content.size;
  const safePosition = Math.max(0, Math.min(Math.trunc(position), size));
  const external = editor.getLinkMarkAtPos(safePosition);
  return external === undefined
    ? null
    : {
        kind: "external",
        target: external.href,
        text: external.text,
        from: external.from,
        to: external.to,
      };
}

export function selectedEditorLink(editor: EditorInstance): EditorLinkDescriptor | null {
  return editorLinkAtPosition(editor, editor.prosemirrorState.selection.anchor);
}

export function editorLinkFromDomTarget(
  editor: EditorInstance,
  target: EventTarget | null,
): EditorLinkDescriptor | null {
  if (!(target instanceof Element)) return selectedEditorLink(editor);
  const anchor = target.closest("a");
  if (anchor === null) return selectedEditorLink(editor);
  try {
    const position = editor.prosemirrorView.posAtDOM(anchor, 0);
    return editorLinkAtPosition(editor, position) ?? editorLinkAtPosition(editor, position + 1);
  } catch {
    return selectedEditorLink(editor);
  }
}

function currentPageLinkNode(
  editor: EditorInstance,
  link: Extract<EditorLinkDescriptor, { readonly kind: "page" }>,
): PageLinkNode | null {
  const direct = pageLinkNodeAtPosition(editor, link.from);
  if (
    direct !== null &&
    direct.node.attrs["targetItemId"] === link.target &&
    direct.node.textContent === link.text
  ) {
    return direct;
  }
  let matching: PageLinkNode | null = null;
  editor.prosemirrorState.doc.descendants((node, from) => {
    if (
      matching === null &&
      node.type.name === "pageLink" &&
      node.attrs["targetItemId"] === link.target &&
      node.textContent === link.text
    ) {
      matching = { from, node };
      return false;
    }
    return matching === null;
  });
  return matching;
}

export function updateEditorLink(
  editor: EditorInstance,
  link: EditorLinkDescriptor,
  update: { readonly target: string; readonly text: string },
): boolean {
  const text = update.text.trim();
  if (text.length === 0) return false;
  if (link.kind === "external") {
    if (!/^(?:https?|mailto):/u.test(update.target)) return false;
    const current = editor.getLinkMarkAtPos(link.from + 1);
    const linkMark = editor.pmSchema.marks["link"];
    if (current === undefined || linkMark === undefined) return false;
    editor.transact((transaction) => {
      if (current.text === text) {
        transaction.removeMark(current.from, current.to, linkMark);
        transaction.addMark(current.from, current.to, linkMark.create({ href: update.target }));
        return;
      }
      const existingMarks =
        transaction.doc
          .resolve(current.from)
          .nodeAfter?.marks.filter((mark) => mark.type !== linkMark) ?? [];
      transaction.replaceWith(
        current.from,
        current.to,
        editor.pmSchema.text(text, [...existingMarks, linkMark.create({ href: update.target })]),
      );
    });
    return true;
  }
  if (!isUuid(update.target)) return false;
  const current = currentPageLinkNode(editor, link);
  if (current === null) return false;
  editor.transact((transaction) => {
    const to = current.from + current.node.nodeSize;
    transaction.setNodeMarkup(current.from, undefined, {
      ...current.node.attrs,
      targetItemId: update.target,
    });
    if (current.node.textContent !== text) {
      const marks = current.node.firstChild?.marks ?? [];
      transaction.replaceWith(current.from + 1, to - 1, editor.pmSchema.text(text, marks));
    }
  });
  return true;
}

export function removeEditorLink(editor: EditorInstance, link: EditorLinkDescriptor): boolean {
  if (link.kind === "external") {
    const current = editor.getLinkMarkAtPos(link.from + 1);
    const linkMark = editor.pmSchema.marks["link"];
    if (current === undefined || linkMark === undefined) return false;
    editor.transact((transaction) => {
      transaction.removeMark(current.from, current.to, linkMark);
    });
    return true;
  }
  const current = currentPageLinkNode(editor, link);
  if (current === null) return false;
  editor.transact((transaction) => {
    transaction.replaceWith(
      current.from,
      current.from + current.node.nodeSize,
      current.node.content,
    );
  });
  return true;
}

export function openEditorLink(
  link: EditorLinkDescriptor,
  onOpenPage: ((itemId: string) => void) | undefined,
): void {
  if (link.kind === "page") {
    onOpenPage?.(link.target);
    return;
  }
  window.open(link.target, "_blank", "noopener,noreferrer");
}
