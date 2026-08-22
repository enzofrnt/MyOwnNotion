/** Internal page-link mark: a canonical target, never a hierarchy placement. */

import type { ProjectedItem } from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";
import { Mark } from "@tiptap/core";

export const PageLink = Mark.create({
  name: "pageLink",
  inclusive: false,

  addAttributes() {
    return { targetItemId: { default: null } };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-page-link-target]",
        getAttrs: (element) => ({
          targetItemId: element.getAttribute("data-page-link-target"),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const targetItemId = HTMLAttributes["targetItemId"];
    return [
      "a",
      {
        href: typeof targetItemId === "string" ? `#page=${targetItemId}` : "#",
        "data-page-link-target": typeof targetItemId === "string" ? targetItemId : "",
        "aria-label": "Internal page link",
        class: "page-link",
      },
      0,
    ];
  },
});

export type PageLinkTargetState = "active" | "deleted" | "unavailable" | "unknown";

/**
 * Canonical identity over presentation (FR-022, T098).
 *
 * The link keeps its target UUID whatever happens to the target. The state
 * only decides how the link is explained:
 *
 * - `active`: the target exists and is visible;
 * - `deleted`: known to this workspace but trashed or purged;
 * - `unavailable`: not in the local projection yet (offline catch-up, or a
 *   page this device never fetched) — distinct from deleted;
 * - `unknown`: no item carries that id at all.
 */
export function pageLinkTargetState(
  targetItemId: string,
  items: readonly Pick<ProjectedItem, "id" | "lifecycle">[],
): PageLinkTargetState {
  if (!/^[0-9a-f-]{36}$/iu.test(targetItemId)) return "unknown";
  const target = items.find((item) => item.id === targetItemId);
  if (target === undefined) return "unavailable";
  return target.lifecycle === "active" ? "active" : "deleted";
}

/** CSS marker and accessible suffix for a rendered page link. */
export function pageLinkStatePresentation(state: PageLinkTargetState): {
  readonly className: string;
  readonly suffix: string;
} {
  switch (state) {
    case "active":
      return { className: "page-link", suffix: "" };
    case "deleted":
      return { className: "page-link page-link-deleted", suffix: " (cible supprimée)" };
    case "unavailable":
      return { className: "page-link page-link-unavailable", suffix: " (cible indisponible)" };
    case "unknown":
      return { className: "page-link page-link-unknown", suffix: " (cible inconnue)" };
  }
}

export function pageLinkHrefFor(targetItemId: Uuid): string {
  return `myownnotion:page:${targetItemId}`;
}

const PAGE_LINK_HREF_PATTERN = /^myownnotion:page:(.+)$/u;

/**
 * Annotates rendered anchors so target state is visible and announced
 * (FR-022). Idempotent: safe to run after every BlockNote re-render.
 */
export function annotatePageLinkAnchors(
  root: HTMLElement,
  items: readonly Pick<ProjectedItem, "id" | "lifecycle">[],
): void {
  const anchors = root.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const anchor of anchors) {
    const match = PAGE_LINK_HREF_PATTERN.exec(anchor.getAttribute("href") ?? "");
    if (match === null || match[1] === undefined) continue;
    const state = pageLinkTargetState(match[1], items);
    const { className, suffix } = pageLinkStatePresentation(state);
    if (anchor.className !== className) anchor.className = className;
    const label = anchor.textContent ?? "";
    if (suffix !== "" && !label.endsWith(suffix)) {
      anchor.setAttribute("aria-label", `${label}${suffix}`);
      anchor.setAttribute("data-page-link-state", state);
    } else if (suffix === "") {
      anchor.removeAttribute("data-page-link-state");
      anchor.removeAttribute("aria-label");
    }
  }
}
