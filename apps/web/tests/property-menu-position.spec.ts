import { describe, expect, it } from "vitest";
import { propertyMenuPosition } from "../src/features/databases/property-menu-position.ts";

describe("property menu flyout placement", () => {
  const viewport = { width: 1000, height: 800 };
  it("aligns beside the parent without shifting a short flyout up by 320px", () => {
    expect(
      propertyMenuPosition(
        { left: 500, right: 736, top: 680 },
        { left: 496, right: 740, top: 520 },
        viewport,
        { width: 200, height: 67 },
      ),
    ).toEqual({ left: 736, top: 676, width: 200 });
  });
  it("flips to the left when the right side lacks space", () => {
    expect(
      propertyMenuPosition(
        { left: 754, right: 986, top: 300 },
        { left: 750, right: 990, top: 200 },
        viewport,
        { width: 200, height: 67 },
      ),
    ).toEqual({ left: 554, top: 296, width: 200 });
  });
  it("keeps a tall child within a narrow viewport", () => {
    const position = propertyMenuPosition(
      { left: 30, right: 260, top: 500 },
      { left: 26, right: 264, top: 300 },
      { width: 320, height: 600 },
      { width: 224, height: 324 },
    );
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.left + position.width).toBeLessThanOrEqual(312);
    expect(position.top + 324).toBeLessThanOrEqual(592);
  });
});
