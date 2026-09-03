import { describe, expect, it } from "vitest";
import {
  applyWheelZoom,
  clampGraphZoom,
  consumeTrackpadCoast,
  createTrackpadCoastState,
  panAfterZoomAroundPointer,
  wheelZoomFactor,
} from "../src/features/knowledge-graph/graph-view-transform.ts";

function worldPoint(
  panX: number,
  panY: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  fractionX: number,
  fractionY: number,
): { x: number; y: number } {
  return {
    x: panX + fractionX * (viewportWidth / zoom),
    y: panY + fractionY * (viewportHeight / zoom),
  };
}

describe("wheelZoomFactor", () => {
  it("zooms from mouse wheel, pinch, and two-finger slide, and ignores swipes", () => {
    expect(wheelZoomFactor({ deltaX: 0, deltaY: -100, ctrlKey: false })).toBe(1.14);
    expect(wheelZoomFactor({ deltaX: 0, deltaY: 100, ctrlKey: false })).toBeCloseTo(1 / 1.14, 5);
    expect(wheelZoomFactor({ deltaX: 0, deltaY: -3, deltaMode: 1, ctrlKey: false })).toBe(1.1);
    expect(wheelZoomFactor({ deltaX: 40, deltaY: -8, ctrlKey: false })).toBeNull();
    expect(wheelZoomFactor({ deltaX: 12, deltaY: 0, ctrlKey: false })).toBeNull();
    const slide = wheelZoomFactor({ deltaX: 0, deltaY: -12, ctrlKey: false });
    expect(slide).toBeGreaterThan(1);
    expect(slide).toBeLessThan(1.1);
    const pinch = wheelZoomFactor({ deltaX: 30, deltaY: -20, ctrlKey: true });
    expect(pinch).toBeGreaterThan(1.1);
    expect(pinch).toBeLessThanOrEqual(1.14);
  });
});

describe("consumeTrackpadCoast", () => {
  it("lets a two-finger slide zoom, then ignores the decaying inertial tail", () => {
    const state = createTrackpadCoastState();
    let now = 1000;
    expect(consumeTrackpadCoast(state, { ctrlKey: false, deltaY: -20 }, now)).toBe(false);
    now += 16;
    expect(consumeTrackpadCoast(state, { ctrlKey: false, deltaY: -16 }, now)).toBe(false);
    now += 16;
    expect(consumeTrackpadCoast(state, { ctrlKey: false, deltaY: -13 }, now)).toBe(false);
    now += 16;
    expect(consumeTrackpadCoast(state, { ctrlKey: false, deltaY: -10 }, now)).toBe(true);
    now += 16;
    expect(consumeTrackpadCoast(state, { ctrlKey: false, deltaY: -8 }, now)).toBe(true);
    now += 16;
    expect(consumeTrackpadCoast(state, { ctrlKey: false, deltaY: -22 }, now)).toBe(false);
    now += 16;
    expect(consumeTrackpadCoast(state, { ctrlKey: true, deltaY: -12 }, now)).toBe(false);
    now += 200;
    expect(consumeTrackpadCoast(state, { ctrlKey: false, deltaY: -9 }, now)).toBe(false);
  });
});

describe("panAfterZoomAroundPointer", () => {
  it("keeps the world point under the pointer after a zoom step", () => {
    const viewportWidth = 800;
    const viewportHeight = 520;
    const fractionX = 0.75;
    const fractionY = 0.25;
    const zoom = 1;
    const nextZoom = 2;
    const panX = 40;
    const panY = -12;
    const before = worldPoint(
      panX,
      panY,
      viewportWidth,
      viewportHeight,
      zoom,
      fractionX,
      fractionY,
    );
    const pan = panAfterZoomAroundPointer({
      panX,
      panY,
      viewportWidth,
      viewportHeight,
      zoom,
      nextZoom,
      fractionX,
      fractionY,
    });
    const after = worldPoint(
      pan.x,
      pan.y,
      viewportWidth,
      viewportHeight,
      nextZoom,
      fractionX,
      fractionY,
    );
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe("applyWheelZoom", () => {
  it("compounds several pinch events without extra pan beyond the pointer anchor", () => {
    const viewportWidth = 800;
    const viewportHeight = 520;
    const fractionX = 0.6;
    const fractionY = 0.4;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    const origin = worldPoint(
      panX,
      panY,
      viewportWidth,
      viewportHeight,
      zoom,
      fractionX,
      fractionY,
    );
    const event = { deltaX: 18, deltaY: -12, ctrlKey: true };
    for (let step = 0; step < 8; step += 1) {
      const next = applyWheelZoom({
        panX,
        panY,
        viewportWidth,
        viewportHeight,
        zoom,
        fractionX,
        fractionY,
        event,
      });
      if (next === null) break;
      zoom = next.zoom;
      panX = next.panX;
      panY = next.panY;
    }
    expect(zoom).toBeGreaterThan(1.4);
    expect(zoom).toBeLessThan(2.2);
    const after = worldPoint(panX, panY, viewportWidth, viewportHeight, zoom, fractionX, fractionY);
    expect(after.x).toBeCloseTo(origin.x);
    expect(after.y).toBeCloseTo(origin.y);
  });

  it("does not pan or zoom from a horizontal trackpad swipe", () => {
    expect(
      applyWheelZoom({
        panX: 10,
        panY: 20,
        viewportWidth: 800,
        viewportHeight: 520,
        zoom: 1,
        fractionX: 0.5,
        fractionY: 0.5,
        event: { deltaX: 80, deltaY: 4, ctrlKey: false },
      }),
    ).toBeNull();
    expect(clampGraphZoom(0)).toBe(0.01);
    expect(clampGraphZoom(9)).toBe(4);
  });
});
