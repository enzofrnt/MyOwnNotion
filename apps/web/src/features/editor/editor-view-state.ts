/**
 * Scroll restoration by content anchor (T116, FR-009, SC-008).
 *
 * A pixel offset describes a layout, not a place in the document: fonts load,
 * images arrive, blocks above were deleted on another device. The anchor is
 * therefore the first block visible at the top of the viewport plus how far
 * into it the owner had scrolled, with the raw pixel kept only as a fallback
 * for a document that no longer contains any remembered block.
 */

import type { PageScrollAnchor } from "@myownnotion/client-core";

const BLOCK_SELECTOR = ".bn-block-outer[data-id]";

function rootElement(root: ParentNode): Element | null {
  if (root instanceof Element) return root;
  return root.querySelector(BLOCK_SELECTOR);
}

/** The workspace owns scrolling internally so its top chrome never moves. */
export function editorScrollContainer(root: ParentNode = document): HTMLElement | null {
  return rootElement(root)?.closest<HTMLElement>(".workspace-main") ?? null;
}

/**
 * Describes the top of the viewport as {blockId, offset}. Returns null when
 * no editor block exists yet (empty page, still loading).
 */
export function captureScrollAnchor(root: ParentNode = document): PageScrollAnchor | null {
  const blocks = root.querySelectorAll(BLOCK_SELECTOR);
  if (blocks.length === 0) return null;
  const scroller = editorScrollContainer(root);
  const viewportTop = scroller?.getBoundingClientRect().top ?? 0;
  let topBlock: Element | null = null;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.bottom > viewportTop) {
      topBlock = block;
      break;
    }
  }
  const element = topBlock ?? blocks[blocks.length - 1];
  if (element === null || element === undefined) return null;
  const rect = element.getBoundingClientRect();
  const blockId = element.getAttribute("data-id");
  if (blockId === null) return null;
  return {
    blockId,
    // How far into the block the viewport top sits; clamped so a block
    // partially above the fold still restores to its own top.
    offset: Math.max(0, Math.round(viewportTop - rect.top)),
    fallbackPixel: Math.max(0, Math.round(scroller?.scrollTop ?? window.scrollY)),
  };
}

/**
 * Scrolls the remembered block back under the viewport top. Falls back to the
 * recorded pixel when the block was deleted or renamed out of reach, and
 * reports whether the anchor itself could be honoured.
 */
export function restoreScrollAnchor(
  anchor: PageScrollAnchor,
  root: ParentNode = document,
): boolean {
  const target =
    anchor.blockId === null
      ? null
      : root.querySelector(`${BLOCK_SELECTOR}[data-id="${anchor.blockId}"]`);
  if (target === null) {
    const scroller = editorScrollContainer(root);
    if (scroller === null) window.scrollTo({ top: anchor.fallbackPixel });
    else scroller.scrollTo({ top: anchor.fallbackPixel });
    return false;
  }
  const scroller = editorScrollContainer(root);
  if (scroller === null) {
    // rect.top is relative to the current viewport; converting to an absolute
    // document position and adding the remembered depth puts the same content
    // back under the viewport top.
    const top = target.getBoundingClientRect().top + window.scrollY + anchor.offset;
    window.scrollTo({ top });
  } else {
    const targetTop =
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop +
      anchor.offset;
    scroller.scrollTo({ top: targetTop });
  }
  return true;
}
