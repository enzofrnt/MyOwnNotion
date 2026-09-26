/**
 * AFFiNE-style dotted canvas background helpers.
 *
 * Pure CSS `radial-gradient` dots; callers sync `background-position` and
 * `background-size` when the viewport pans or zooms. See
 * `docs/design/affine-dotted-canvas-background.md`.
 */

export const DOTTED_CANVAS_GAP_BASE = 20;
export const DOTTED_CANVAS_GAP_MIN = 10;
export const DOTTED_CANVAS_GAP_MAX = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Gap between dots in CSS pixels for a given zoom (AFFiNE `getBgGridGap`). */
export function getDottedCanvasGap(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const step = safeZoom < 0.5 ? 2 : 1 / (Math.floor(safeZoom) || 1);
  return Math.round(
    clamp(DOTTED_CANVAS_GAP_BASE * step * safeZoom, DOTTED_CANVAS_GAP_MIN, DOTTED_CANVAS_GAP_MAX),
  );
}

export interface DottedCanvasViewport {
  readonly zoom: number;
  /** Screen-space pan offset in CSS pixels (positive = dots shift right). */
  readonly translateX: number;
  readonly translateY: number;
}

/** Apply pan/zoom to a `.ui-dotted-canvas-background` host. */
export function updateDottedCanvasBackground(
  element: HTMLElement,
  viewport: DottedCanvasViewport,
): void {
  const gap = getDottedCanvasGap(viewport.zoom);
  element.style.backgroundPosition = `${viewport.translateX}px ${viewport.translateY}px`;
  element.style.backgroundSize = `${gap}px ${gap}px`;
}
