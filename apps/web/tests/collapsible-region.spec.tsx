// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSIBLE_REGION_CLEANUP_FALLBACK_MS,
  COLLAPSIBLE_REGION_DURATION_MS,
  CollapsibleRegion,
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
});
