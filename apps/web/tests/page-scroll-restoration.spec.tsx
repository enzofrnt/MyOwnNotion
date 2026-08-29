// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureScrollAnchor,
  restoreScrollAnchor,
} from "../src/features/editor/editor-view-state.ts";

const BLOCK_A = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f20b1";
const BLOCK_B = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f20b2";

function mountBlocks(): void {
  document.body.innerHTML = `
    <div data-testid="block-editor">
      <div class="ProseMirror">
        <div class="bn-block-outer" data-id="${BLOCK_A}" style="height: 2000px">A</div>
        <div class="bn-block-outer" data-id="${BLOCK_B}" style="height: 2000px">B</div>
      </div>
    </div>`;
}

describe("scroll restoration by content anchor", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    window.scrollTo(0, 0);
    vi.restoreAllMocks();
  });

  it("captures the first visible block and the distance into it", () => {
    mountBlocks();
    // Simulate a viewport 500px into block A.
    vi.spyOn(window, "scrollY", "get").mockReturnValue(500);
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.getAttribute("data-id") === BLOCK_A) {
        return { top: -500, bottom: 1500 } as DOMRect;
      }
      return { top: 1500, bottom: 3500 } as DOMRect;
    };

    const anchor = captureScrollAnchor();
    expect(anchor).toEqual({
      blockId: BLOCK_A,
      offset: 500,
      fallbackPixel: 500,
    });
  });

  it("restores to the remembered block at the remembered depth", () => {
    mountBlocks();
    let scrolledTo = 0;
    vi.spyOn(window, "scrollY", "get").mockReturnValue(0);
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const top = this.getAttribute("data-id") === BLOCK_A ? 2000 : 4000;
      return { top, bottom: top + 2000 } as DOMRect;
    };
    window.scrollTo = ((options: ScrollOptions) => {
      scrolledTo = Number(options.top ?? 0);
    }) as typeof window.scrollTo;

    const honoured = restoreScrollAnchor({
      blockId: BLOCK_B,
      offset: 120,
      fallbackPixel: 9999,
    });
    expect(honoured).toBe(true);
    // Block B sits at document position 4000; scrolling 120px into it.
    expect(scrolledTo).toBe(4120);
  });

  it("captures and restores the workspace scroller without moving the document", () => {
    document.body.innerHTML = `
      <main class="workspace-main">
        <div class="ProseMirror">
          <div class="bn-block-outer" data-id="${BLOCK_A}">A</div>
          <div class="bn-block-outer" data-id="${BLOCK_B}">B</div>
        </div>
      </main>`;
    const scroller = document.querySelector<HTMLElement>(".workspace-main");
    if (scroller === null) throw new Error("workspace scroller missing");
    scroller.scrollTop = 600;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this === scroller) return { top: 44, bottom: 844 } as DOMRect;
      const top = this.getAttribute("data-id") === BLOCK_A ? -156 : 844;
      return { top, bottom: top + 1_000 } as DOMRect;
    };
    let scrolledTo = 0;
    scroller.scrollTo = ((options: ScrollToOptions) => {
      scrolledTo = Number(options.top ?? 0);
    }) as typeof scroller.scrollTo;

    expect(captureScrollAnchor()).toEqual({
      blockId: BLOCK_A,
      offset: 200,
      fallbackPixel: 600,
    });
    expect(restoreScrollAnchor({ blockId: BLOCK_B, offset: 120, fallbackPixel: 9999 })).toBe(true);
    expect(scrolledTo).toBe(1_520);
    expect(window.scrollY).toBe(0);
  });

  it("falls back to the recorded pixel when the block no longer exists", () => {
    mountBlocks();
    let scrolledTo = 0;
    vi.spyOn(window, "scrollY", "get").mockReturnValue(0);
    window.scrollTo = ((options: ScrollOptions) => {
      scrolledTo = Number(options.top ?? 0);
    }) as typeof window.scrollTo;

    const honoured = restoreScrollAnchor({
      blockId: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6fdeleted",
      offset: 40,
      fallbackPixel: 777,
    });
    expect(honoured).toBe(false);
    expect(scrolledTo).toBe(777);
  });

  it("returns null when no editor block exists yet", () => {
    document.body.innerHTML = "<div><p>loading…</p></div>";
    expect(captureScrollAnchor()).toBeNull();
  });
});
