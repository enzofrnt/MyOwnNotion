// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EmojiPickerFactory, EmojiPickerPanel } from "../src/ui/emoji-picker.tsx";

describe("local emoji picker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("embeds the French searchable picker data and returns its Unicode grapheme", async () => {
    const onSelect = vi.fn();
    const factory = vi.fn<EmojiPickerFactory>((options) => {
      const fakePicker = document.createElement("button");
      fakePicker.type = "button";
      fakePicker.dataset["testid"] = "fake-emoji";
      fakePicker.textContent = "🧠";
      fakePicker.addEventListener("click", () => options.onEmojiSelect({ native: "🧠" }));
      return fakePicker;
    });

    await act(async () => {
      root.render(<EmojiPickerPanel value={null} onSelect={onSelect} factory={factory} />);
    });

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        autoFocus: true,
        locale: "fr",
        searchPosition: "sticky",
        set: "native",
        data: expect.any(Object),
      }),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="fake-emoji"]')?.click();
    });
    expect(onSelect).toHaveBeenCalledWith("🧠");
  });

  it("offers removal only when the item currently has an emoji", async () => {
    const onSelect = vi.fn();
    const factory: EmojiPickerFactory = () => document.createElement("div");
    await act(async () => {
      root.render(<EmojiPickerPanel value="📚" onSelect={onSelect} factory={factory} />);
    });

    const remove = container.querySelector<HTMLButtonElement>('[data-testid="remove-item-icon"]');
    expect(remove?.textContent).toContain("Retirer l’icône");
    await act(async () => remove?.click());
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
