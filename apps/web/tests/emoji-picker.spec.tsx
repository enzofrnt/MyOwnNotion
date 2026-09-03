// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type EmojiPickerFactory,
  EmojiPickerPanel,
  ItemEmojiPicker,
} from "../src/ui/emoji-picker.tsx";

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
        i18n: expect.objectContaining({
          search: "Rechercher",
        }),
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

  it("exposes a hover clear control that removes the page emoji without opening the picker", async () => {
    const onChange = vi.fn();
    const factory: EmojiPickerFactory = () => document.createElement("div");
    await act(async () => {
      root.render(
        <ItemEmojiPicker
          factory={factory}
          kind="page"
          label="Notes"
          value="😀"
          variant="page"
          onChange={onChange}
        />,
      );
    });

    const clear = container.querySelector<HTMLButtonElement>('[data-testid="clear-item-icon"]');
    expect(clear?.getAttribute("aria-label")).toBe("Retirer l’icône de Notes");
    await act(async () => clear?.click());
    expect(onChange).toHaveBeenCalledWith(null);
    expect(container.querySelector('[data-testid="emoji-picker-panel"]')).toBeNull();
  });

  it("hides the hover clear control when the item has no emoji", async () => {
    await act(async () => {
      root.render(
        <ItemEmojiPicker
          factory={() => document.createElement("div")}
          kind="page"
          label="Notes"
          value={null}
          variant="page"
          onChange={vi.fn()}
        />,
      );
    });
    expect(container.querySelector('[data-testid="clear-item-icon"]')).toBeNull();
    expect(container.querySelector(".item-emoji-picker")?.hasAttribute("data-empty")).toBe(true);
  });

  it("keeps a filled page emoji in flow so the title geometry stays stable", async () => {
    await act(async () => {
      root.render(
        <ItemEmojiPicker
          factory={() => document.createElement("div")}
          kind="page"
          label="Notes"
          value="😀"
          variant="page"
          onChange={vi.fn()}
        />,
      );
    });
    expect(container.querySelector(".item-emoji-picker")?.hasAttribute("data-empty")).toBe(false);
  });

  it("keeps the focused picker mounted while its selection callback changes", async () => {
    const firstSelection = vi.fn();
    const latestSelection = vi.fn();
    const factory = vi.fn<EmojiPickerFactory>((options) => {
      const fakePicker = document.createElement("button");
      fakePicker.type = "button";
      fakePicker.dataset["testid"] = "stable-emoji";
      fakePicker.addEventListener("click", () => options.onEmojiSelect({ native: "📌" }));
      return fakePicker;
    });

    await act(async () => {
      root.render(<EmojiPickerPanel value={null} onSelect={firstSelection} factory={factory} />);
    });
    const picker = container.querySelector<HTMLButtonElement>('[data-testid="stable-emoji"]');
    picker?.focus();
    expect(document.activeElement).toBe(picker);

    await act(async () => {
      root.render(<EmojiPickerPanel value={null} onSelect={latestSelection} factory={factory} />);
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="stable-emoji"]')).toBe(picker);
    expect(document.activeElement).toBe(picker);
    await act(async () => picker?.click());
    expect(firstSelection).not.toHaveBeenCalled();
    expect(latestSelection).toHaveBeenCalledWith("📌");
  });
});
