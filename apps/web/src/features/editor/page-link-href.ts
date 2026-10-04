/** Browser-safe transport for canonical internal page-link identities. */

import { isUuid, type Uuid } from "@myownnotion/domain";

const PAGE_LINK_HASH_PREFIX = "#page=";
const LEGACY_PAGE_LINK_PREFIX = "myownnotion:page:";

/**
 * BlockNote sanitizes unknown URL schemes when a document is reloaded. A hash
 * keeps the UUID inside an ordinary browser URL while navigation remains owned
 * by the application rather than by the document hierarchy.
 */
export function pageLinkHrefFor(targetItemId: Uuid): string {
  return `${PAGE_LINK_HASH_PREFIX}${targetItemId}`;
}

/** Reads the browser-safe hash, an absolute URL that contains it, and legacy links. */
export function pageLinkTargetFromHref(href: unknown): Uuid | null {
  if (typeof href !== "string") return null;
  const hashIndex = href.lastIndexOf(PAGE_LINK_HASH_PREFIX);
  const candidate =
    hashIndex >= 0
      ? href.slice(hashIndex + PAGE_LINK_HASH_PREFIX.length).split(/[?&#]/u)[0]
      : href.startsWith(LEGACY_PAGE_LINK_PREFIX)
        ? href.slice(LEGACY_PAGE_LINK_PREFIX.length)
        : null;
  return isUuid(candidate) ? candidate : null;
}

export function isPageLinkHref(href: unknown): href is string {
  return pageLinkTargetFromHref(href) !== null;
}
