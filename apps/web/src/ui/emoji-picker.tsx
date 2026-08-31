import emojiData from "@emoji-mart/data";
import frenchEmojiPickerText from "@emoji-mart/data/i18n/fr.json";
import { Picker } from "emoji-mart";
import { useEffect, useRef, useState } from "react";
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
  readonly factory?: EmojiPickerFactory;
}

/** A fully bundled picker: no CDN or network request is required offline. */
export function EmojiPickerPanel({
  factory = createEmojiMartPicker,
  onSelect,
  value,
}: EmojiPickerPanelProps) {
  const mount = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
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
    return () => host.replaceChildren();
  }, [factory]);

  return (
    <div className="emoji-picker-panel" data-testid="emoji-picker-panel">
      <div ref={mount} className="emoji-picker-panel__mart" />
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
}

export function ItemEmojiPicker({
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
  return (
    <PopoverRoot open={open} setOpen={setOpen}>
      <PopoverTrigger
        className="item-emoji-picker__trigger"
        data-picker-variant={variant}
        aria-label={value === null ? `Ajouter une icône à ${label}` : `Changer l’icône de ${label}`}
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
      <PopoverContent className="emoji-picker-popover">
        <EmojiPickerPanel value={value} onSelect={select} />
      </PopoverContent>
    </PopoverRoot>
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
