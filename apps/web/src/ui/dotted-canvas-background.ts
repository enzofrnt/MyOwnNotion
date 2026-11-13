/**
 * AFFiNE-style dotted canvas background helpers.
 *
 * Pure CSS `radial-gradient` dots; callers sync `background-position` and
 * `background-size` when the viewport pans or zooms. The technique follows
 * `docs/design/affine-dotted-canvas-background.md`; the gap formula differs
 * (see `getDottedCanvasGap`).
 */

export const DOTTED_CANVAS_GAP_BASE = 20;
/** On-screen gap stays in [MIN, 2 × MIN): dense enough to read, never a haze. */
export const DOTTED_CANVAS_GAP_MIN = 14;

/**
 * Gap between dots in CSS pixels for a given zoom.
 *
 * The lattice is locked to the world: its world spacing is the base gap times
 * a power of two, and the screen gap is exactly that spacing times the zoom —
 * never rounded, never clamped. Dots therefore stay glued to the content
 * while zooming, and when the spacing doubles or halves, every remaining dot
 * keeps its place (one lattice is a subset of the other). AFFiNE's original
 * formula rounds and clamps the gap, which makes dots drift and jump during a
 * fast zoom.
 */
export function getDottedCanvasGap(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const level = Math.ceil(Math.log2(DOTTED_CANVAS_GAP_MIN / (DOTTED_CANVAS_GAP_BASE * safeZoom)));
  return DOTTED_CANVAS_GAP_BASE * 2 ** level * safeZoom;
}

/** Keeps the offset small: huge pans lose sub-pixel precision in CSS lengths. */
function wrap(value: number, period: number): number {
  return Number((((value % period) + period) % period).toFixed(3));
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
  // A gradient dot sits at the centre of its tile. Shifting by half a tile
  // puts dots on the world origin and its multiples, which is what keeps two
  // lattice levels aligned across a spacing change.
  const offsetX = wrap(viewport.translateX - gap / 2, gap);
  const offsetY = wrap(viewport.translateY - gap / 2, gap);
  element.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
  element.style.backgroundSize = `${gap}px ${gap}px`;
}
