/** Internal page-link mark: a canonical target, never a hierarchy placement. */

import type { ProjectedItem } from "@myownnotion/client-core";
import { Mark } from "@tiptap/core";
import { pageLinkHrefFor } from "./page-link-href.ts";

export { pageLinkHrefFor } from "./page-link-href.ts";

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
        href:
          typeof targetItemId === "string"
            ? pageLinkHrefFor(targetItemId as Parameters<typeof pageLinkHrefFor>[0])
            : "#",
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
