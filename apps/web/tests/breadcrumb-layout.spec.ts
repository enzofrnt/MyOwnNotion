import { describe, expect, it } from "vitest";
import { selectVisibleCrumbs } from "../src/features/workspace/breadcrumb-layout.ts";

const base = { separatorWidth: 10, ellipsisWidth: 30 };

describe("breadcrumb truncation layout", () => {
  it("shows every segment when the whole path fits", () => {
    const layout = selectVisibleCrumbs({
      ...base,
      widths: [100, 100, 100],
      available: 320,
    });
    expect(layout).toEqual({ visible: [0, 1, 2], hidden: [] });
  });

  it("never folds a path of two segments", () => {
    const layout = selectVisibleCrumbs({ ...base, widths: [500, 500], available: 100 });
    expect(layout).toEqual({ visible: [0, 1], hidden: [] });
  });

  it("keeps the current item, its parent and the root before anything else", () => {
    // root(60) … parent(80) current(100): 60+30+80+100 + 3 separators = 300
    const layout = selectVisibleCrumbs({
      ...base,
      widths: [60, 200, 200, 80, 100],
      available: 300,
    });
    expect(layout).toEqual({ visible: [0, 3, 4], hidden: [1, 2] });
  });

  it("drops the root when only the parent fits next to the current item", () => {
    // … parent(80) current(100) = 30+80+100 + 2 separators = 230
    const layout = selectVisibleCrumbs({
      ...base,
      widths: [60, 200, 200, 80, 100],
      available: 240,
    });
    expect(layout).toEqual({ visible: [3, 4], hidden: [0, 1, 2] });
  });

  it("grows the suffix towards the root while it fits, keeping hidden segments contiguous", () => {
    // root(60) … c(50) parent(80) current(100) = 60+30+50+80+100 + 4 seps = 360
    const layout = selectVisibleCrumbs({
      ...base,
      widths: [60, 400, 50, 80, 100],
      available: 370,
    });
    expect(layout).toEqual({ visible: [0, 2, 3, 4], hidden: [1] });
  });

  it("keeps only the current item when nothing else fits; it is clipped by CSS", () => {
    const layout = selectVisibleCrumbs({
      ...base,
      widths: [60, 200, 900],
      available: 50,
    });
    expect(layout).toEqual({ visible: [2], hidden: [0, 1] });
  });
});
