/**
 * Camera math for the knowledge graph canvas (spec 010 FR-045).
 *
 * Pinch and two-finger forward/back change zoom only. The world point under
 * the pointer stays put; horizontal trackpad drift never pans. Grabbing the
 * background is the only way to move the view. macOS inertial coasting after
 * a two-finger slide is ignored.
 */
export const GRAPH_ZOOM_MIN = 0.01;
export const GRAPH_ZOOM_MAX = 4;

export function clampGraphZoom(value: number): number {
  return Math.max(GRAPH_ZOOM_MIN, Math.min(GRAPH_ZOOM_MAX, value));
}

export function panAfterZoomAroundPointer(input: {
  readonly panX: number;
  readonly panY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly zoom: number;
  readonly nextZoom: number;
  readonly fractionX: number;
  readonly fractionY: number;
}): { readonly x: number; readonly y: number } {
  const viewWidth = input.viewportWidth / input.zoom;
  const viewHeight = input.viewportHeight / input.zoom;
  const nextWidth = input.viewportWidth / input.nextZoom;
  const nextHeight = input.viewportHeight / input.nextZoom;
  return {
    x: input.panX + input.fractionX * (viewWidth - nextWidth),
    y: input.panY + input.fractionY * (viewHeight - nextHeight),
  };
}

/** One discrete mouse-wheel notch. */
export const GRAPH_WHEEL_STEP = 1.1;
const WHEEL_STEP_MIN = 1 / GRAPH_WHEEL_STEP;

/**
 * Chrome/Safari map pinch to ctrl+wheel in pixels. Follow the fingers: more
 * responsive than 0.0014, without the 0.01 scale that jumped whole levels.
 */
const PINCH_PIXEL_SCALE = 0.006;
const PINCH_STEP_MAX = 1.14;
const PINCH_STEP_MIN = 1 / PINCH_STEP_MAX;

function clampPixelZoomStep(factor: number): number {
  if (factor > PINCH_STEP_MAX) return PINCH_STEP_MAX;
  if (factor < PINCH_STEP_MIN) return PINCH_STEP_MIN;
  return factor;
}

export interface TrackpadCoastState {
  lastAbs: number;
  lastSign: number;
  lastAt: number;
  decreasing: number;
  coasting: boolean;
}

export function createTrackpadCoastState(): TrackpadCoastState {
  return { lastAbs: 0, lastSign: 0, lastAt: 0, decreasing: 0, coasting: false };
}

const COAST_GAP_MS = 80;
const COAST_TICK_MS = 40;
const COAST_DECREASE_COUNT = 3;

function resetTrackpadCoast(state: TrackpadCoastState, now: number): void {
  state.lastAbs = 0;
  state.lastSign = 0;
  state.lastAt = now;
  state.decreasing = 0;
  state.coasting = false;
}

/**
 * macOS two-finger scroll keeps emitting decaying wheel ticks after lift.
 * Pinch (ctrl+wheel) never coasts. A stronger tick or a pause starts a new
 * gesture. Returns true when this tick must not zoom.
 */
export function consumeTrackpadCoast(
  state: TrackpadCoastState,
  event: { readonly ctrlKey: boolean; readonly deltaY: number },
  now: number,
): boolean {
  if (event.ctrlKey) {
    resetTrackpadCoast(state, now);
    return false;
  }
  const abs = Math.abs(event.deltaY);
  const sign = Math.sign(event.deltaY);
  const dt = now - state.lastAt;
  if (dt > COAST_GAP_MS || (sign !== 0 && state.lastSign !== 0 && sign !== state.lastSign)) {
    state.coasting = false;
    state.decreasing = 0;
    state.lastAbs = abs;
    state.lastSign = sign;
    state.lastAt = now;
    return false;
  }
  if (state.coasting) {
    if (abs > state.lastAbs * 1.15) {
      state.coasting = false;
      state.decreasing = 0;
      state.lastAbs = abs;
      state.lastSign = sign;
      state.lastAt = now;
      return false;
    }
    state.lastAbs = abs;
    state.lastSign = sign;
    state.lastAt = now;
    return true;
  }
  if (abs < state.lastAbs && dt <= COAST_TICK_MS) {
    state.decreasing += 1;
  } else if (abs > state.lastAbs) {
    state.decreasing = 0;
  }
  state.lastAbs = abs;
  state.lastSign = sign;
  state.lastAt = now;
  if (state.decreasing >= COAST_DECREASE_COUNT) {
    state.coasting = true;
    return true;
  }
  return false;
}

/**
 * Scale factor for one wheel event, or null when the gesture should be ignored.
 * Pinch, two-finger forward/back, and the mouse wheel zoom around the pointer.
 * Horizontal swipes are neither pan nor zoom. Inertial coast is filtered
 * separately via consumeTrackpadCoast.
 */
export function wheelZoomFactor(event: {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlKey: boolean;
  readonly deltaMode?: number;
}): number | null {
  if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    return null;
  }
  if (event.deltaY === 0) return null;
  if ((event.deltaMode ?? 0) !== 0 && !event.ctrlKey) {
    return event.deltaY < 0 ? GRAPH_WHEEL_STEP : WHEEL_STEP_MIN;
  }
  return clampPixelZoomStep(Math.exp(-event.deltaY * PINCH_PIXEL_SCALE));
}

export function applyWheelZoom(input: {
  readonly panX: number;
  readonly panY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly zoom: number;
  readonly fractionX: number;
  readonly fractionY: number;
  readonly event: {
    readonly deltaX: number;
    readonly deltaY: number;
    readonly ctrlKey: boolean;
    readonly deltaMode?: number;
  };
}): { readonly zoom: number; readonly panX: number; readonly panY: number } | null {
  const factor = wheelZoomFactor(input.event);
  if (factor === null) return null;
  const nextZoom = clampGraphZoom(input.zoom * factor);
  if (nextZoom === input.zoom) return null;
  const pan = panAfterZoomAroundPointer({
    panX: input.panX,
    panY: input.panY,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    zoom: input.zoom,
    nextZoom,
    fractionX: input.fractionX,
    fractionY: input.fractionY,
  });
  return { zoom: nextZoom, panX: pan.x, panY: pan.y };
}
