import { type DatabaseProperty, generateUuidV7, type PropertyOption } from "@myownnotion/domain";
import { useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import {
  Button,
  InputSurface,
  MenuContent,
  MenuRoot,
  MenuTrigger,
  NativeInput,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../ui/primitives/index.ts";
import { EntrySchemaImpact } from "./edit-entry-properties.ts";
import { nextOptionTone, OptionPill } from "./option-appearance.tsx";
import { PropertyOptionSettings } from "./property-configuration.tsx";
import type { ValueDraft } from "./value-editor.tsx";

export function EntryChoicePicker({
  property,
  input,
  id,
  describedBy,
  invalid,
  onChange,
  onOptions,
  emptyLabel,
}: {
  property: Extract<DatabaseProperty, { type: "select" | "status" | "multi-select" }>;
  input: ValueDraft;
  id: string;
  describedBy?: string | undefined;
  invalid: boolean;
  emptyLabel?: string | undefined;
  onChange: (input: ValueDraft) => void;
  onOptions?: ((options: readonly PropertyOption[]) => Promise<void>) | undefined;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = Array.isArray(input) ? input : typeof input === "string" && input ? [input] : [];
  const active = property.config.options.filter((o) => o.state === "active");
  const chosen = property.config.options.filter((o) => ids.includes(o.id));
  const filtered = active.filter((o) =>
    o.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const choose = (id: string) => {
    onChange(
      property.type === "multi-select"
        ? ids.includes(id)
          ? ids.filter((i) => i !== id)
          : [...ids, id]
        : id,
    );
    if (property.type !== "multi-select") setOpen(false);
  };
  const patch = async (id: string, change: Partial<PropertyOption>) => {
    if (onOptions === undefined) return;
    setError(null);
    try {
      await onOptions(property.config.options.map((o) => (o.id === id ? { ...o, ...change } : o)));
    } catch (error) {
      if (!(error instanceof EntrySchemaImpact))
        setError("L’option n’a pas pu être modifiée. Réessayez.");
    }
  };
  const create = async () => {
    const label = query.trim();
    if (!label || creating || onOptions === undefined) return;
    setCreating(true);
    setError(null);
    const option: PropertyOption = {
      id: generateUuidV7(),
      label,
      tone: nextOptionTone(active.length),
      positionKey: `option-${String(property.config.options.length).padStart(6, "0")}`,
      state: "active",
    };
    try {
      await onOptions([...property.config.options, option]);
      setQuery("");
      setTimeout(() => choose(option.id), 0);
    } catch {
      setError("L’option n’a pas pu être créée. Réessayez.");
    } finally {
      setCreating(false);
    }
  };
  return (
    <PopoverRoot
      placement="bottom-start"
      open={open}
      setOpen={(value) => {
        setOpen(value);
        if (!value) setQuery("");
      }}
    >
      <PopoverTrigger
        id={id}
        className="option-menu__trigger"
        aria-label={property.name}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
      >
        {chosen.length === 0 ? (
          <span className="option-menu__empty">{emptyLabel ?? "Vide"}</span>
        ) : (
          <span className="option-pill-row">
            {chosen.map((o) => (
              <OptionPill key={o.id} label={o.label} tone={o.tone} />
            ))}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="entry-choice"
        initialFocus={searchRef}
        aria-label={`Choisir ${property.name}`}
        unmountOnHide
      >
        <InputSurface density="compact">
          {chosen.map((o) => (
            <button
              type="button"
              key={o.id}
              className="entry-choice__token"
              aria-label={`Retirer ${o.label}`}
              onClick={() => {
                onChange(property.type === "multi-select" ? ids.filter((i) => i !== o.id) : "");
                searchRef.current?.focus();
              }}
            >
              <OptionPill
                label={o.label}
                tone={o.tone}
                trailing={<AppIcon name="close" size="small" />}
              />
            </button>
          ))}
          <NativeInput
            ref={searchRef}
            aria-label="Rechercher ou créer une option"
            placeholder="Rechercher une option…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (filtered[0] !== undefined) choose(filtered[0].id);
                else void create();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget
                  .closest(".entry-choice")
                  ?.querySelector<HTMLButtonElement>(".entry-choice__option")
                  ?.focus();
              }
            }}
          />
        </InputSurface>
        <p className="property-settings__caption">Sélectionnez ou créez une option</p>
        <div className="entry-choice__list">
          {filtered.map((option, index) => (
            <div className="entry-choice__row" key={option.id}>
              <button
                type="button"
                className="entry-choice__option"
                aria-pressed={ids.includes(option.id)}
                onClick={() => choose(option.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  const buttons = event.currentTarget
                    .closest(".entry-choice__list")
                    ?.querySelectorAll<HTMLButtonElement>(".entry-choice__option");
                  buttons?.[
                    (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) %
                      filtered.length
                  ]?.focus();
                }}
              >
                <OptionPill label={option.label} tone={option.tone} />
                {ids.includes(option.id) ? <AppIcon name="check" size="small" /> : null}
              </button>
              {onOptions === undefined ? null : (
                <MenuRoot placement="right-start">
                  <MenuTrigger
                    className="entry-choice__option-settings"
                    aria-label={`Modifier l’option ${option.label}`}
                  >
                    <AppIcon name="more" size="small" />
                  </MenuTrigger>
                  <MenuContent className="property-settings__menu" unmountOnHide>
                    <PropertyOptionSettings
                      option={option}
                      onChange={(change) => void patch(option.id, change)}
                      onRetire={() => void patch(option.id, { state: "retired" })}
                    />
                  </MenuContent>
                </MenuRoot>
              )}
            </div>
          ))}
        </div>
        {onOptions !== undefined &&
        query.trim() &&
        !active.some((o) => o.label.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) ? (
          <Button
            className="entry-choice__create"
            size="compact"
            variant="ghost"
            disabled={creating}
            onClick={() => void create()}
          >
            <AppIcon name="add" size="small" />
            Créer « {query.trim()} »
          </Button>
        ) : null}
        {filtered.length === 0 && !query.trim() ? (
          <p className="property-settings__caption">Aucune option</p>
        ) : null}
        {error === null ? null : (
          <p className="database-field__error" role="alert">
            {error}
          </p>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}
