// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSIBLE_JOIN_FALLBACK_PX,
  COLLAPSIBLE_REGION_CLEANUP_FALLBACK_MS,
  COLLAPSIBLE_REGION_DURATION_MS,
  CollapsibleRegion,
  cssEase,
  joinReleaseHeightPx,
  joinReleasePlan,
  joinThresholdPx,
  remainingCloseMs,
  TREE_JOIN_RADIUS_DURATION_VAR,
} from "../src/features/navigation/collapsible-region.tsx";

describe("collapsible region", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(open: boolean): Promise<void> {
    await act(async () => {
      root.render(
        <CollapsibleRegion data-testid="region" lazy open={open}>
          <button type="button">Enfant</button>
        </CollapsibleRegion>,
      );
    });
  }

  it("keeps lazy content mounted until the real grid transition ends", async () => {
    await render(true);
    await render(false);

    const region = container.querySelector<HTMLElement>('[data-testid="region"]');
    expect(region?.getAttribute("data-open")).toBe("false");
    expect(region?.hasAttribute("inert")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLAPSIBLE_REGION_DURATION_MS);
    });
    expect(container.querySelector('[data-testid="region"]')).not.toBeNull();

    const transitionEnd = new Event("transitionend", { bubbles: true });
    Object.defineProperty(transitionEnd, "propertyName", { value: "grid-template-rows" });
    await act(async () => region?.dispatchEvent(transitionEnd));
    expect(container.querySelector('[data-testid="region"]')).toBeNull();
  });

  it("uses an inert cleanup fallback when an engine omits transitionend", async () => {
    await render(true);
    await render(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLAPSIBLE_REGION_CLEANUP_FALLBACK_MS);
    });
    expect(container.querySelector('[data-testid="region"]')).toBeNull();
  });

  it("reads the previous row radius and releases the join at twice that radius", () => {
    const host = document.createElement("div");
    const drop = document.createElement("div");
    drop.className = "tree-drop-target";
    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.borderTopLeftRadius = "8px";
    drop.append(row);
    const region = document.createElement("div");
    host.append(drop, region);
    document.body.append(host);

    expect(joinThresholdPx(region)).toBe(8);
    expect(joinReleaseHeightPx(region)).toBe(16);
    expect(joinThresholdPx(document.createElement("div"))).toBe(COLLAPSIBLE_JOIN_FALLBACK_PX);
    expect(remainingCloseMs(1000, 1000)).toBe(COLLAPSIBLE_REGION_DURATION_MS);
    expect(remainingCloseMs(1000, 1140)).toBe(70);
    expect(remainingCloseMs(1000, 1300)).toBe(0);
    expect(cssEase(0)).toBeCloseTo(0, 3);
    expect(cssEase(1)).toBeCloseTo(1, 3);
    const plan = joinReleasePlan(76, 6);
    expect(plan.delayMs + plan.radiusMs).toBe(COLLAPSIBLE_REGION_DURATION_MS);
    expect(plan.delayMs).toBeGreaterThan(0);
    expect(76 * (1 - cssEase(plan.delayMs / COLLAPSIBLE_REGION_DURATION_MS))).toBeCloseTo(12, 0);
    host.remove();
  });

  it("releases the join at two radii and spends only the leftover close time rounding", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    rect.mockImplementation(function (this: HTMLElement) {
      const height = this.dataset.testid === "region" ? Number(this.dataset.mockHeight ?? 80) : 38;
      return {
        x: 0,
        y: 0,
        width: 240,
        height,
        top: 0,
        left: 0,
        right: 240,
        bottom: height,
        toJSON: () => ({}),
      } as DOMRect;
    });

    function Fixture({ open }: { readonly open: boolean }) {
      return (
        <>
          <div className="tree-drop-target">
            <div className="tree-row" style={{ borderTopLeftRadius: 6 }} />
          </div>
          <CollapsibleRegion data-testid="region" joinPrevious lazy open={open}>
            <p>Pièces jointes</p>
          </CollapsibleRegion>
        </>
      );
    }

    await act(async () => {
      root.render(<Fixture open />);
    });
    expect(container.querySelector('[data-testid="region"]')?.getAttribute("data-joined")).toBe(
      "true",
    );

    await act(async () => {
      root.render(<Fixture open={false} />);
    });
    const region = container.querySelector<HTMLElement>('[data-testid="region"]');
    expect(region?.getAttribute("data-joined")).toBe("true");

    region?.setAttribute("data-mock-height", "20");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(region?.getAttribute("data-joined")).toBe("true");

    region?.setAttribute("data-mock-height", "12");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    const row = container.querySelector<HTMLElement>(".tree-row");
    expect(region?.getAttribute("data-joined")).toBeNull();
    expect(row?.style.getPropertyValue(TREE_JOIN_RADIUS_DURATION_VAR)).toMatch(/^\d+ms$/u);
    const leftover = Number.parseInt(
      row?.style.getPropertyValue(TREE_JOIN_RADIUS_DURATION_VAR) ?? "0",
      10,
    );
    expect(leftover).toBeGreaterThanOrEqual(0);
    expect(leftover).toBeLessThanOrEqual(COLLAPSIBLE_REGION_DURATION_MS);
    rect.mockRestore();
  });
});
