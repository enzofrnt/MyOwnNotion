import emojiData from "@emoji-mart/data";
import frenchEmojiPickerText from "@emoji-mart/data/i18n/fr.json";
import { Picker } from "emoji-mart";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { AppIcon } from "./icons.tsx";
import { ItemIcon, type ItemIconKind } from "./item-icon.tsx";
import {
  Button,
  DialogContent,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "./primitives/index.ts";
import { SymbolIconGrid } from "./symbol-icon-grid.tsx";
import { pageSymbolIcon, symbolIconChoice } from "./symbol-icons.ts";

export interface EmojiSelection {
  readonly native: string;
}

export interface EmojiPickerOptions {
  readonly data: object;
  readonly i18n: object;
  readonly locale: "fr";
  readonly set: "native";
  readonly theme: "light" | "dark";
  readonly autoFocus: true;
  readonly dynamicWidth: true;
  readonly previewPosition: "none";
  readonly searchPosition: "sticky";
  readonly onEmojiSelect: (selection: EmojiSelection) => void;
}

export type EmojiPickerFactory = (options: EmojiPickerOptions) => HTMLElement;

const createEmojiMartPicker: EmojiPickerFactory = (options) =>
  new Picker(options) as unknown as HTMLElement;

function currentTheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.dataset["theme"] === "dark"
    ? "dark"
    : "light";
}

export interface EmojiPickerPanelProps {
  readonly value: string | null;
  readonly onSelect: (emoji: string | null) => void;
  /** Pages accept an emoji or a symbol. Properties and views pass `symbol`. */
  readonly scope?: "page" | "symbol";
  readonly factory?: EmojiPickerFactory;
}

type PickerKind = "emoji" | "symbol";

/** A fully bundled picker: no CDN or network request is required offline. */
export function EmojiPickerPanel({
  factory = createEmojiMartPicker,
  onSelect,
  scope = "page",
  value,
}: EmojiPickerPanelProps) {
  const mount = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [iconQuery, setIconQuery] = useState("");
  const [kind, setKind] = useState<PickerKind>(
    scope === "symbol" || symbolIconChoice(value) !== null ? "symbol" : "emoji",
  );
  const showEmoji = scope === "page" && kind === "emoji";
  const showIcons = scope === "symbol" || kind === "symbol";

  useEffect(() => {
    if (!showEmoji) return;
    const host = mount.current;
    if (host === null) return;
    const picker = factory({
      data: emojiData as object,
      i18n: frenchEmojiPickerText as object,
      locale: "fr",
      set: "native",
      theme: currentTheme(),
      autoFocus: true,
      dynamicWidth: true,
      previewPosition: "none",
      searchPosition: "sticky",
      onEmojiSelect: ({ native }) => onSelectRef.current(native),
    });
    host.replaceChildren(picker);
    let frame = 0;
    let frames = 0;
    const fit = (): void => {
      const pickerHost = host.querySelector("em-emoji-picker");
      if (pickerHost === null || frames > 30) return;
      frames += 1;
      const root = pickerHost.shadowRoot;
      const scroll = root?.querySelector(".scroll");
      if (root === null || scroll === null || scroll === undefined) {
        frame = requestAnimationFrame(fit);
        return;
      }
      if (root.querySelector("[data-picker-fit]") !== null) return;
      const style = document.createElement("style");
      style.dataset["pickerFit"] = "true";
      style.textContent = "#root{height:100%;min-height:0;flex:1}.scroll{min-height:0;flex:1 1 0}";
      root.append(style);
    };
    frame = requestAnimationFrame(fit);
    return () => {
      cancelAnimationFrame(frame);
      host.replaceChildren();
    };
  }, [factory, showEmoji]);

  const moveKind = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next: PickerKind = event.key === "ArrowRight" ? "symbol" : "emoji";
    setKind(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)?.focus();
  };

  return (
    <div className="emoji-picker-panel" data-testid="emoji-picker-panel">
      {scope === "page" ? (
        <div
          className="emoji-picker-panel__kinds"
          role="tablist"
          aria-label="Type d’icône"
          onKeyDown={moveKind}
        >
          <button
            type="button"
            role="tab"
            className="emoji-picker-panel__kind"
            data-kind="emoji"
            aria-selected={kind === "emoji"}
            tabIndex={kind === "emoji" ? 0 : -1}
            onClick={() => setKind("emoji")}
          >
            Emoji
          </button>
          <button
            type="button"
            role="tab"
            className="emoji-picker-panel__kind"
            data-kind="symbol"
            aria-selected={kind === "symbol"}
            aria-label="Icônes"
            tabIndex={kind === "symbol" ? 0 : -1}
            onClick={() => setKind("symbol")}
          >
            <AppIcon name="smile" size="small" />
            Icônes
          </button>
        </div>
      ) : null}
      {showEmoji ? (
        <div className="emoji-picker-panel__mart">
          <div ref={mount} />
        </div>
      ) : null}
      {showIcons ? (
        <div className="emoji-picker-panel__symbols">
          <SymbolIconGrid
            current={symbolIconChoice(value)?.id ?? null}
            query={iconQuery}
            onQuery={setIconQuery}
            onSelect={(icon) => onSelect(scope === "page" ? pageSymbolIcon(icon) : icon)}
          />
        </div>
      ) : null}
      {value === null ? null : (
        <Button
          className="emoji-picker-panel__remove"
          size="compact"
          variant="ghost"
          data-testid="remove-item-icon"
          onClick={() => onSelect(null)}
        >
          <AppIcon name="remove" size="small" />
          Retirer l’icône
        </Button>
      )}
    </div>
  );
}

