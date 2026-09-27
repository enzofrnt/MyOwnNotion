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
    onLanguageChange = vi.fn(),
  ) {
    await act(async () => {
      root.render(
        <CodeBlockToolbar
          source={source}
          language={language}
          editable={editable}
          onLanguageChange={onLanguageChange}
        />,
      );
    });
    return onLanguageChange;
  }

  it("preserves unknown language metadata and allows copying read-only content", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render("source", "future-language", false);
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="code-language-trigger"]',
    );
    expect(trigger?.textContent).toContain("future-language");
    expect(trigger?.disabled).toBe(true);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="code-copy"]')?.click(),
    );
    expect(writeText).toHaveBeenCalledWith("source");
  });

  it("picks a language from the styled menu instead of a native select", async () => {
    const onLanguageChange = await render("source", "javascript", true);
    expect(container.querySelector("select")).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="code-language-trigger"]',
    );
    expect(trigger?.textContent).toContain("JavaScript");
    await act(async () => {
      trigger?.click();
    });
    const option = [...document.querySelectorAll<HTMLElement>(".editor-code-language-option")].find(
      (entry) => entry.textContent?.includes("TypeScript"),
    );
    expect(option).toBeTruthy();
    await act(async () => {
      option?.click();
    });
    expect(onLanguageChange).toHaveBeenCalledWith("typescript");
  });

  it("shows copy success/refusal locally, keeps one stable button and allows retry", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render();
    const button = container.querySelector<HTMLButtonElement>('[data-testid="code-copy"]');
    await act(async () => button?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Impossible de copier le code.",
    );
    expect(container.querySelector('[data-testid="code-copy"]')).toBe(button);
    await act(async () => button?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Code copié.");
    expect(writeText).toHaveBeenLastCalledWith('const title = "café 漢字 <b>";\n');
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(container.querySelector('[data-testid="code-copy"]')).toBe(button);
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
    const button = () => container.querySelector<HTMLButtonElement>('[data-testid="code-copy"]');
    await act(async () => {
      button()?.click();
      button()?.click();
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
