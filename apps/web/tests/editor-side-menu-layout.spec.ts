// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockTextSideMenuOffset } from "../src/features/editor/editor-menus/block-side-menu-layout.ts";

const rect = (top: number, height: number) => new DOMRect(0, top, 300, height);

function block(html: string, top: number, height: number): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(top, height));
  return root;
}

afterEach(() => vi.restoreAllMocks());

describe("block controls align with the rendered first text line", () => {
  it("uses the text inside a spaced, multiline heading rather than its full height", () => {
    const root = block(
      '<h2 class="bn-inline-content"><strong>Titre long</strong><br>Suite</h2>',
      100,
      160,
    );
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = createRange();
      Object.defineProperty(range, "getBoundingClientRect", { value: () => rect(130, 38) });
      return range;
    });
    expect(blockTextSideMenuOffset(root, 32)).toBe(33);
    expect(blockTextSideMenuOffset(root, 44)).toBe(27);
  });

  it("skips whitespace and measures a complete leading emoji without changing the DOM", () => {
    const root = block('<p class="bn-inline-content">  <span>😀 Texte</span></p>', 100, 90);
    const before = root.innerHTML;
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = createRange();
      Object.defineProperty(range, "getBoundingClientRect", {
        value: () => {
          expect(range.toString()).toBe("😀");
          return rect(103, 19);
        },
      });
      return range;
    });
    expect(blockTextSideMenuOffset(root, 32)).toBe(-3.5);
    expect(root.innerHTML).toBe(before);
  });

  it("centres an empty heading on its line-height, including its top spacing", () => {
    const root = block('<h4 class="bn-inline-content" style="line-height:24px"><br></h4>', 100, 60);
    const inline = root.querySelector("h4");
    if (inline === null) throw new Error("Missing fixture heading");
    vi.spyOn(inline, "getBoundingClientRect").mockReturnValue(rect(112, 40));
    expect(blockTextSideMenuOffset(root, 32)).toBe(8);
  });

  it("leaves specialized blocks and hidden text to their existing placement", () => {
    expect(blockTextSideMenuOffset(block("<figure>Fichier</figure>", 100, 90), 32)).toBeUndefined();
    expect(
      blockTextSideMenuOffset(block('<p class="bn-inline-content"><br></p>', 0, 0), 32),
    ).toBeUndefined();
  });
});
