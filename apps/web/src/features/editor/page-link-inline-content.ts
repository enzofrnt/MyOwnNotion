/** BlockNote-owned rendering for canonical internal page references. */

import {
  createInlineContentSpec,
  type DefaultStyleSchema,
  type InlineContentFromConfig,
} from "@blocknote/core";
import type { ProjectedItem } from "@myownnotion/client-core";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ItemIcon, type ItemIconKind } from "../../ui/item-icon.tsx";
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
  // The canonical fallback label remains styled content for export and
  // recovery. The node view deliberately omits contentDOM, making that content
  // a ProseMirror black box while the visible label resolves dynamically.
  content: "styled",
} as const;

type PageLinkInlineContent = InlineContentFromConfig<typeof pageLinkConfig, DefaultStyleSchema>;
type PresentationItem = Pick<
  ProjectedItem,
  "id" | "lifecycle" | "name" | "icon" | "kind" | "placements"
>;

interface PageLinkBinding {
  readonly anchor: HTMLAnchorElement;
  readonly iconRoot: Root;
  readonly label: HTMLElement;
  readonly targetItemId: string;
  readonly fallbackLabel: string;
}

export interface ResolvedPageLinkPresentation {
  readonly state: PageLinkTargetState;
  readonly label: string;
  readonly icon: string | null;
  readonly kind: ItemIconKind;
  readonly reference: boolean;
}

const itemsByEditor = new WeakMap<object, readonly PresentationItem[]>();
const currentPageByEditor = new WeakMap<object, string>();
const bindingsByEditor = new WeakMap<object, Set<PageLinkBinding>>();
const openPageByEditor = new WeakMap<object, (itemId: string) => void>();

function hierarchyParentId(item: PresentationItem): string | null {
  return item.placements.find((placement) => placement.kind === "hierarchy")?.parentItemId ?? null;
}

export function resolvePageLinkPresentation(
  targetItemId: string,
  fallbackLabel: string,
  currentPageId: string,
  items: readonly PresentationItem[],
): ResolvedPageLinkPresentation {
  const target = items.find((item) => item.id === targetItemId);
  const state = pageLinkTargetState(targetItemId, items);
  return {
    state,
    label: target?.name.trim() || fallbackLabel.trim() || "Sans titre",
    icon: target?.icon ?? null,
    kind: target?.kind ?? "page",
    // A direct child is part of the current page. Every other occurrence is an
    // explicit reference and receives the small relation badge.
    reference: target === undefined || hierarchyParentId(target) !== currentPageId,
  };
}

function applyPresentation(editor: object, binding: PageLinkBinding): void {
  const presentation = resolvePageLinkPresentation(
    binding.targetItemId,
    binding.fallbackLabel,
    currentPageByEditor.get(editor) ?? "",
    itemsByEditor.get(editor) ?? [],
  );
  const { className, suffix } = pageLinkStatePresentation(presentation.state);
  binding.anchor.className = className;
  binding.label.textContent = presentation.label;
  binding.iconRoot.render(
    createElement(ItemIcon, {
      kind: presentation.kind,
      icon: presentation.icon,
      reference: presentation.reference,
      size: "inline",
    }),
  );
  binding.anchor.setAttribute("aria-label", `${presentation.label}${suffix}`);
  if (suffix === "") {
    binding.anchor.removeAttribute("data-page-link-state");
    binding.anchor.removeAttribute("title");
    return;
  }
  binding.anchor.dataset["pageLinkState"] = presentation.state;
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
    binding.iconRoot.unmount();
    if (bindings.size === 0) bindingsByEditor.delete(editor);
  };
}

/** Refreshes names, emoji and relation badges without rewriting page content. */
export function updatePageLinkPresentations(
  editor: object,
  items: readonly PresentationItem[],
  currentPageId: string,
  onOpenPage?: (itemId: string) => void,
): void {
  itemsByEditor.set(editor, items);
  currentPageByEditor.set(editor, currentPageId);
  if (onOpenPage === undefined) openPageByEditor.delete(editor);
  else openPageByEditor.set(editor, onOpenPage);
  for (const binding of bindingsByEditor.get(editor) ?? []) applyPresentation(editor, binding);
}

