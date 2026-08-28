import { isUuid } from "@myownnotion/domain";
import { Fragment, type Mark, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorInstance } from "./blocknote-schema.ts";

interface EditorLinkBase {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export type EditorLinkTarget =
  | { readonly kind: "page"; readonly target: string }
  | { readonly kind: "external"; readonly target: string };

export type EditorLinkDescriptor = EditorLinkBase & EditorLinkTarget;

export interface EditorLinkSelectionRange {
  readonly from: number;
  readonly to: number;
}

export interface EditorLinkCreation extends EditorLinkSelectionRange {
  readonly text: string;
}

export interface EditorPageLinkOption {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind?: "page" | "folder";
  readonly icon?: string | null;
  readonly parentItemId?: string | null;
}

interface PageLinkNode {
  readonly from: number;
  readonly node: ProseMirrorNode;
}

interface CurrentEditorLink {
  readonly from: number;
  readonly to: number;
  readonly content: Fragment;
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

function currentEditorLink(
  editor: EditorInstance,
  link: EditorLinkDescriptor,
): CurrentEditorLink | null {
  if (link.kind === "page") {
    const current = currentPageLinkNode(editor, link);
    return current === null
      ? null
      : {
          from: current.from,
          to: current.from + current.node.nodeSize,
          content: current.node.content,
        };
  }
  const current = editor.getLinkMarkAtPos(link.from + 1);
  return current === undefined
    ? null
    : {
        from: current.from,
        to: current.to,
        content: editor.prosemirrorState.doc.slice(current.from, current.to).content,
      };
}

function mapInlineMarks(
  content: Fragment,
  mapMarks: (marks: readonly Mark[]) => readonly Mark[],
): Fragment {
  const children: ProseMirrorNode[] = [];
  content.forEach((node) => {
    const mappedContent =
      node.content.size === 0 ? node.content : mapInlineMarks(node.content, mapMarks);
    const mapped = node.content.size === 0 ? node : node.copy(mappedContent);
    children.push(mapped.mark(mapMarks(mapped.marks)));
  });
  return Fragment.fromArray(children);
}

function firstTextMarks(content: Fragment): readonly Mark[] {
  let marks: readonly Mark[] = [];
  content.forEach((node) => {
    if (marks.length === 0 && node.isText) marks = node.marks;
  });
  return marks;
}

function replacementForTarget(
  editor: EditorInstance,
  content: Fragment,
  originalText: string,
  text: string,
  target: EditorLinkTarget,
): ProseMirrorNode | Fragment | null {
  const linkMark = editor.pmSchema.marks["link"];
  const pageLink = editor.pmSchema.nodes["pageLink"];
  if (linkMark === undefined || pageLink === undefined) return null;
  const withoutLinks = (marks: readonly Mark[]) => marks.filter((mark) => mark.type !== linkMark);
  const baseContent =
    text === originalText && content.size > 0
      ? mapInlineMarks(content, withoutLinks)
      : Fragment.from(editor.pmSchema.text(text, withoutLinks(firstTextMarks(content)) as Mark[]));
  if (target.kind === "page") {
    if (!isUuid(target.target) || !pageLink.validContent(baseContent)) return null;
    return pageLink.create({ targetItemId: target.target }, baseContent);
  }
  const href = normalizeExternalLinkTarget(target.target);
  if (href === null) return null;
  return mapInlineMarks(baseContent, (marks) => [
    ...withoutLinks(marks),
    linkMark.create({ href }),
  ]);
}

export function editorLinkCreationFromSelection(editor: EditorInstance): EditorLinkCreation | null {
  const { from, to, $from, $to } = editor.prosemirrorState.selection;
  if (!$from.sameParent($to) || !$from.parent.inlineContent) return null;
  return {
    from,
    to,
    text: editor.prosemirrorState.doc.textBetween(from, to, " "),
  };
}

export function createEditorLink(
  editor: EditorInstance,
  range: EditorLinkSelectionRange,
  update: EditorLinkTarget & { readonly text: string },
): boolean {
  const text = update.text.trim();
  if (text.length === 0) return false;
  const { from, to } = range;
  const state = editor.prosemirrorState;
  if (from < 0 || to < from || to > state.doc.content.size) return false;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.inlineContent) return false;
  const content = state.doc.slice(from, to).content;
  const originalText = state.doc.textBetween(from, to, " ");
  const replacement = replacementForTarget(editor, content, originalText, text, update);
  if (replacement === null) return false;
  editor.transact((transaction) => {
    transaction.replaceWith(from, to, replacement);
    return true;
  });
  return true;
}

export function updateEditorLink(
  editor: EditorInstance,
  link: EditorLinkDescriptor,
  update: {
    readonly kind?: EditorLinkTarget["kind"];
    readonly target: string;
    readonly text: string;
  },
): boolean {
  const text = update.text.trim();
  if (text.length === 0) return false;
  const current = currentEditorLink(editor, link);
  if (current === null) return false;
  const target = { kind: update.kind ?? link.kind, target: update.target } as EditorLinkTarget;
  const replacement = replacementForTarget(editor, current.content, link.text, text, target);
  if (replacement === null) return false;
  editor.transact((transaction) => {
    transaction.replaceWith(current.from, current.to, replacement);
    return true;
  });
  return true;
}

export function removeEditorLink(editor: EditorInstance, link: EditorLinkDescriptor): boolean {
  const current = currentEditorLink(editor, link);
  if (current === null) return false;
  const linkMark = editor.pmSchema.marks["link"];
  if (linkMark === undefined) return false;
  const text = mapInlineMarks(current.content, (marks) =>
    marks.filter((mark) => mark.type !== linkMark),
  );
  editor.transact((transaction) => {
    transaction.replaceWith(current.from, current.to, text);
    transaction.removeStoredMark(linkMark);
    return true;
  });
  return true;
}

export function normalizeExternalLinkTarget(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/u.test(trimmed)) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed)
    ? trimmed
    : /^(?:localhost|(?:[\p{L}\d-]+\.)+[\p{L}]{2,})(?::\d+)?(?:[/#?].*)?$/iu.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (candidate === null) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** Enforces the canonical non-inclusive right boundary for links before fresh input. */
export function clearStaleLinkTypingState(editor: EditorInstance): boolean {
  const state = editor.prosemirrorState;
  if (!state.selection.empty) return false;
  const linkMark = editor.pmSchema.marks["link"];
  if (linkMark === undefined) return false;
  const activeMarks = state.storedMarks ?? state.selection.$from.marks();
  if (!activeMarks.some((mark) => mark.type === linkMark)) return false;
  const anchor = state.selection.anchor;
  const link = editorLinkAtPosition(editor, anchor);
  if (link?.kind === "external" && anchor > link.from && anchor < link.to) return false;
  editor.transact((transaction) => {
    transaction.removeStoredMark(linkMark);
    return true;
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