export interface ItemEmojiPickerProps {
  readonly kind: Exclude<ItemIconKind, "file">;
  readonly value: string | null;
  readonly onChange: (emoji: string | null) => void;
  readonly label: string;
  readonly variant?: "page" | "compact";
  readonly factory?: EmojiPickerFactory;
}

export function ItemEmojiPicker({
  factory,
  kind,
  label,
  onChange,
  value,
  variant = "compact",
}: ItemEmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const select = (emoji: string | null): void => {
    onChange(emoji);
    setOpen(false);
  };
  const clear = (event: { preventDefault(): void; stopPropagation(): void }): void => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    onChange(null);
  };
  return (
    <div
      className="item-emoji-picker"
      data-picker-variant={variant}
      {...(value === null ? { "data-empty": "" } : {})}
    >
      <PopoverRoot open={open} setOpen={setOpen}>
        <PopoverTrigger
          className="item-emoji-picker__trigger"
          data-picker-variant={variant}
          aria-label={
            value === null ? `Ajouter une icône à ${label}` : `Changer l’icône de ${label}`
          }
          data-testid="item-icon-picker-trigger"
        >
          {value === null ? (
            <span className="item-emoji-picker__empty">
              <AppIcon name="smile" size="small" />
              Ajouter une icône
            </span>
          ) : (
            <ItemIcon kind={kind} icon={value} size={variant === "page" ? "page" : "inline"} />
          )}
        </PopoverTrigger>
        <PopoverContent className="emoji-picker-popover" unmountOnHide>
          <EmojiPickerPanel
            {...(factory === undefined ? {} : { factory })}
            value={value}
            onSelect={select}
          />
        </PopoverContent>
      </PopoverRoot>
      {value === null ? null : (
        <Button
          type="button"
          size="square"
          variant="ghost"
          className="item-emoji-picker__clear"
          aria-label={`Retirer l’icône de ${label}`}
          data-testid="clear-item-icon"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={clear}
        >
          <AppIcon name="close" size="small" />
        </Button>
      )}
    </div>
  );
}

export interface ItemEmojiDialogProps {
  readonly open: boolean;
  readonly item: {
    readonly kind: Exclude<ItemIconKind, "file">;
    readonly icon: string | null;
    readonly name: string;
  } | null;
  readonly onClose: () => void;
  readonly onChange: (emoji: string | null) => void;
}

export function ItemEmojiDialog({ item, onChange, onClose, open }: ItemEmojiDialogProps) {
  return (
    <DialogRoot
      open={open}
      setOpen={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="emoji-picker-dialog" size="small">
        <DialogHeading>
          {item?.icon === null ? "Ajouter une icône" : "Changer l’icône"}
        </DialogHeading>
        <DialogDismiss />
        {item === null ? null : (
          <EmojiPickerPanel
            value={item.icon}
            onSelect={(emoji) => {
              onChange(emoji);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </DialogRoot>
  );
}