export function pageLinkFallbackLabel(inlineContent: {
  readonly content: readonly { readonly text: string }[];
}): string {
  return (
    inlineContent.content
      .map((content) => content.text)
      .join("")
      .trim() || "Sans titre"
  );
}

/** Recovers the stored label from live, clipboard or export HTML. */
export function pageLinkLabelFromElement(element: HTMLElement): string {
  const labeled = element.querySelector(".page-link__label")?.textContent?.trim();
  if (labeled !== undefined && labeled !== "") return labeled;
  const aria = element.getAttribute("aria-label")?.trim();
  if (aria !== undefined && aria !== "") {
    return aria.replace(/\s*\([^)]*\)\s*$/u, "").trim() || "Sans titre";
  }
  const text = element.textContent?.trim();
  return text !== undefined && text !== "" ? text : "Sans titre";
}

function serializePageLink(inlineContent: PageLinkInlineContent): {
  readonly dom: HTMLAnchorElement;
  readonly contentDOM: HTMLSpanElement;
} {
  const targetItemId = inlineContent.props.targetItemId;
  const target = pageLinkTargetFromHref(`#page=${targetItemId}`);
  const anchor = document.createElement("a");
  if (target !== null) {
    anchor.setAttribute("href", pageLinkHrefFor(target));
    anchor.dataset["pageLinkTarget"] = target;
  } else {
    anchor.setAttribute("href", "#");
  }
  anchor.className = "page-link";
  const contentDOM = document.createElement("span");
  contentDOM.className = "page-link__label";
  anchor.append(contentDOM);
  return { dom: anchor, contentDOM };
}

function renderPageLink(
  inlineContent: PageLinkInlineContent,
  editor: object,
): { dom: HTMLAnchorElement; destroy: () => void } {
  const targetItemId = inlineContent.props.targetItemId;
  const fallbackLabel = pageLinkFallbackLabel(inlineContent);
  const target = pageLinkTargetFromHref(`#page=${targetItemId}`);
  const anchor = document.createElement("a");
  anchor.href = target === null ? "#" : pageLinkHrefFor(target);
  anchor.dataset["pageLinkTarget"] = targetItemId;
  anchor.contentEditable = "false";
  anchor.draggable = false;

  const icon = document.createElement("span");
  icon.className = "page-link__icon";
  const iconRoot = createRoot(icon);
  const label = document.createElement("span");
  label.className = "page-link__label";
  anchor.append(icon, label);

  const openTarget = (event: MouseEvent): void => {
    const currentTarget = pageLinkTargetFromHref(anchor.getAttribute("href"));
    if (currentTarget === null) return;
    event.preventDefault();
    event.stopPropagation();
    openPageByEditor.get(editor)?.(currentTarget);
  };
  anchor.addEventListener("click", openTarget);

  const binding = {
    anchor,
    iconRoot,
    label,
    targetItemId,
    fallbackLabel,
  };
  const unregister = registerBinding(editor, binding);
  return {
    dom: anchor,
    destroy: () => {
      anchor.removeEventListener("click", openTarget);
      unregister();
    },
  };
}

export const pageLinkInlineContentSpec = createInlineContentSpec(pageLinkConfig, {
  runsBefore: ["link"],
  parse: (element) => {
    if (element.tagName !== "A") return undefined;
    const target =
      pageLinkTargetFromHref(element.getAttribute("href")) ??
      pageLinkTargetFromHref(`#page=${element.getAttribute("data-page-link-target") ?? ""}`) ??
      pageLinkTargetFromHref(`#page=${element.getAttribute("data-target-item-id") ?? ""}`);
    if (target === null) return undefined;
    return { targetItemId: target };
  },
  parseContent: ({ el, schema }) => {
    const label = pageLinkLabelFromElement(el);
    return schema.nodes["paragraph"]?.create(null, schema.text(label)).content;
  },
  render: (inlineContent, _updateInlineContent, editor, _node, getPos) => {
    const pageLink = inlineContent as PageLinkInlineContent;
    // Clipboard and export call render() without a live position. React roots
    // there produce an empty <a> that drop/parse then lose.
    if (getPos === undefined || getPos() === undefined) return serializePageLink(pageLink);
    return renderPageLink(pageLink, editor);
  },
  toExternalHTML: (inlineContent) => serializePageLink(inlineContent as PageLinkInlineContent),
});
