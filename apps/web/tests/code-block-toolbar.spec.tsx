// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CodeBlockToolbar,
  copyCodeText,
} from "../src/features/editor/custom-blocks/code-block.tsx";

describe("code block toolbar", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.useFakeTimers();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function render(
    source = 'const title = "café 漢字 <b>";\n',
    language = "typescript",
    editable = true,
  ) {
    await act(async () => {
      root.render(
        <CodeBlockToolbar
          source={source}
          language={language}
          editable={editable}
          onLanguageChange={vi.fn()}
        />,
      );
    });
  }

  it("preserves unknown language metadata and allows copying read-only content", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render("source", "future-language", false);
    const select = container.querySelector("select");
    expect(select?.value).toBe("future-language");
    expect(select?.selectedOptions[0]?.textContent).toBe("future-language");
    expect(select?.disabled).toBe(true);
    await act(async () => container.querySelector("button")?.click());
    expect(writeText).toHaveBeenCalledWith("source");
  });

  it("shows copy success/refusal locally, keeps one stable button and allows retry", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render();
    const button = container.querySelector("button");
    await act(async () => button?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Impossible de copier le code.",
    );
    expect(container.querySelector("button")).toBe(button);
    await act(async () => button?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Code copié.");
    expect(writeText).toHaveBeenLastCalledWith('const title = "café 漢字 <b>";\n');
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(container.querySelector("button")).toBe(button);
  });

  it("suppresses repeated pending copies and obsolete feedback after a source change", async () => {
    let finish!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render("old source");
    await act(async () => {
      container.querySelector("button")?.click();
      container.querySelector("button")?.click();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    await render("new source");
    await act(async () => finish());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("handles absent clipboard without throwing or modifying the text", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyCodeText("source")).resolves.toBe(false);
    await expect(copyCodeText("source", null)).resolves.toBe(false);
  });
});
