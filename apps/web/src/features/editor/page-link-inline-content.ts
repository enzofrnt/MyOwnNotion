/** BlockNote-owned rendering for canonical internal page links. */

import {
  createInlineContentSpec,
  type DefaultStyleSchema,
  type InlineContentFromConfig,
} from "@blocknote/core";
import type { ProjectedItem } from "@myownnotion/client-core";
import {
  type PageLinkTargetState,
  pageLinkStatePresentation,
  pageLinkTargetState,
} from "./page-link.ts";
import { pageLinkHrefFor, pageLinkTargetFromHref } from "./page-link-href.ts";

const pageLinkConfig = {
  type: "pageLink",
  propSchema: {
    targetItemId: { default: "" },
  },
  content: "styled",
} as const;

type PageLinkInlineContent = InlineContentFromConfig<typeof pageLinkConfig, DefaultStyleSchema>;
type PresentationItem = Pick<ProjectedItem, "id" | "lifecycle">;

interface PageLinkBinding {
  readonly anchor: HTMLAnchorElement;
  readonly content: HTMLElement;
  readonly targetItemId: string;
}

const itemsByEditor = new WeakMap<object, readonly PresentationItem[]>();
const bindingsByEditor = new WeakMap<object, Set<PageLinkBinding>>();
const openPageByEditor = new WeakMap<object, (itemId: string) => void>();

function stateFor(editor: object, targetItemId: string): PageLinkTargetState {
  return pageLinkTargetState(targetItemId, itemsByEditor.get(editor) ?? []);
}

function applyPresentation(editor: object, binding: PageLinkBinding): void {
  const state = stateFor(editor, binding.targetItemId);
  const { className, suffix } = pageLinkStatePresentation(state);
  binding.anchor.className = className;
  if (suffix === "") {
    binding.anchor.removeAttribute("data-page-link-state");
    binding.anchor.removeAttribute("aria-label");
    binding.anchor.removeAttribute("title");
    return;
  }
  const label = binding.content.textContent?.trim() || "Lien interne";
  binding.anchor.dataset["pageLinkState"] = state;
  binding.anchor.setAttribute("aria-label", `${label}${suffix}`);
  binding.anchor.title = suffix.trim().replace(/^\(|\)$/gu, "");
}

function registerBinding(editor: object, binding: PageLinkBinding): () => void {
  const existing = bindingsByEditor.get(editor);
  const bindings = existing ?? new Set<PageLinkBinding>();
  if (existing === undefined) bindingsByEditor.set(editor, bindings);
  bindings.add(binding);
  applyPresentation(editor, binding);
  return () => {
    bindings.delete(binding);
    if (bindings.size === 0) bindingsByEditor.delete(editor);
  };
}

/**
 * Updates page-link presentation without touching ProseMirror-owned DOM from
 * outside its node views. Custom inline node views explicitly ignore their
 * own attribute mutations, so a target changing state cannot start the
 * mutation/reparse loop that previously froze the editor.
 */
export function updatePageLinkPresentations(
  editor: object,
  items: readonly PresentationItem[],
  onOpenPage?: (itemId: string) => void,
): void {
  itemsByEditor.set(editor, items);
  if (onOpenPage === undefined) openPageByEditor.delete(editor);
  else openPageByEditor.set(editor, onOpenPage);
  for (const binding of bindingsByEditor.get(editor) ?? []) {
    applyPresentation(editor, binding);
  }
}

function renderPageLink(
  inlineContent: PageLinkInlineContent,
  editor: object,
): { dom: HTMLAnchorElement; contentDOM: HTMLElement; destroy: () => void } {
  const targetItemId = inlineContent.props.targetItemId;
  const target = pageLinkTargetFromHref(`#page=${targetItemId}`);
  const anchor = document.createElement("a");
  anchor.href = target === null ? "#" : pageLinkHrefFor(target);
  anchor.dataset["pageLinkTarget"] = targetItemId;
  const openTarget = (event: MouseEvent): void => {
    const currentTarget = pageLinkTargetFromHref(anchor.getAttribute("href"));
    if (currentTarget === null) return;
    event.preventDefault();
    event.stopPropagation();
    openPageByEditor.get(editor)?.(currentTarget);
  };
  anchor.addEventListener("click", openTarget);
  const contentDOM = document.createElement("span");
  anchor.append(contentDOM);

  const binding = { anchor, content: contentDOM, targetItemId };
  const unregister = registerBinding(editor, binding);
  const textObserver = new MutationObserver(() => applyPresentation(editor, binding));
  textObserver.observe(contentDOM, { childList: true, subtree: true, characterData: true });

  return {
    dom: anchor,
    contentDOM,
    destroy: () => {
      anchor.removeEventListener("click", openTarget);
      textObserver.disconnect();
      unregister();
    },
  };
}

export const pageLinkInlineContentSpec = createInlineContentSpec(pageLinkConfig, {
  // Internal links must claim their tagged/hash anchors before the default
  // external-link parser turns them into generic URL marks.
  runsBefore: ["link"],
  parse: (element) => {
    if (element.tagName !== "A") return undefined;
    const target =
      pageLinkTargetFromHref(element.getAttribute("href")) ??
      pageLinkTargetFromHref(`#page=${element.getAttribute("data-page-link-target") ?? ""}`);
    return target === null ? undefined : { targetItemId: target };
  },
  render: (inlineContent, _updateInlineContent, editor) =>
    renderPageLink(inlineContent as PageLinkInlineContent, editor),
  toExternalHTML: (inlineContent) => {
    const targetItemId = inlineContent.props.targetItemId;
    const target = pageLinkTargetFromHref(`#page=${targetItemId}`);
    if (target === null) return undefined;
    const anchor = document.createElement("a");
    anchor.href = pageLinkHrefFor(target);
    anchor.dataset["pageLinkTarget"] = target;
    anchor.className = "page-link";
    const contentDOM = document.createElement("span");
    anchor.append(contentDOM);
    return { dom: anchor, contentDOM };
  },
});
