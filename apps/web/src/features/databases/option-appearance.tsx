import type { DatabaseProperty, PropertyOption, Uuid } from "@myownnotion/domain";
import { generateUuidV7 } from "@myownnotion/domain";
import { useState } from "react";
import type { DatabaseViewRow } from "../../services/databases.ts";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/menu.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { displayDatabaseValue } from "./database-value.ts";
import type { ValueDraft } from "./value-editor.tsx";

export const OPTION_TONES = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type OptionTone = (typeof OPTION_TONES)[number];

const OPTION_TONE_LABELS: Readonly<Record<OptionTone, string>> = {
  gray: "Gris",
  brown: "Brun",
  orange: "Orange",
  yellow: "Jaune",
  green: "Vert",
  blue: "Bleu",
  purple: "Violet",
  pink: "Rose",
  red: "Rouge",
};

export function optionTone(tone: string): OptionTone {
  if (tone === "neutral") return "gray";
  return OPTION_TONES.includes(tone as OptionTone) ? (tone as OptionTone) : "gray";
}

export function nextOptionTone(index: number): OptionTone {
  return OPTION_TONES[index % OPTION_TONES.length] ?? "gray";
}

export function isChoiceProperty(
  property: DatabaseProperty,
): property is Extract<DatabaseProperty, { type: "status" | "select" | "multi-select" }> {
  return (
    property.type === "status" || property.type === "select" || property.type === "multi-select"
  );
}

export function OptionPill({ label, tone }: { readonly label: string; readonly tone: string }) {
  return (
    <span className="option-pill" data-tone={optionTone(tone)}>
      <span className="option-pill__dot" aria-hidden="true" />
      <span className="option-pill__label">{label}</span>
    </span>
  );
}

export function OptionTonePicker({
  tone,
  onChange,
}: {
  readonly tone: string;
  readonly onChange: (tone: OptionTone) => void;
}) {
  const current = optionTone(tone);
  return (
    <div
      className="option-tone-picker"
      role="radiogroup"
      aria-label={DATABASE_COPY.property.optionColor}
    >
      {OPTION_TONES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          className="option-tone-picker__swatch"
          data-tone={candidate}
          aria-label={OPTION_TONE_LABELS[candidate]}
          aria-pressed={candidate === current}
          onClick={() => onChange(candidate)}
        />
      ))}
    </div>
  );
}

function choiceIds(property: DatabaseProperty, row: DatabaseViewRow): readonly string[] {
  if (!isChoiceProperty(property)) return [];
  const value = row.values[property.id];
  if (value === undefined) return [];
  if (
    (property.type === "status" || property.type === "select") &&
    (value.kind === "status" || value.kind === "select")
  ) {
    return [value.optionId];
  }
  if (property.type === "multi-select" && value.kind === "multi-select") return value.optionIds;
  return [];
}

export function choiceOptionsForRow(
  property: DatabaseProperty,
  row: DatabaseViewRow,
): readonly PropertyOption[] {
  if (!isChoiceProperty(property)) return [];
  return choiceIds(property, row).flatMap((id) => {
    const option = property.config.options.find((candidate) => candidate.id === id);
    return option === undefined ? [] : [option];
  });
}

export function PropertyValue({
  property,
  row,
}: {
  readonly property: DatabaseProperty;
  readonly row: DatabaseViewRow;
}) {
  const options = choiceOptionsForRow(property, row);
  if (!isChoiceProperty(property)) return displayDatabaseValue(row, property);
  if (options.length === 0) return "—";
  return (
    <span className="option-pill-row">
      {options.map((option) => (
        <OptionPill key={option.id} label={option.label} tone={option.tone} />
      ))}
    </span>
  );
}

export function OptionValueMenu({
  property,
  row,
  onCommit,
}: {
  readonly property: Extract<DatabaseProperty, { type: "status" | "select" | "multi-select" }>;
  readonly row: DatabaseViewRow;
  readonly onCommit: (draft: ValueDraft) => void;
}) {
  const selected = new Set(choiceIds(property, row));
  const options = property.config.options.filter(
    (option) => option.state === "active" || selected.has(option.id),
  );
  const chosen = options.filter((option) => selected.has(option.id));
  return (
    <MenuRoot>
      <MenuTrigger bare className="option-menu__trigger" aria-label={property.name} tabIndex={-1}>
        {chosen.length === 0 ? (
          <span className="option-menu__empty">—</span>
        ) : (
          <span className="option-pill-row">
            {chosen.map((option) => (
              <OptionPill key={option.id} label={option.label} tone={option.tone} />
            ))}
          </span>
        )}
      </MenuTrigger>
      <MenuContent>
        {property.type === "multi-select" ? null : (
          <MenuItem onClick={() => onCommit("")}>—</MenuItem>
        )}
        {options.map((option) => (
          <MenuItem
            key={option.id}
            data-option-id={option.id}
            aria-checked={property.type === "multi-select" ? selected.has(option.id) : undefined}
            onClick={() => {
              if (property.type === "multi-select") {
                const next = selected.has(option.id)
                  ? [...selected].filter((id) => id !== option.id)
                  : [...selected, option.id];
                onCommit(next);
                return;
              }
              onCommit(option.id);
            }}
          >
            <OptionPill label={option.label} tone={option.tone} />
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}

export function PropertyOptionsEditor({
  options,
  onChange,
}: {
  readonly options: readonly PropertyOption[];
  readonly onChange: (options: readonly PropertyOption[]) => void;
}) {
  const active = options.filter((option) => option.state === "active");
  return (
    <div className="property-options">
      <ul>
        {active.map((option) => (
          <li key={option.id}>
            <OptionPill label={option.label} tone={option.tone} />
            <OptionLabelField
              label={option.label}
              onCommit={(label) => {
                if (
                  active.some(
                    (candidate) => candidate.id !== option.id && candidate.label === label,
                  )
                ) {
                  return;
                }
                onChange(
                  options.map((candidate) =>
                    candidate.id === option.id ? { ...candidate, label } : candidate,
                  ),
                );
              }}
            />
            <OptionTonePicker
              tone={option.tone}
              onChange={(tone) =>
                onChange(
                  options.map((candidate) =>
                    candidate.id === option.id ? { ...candidate, tone } : candidate,
                  ),
                )
              }
            />
            <button
              type="button"
              className="link"
              aria-label={`${DATABASE_COPY.property.removeOption} ${option.label}`}
              onClick={() =>
                onChange(
                  options.map((candidate) =>
                    candidate.id === option.id ? { ...candidate, state: "retired" } : candidate,
                  ),
                )
              }
            >
              {DATABASE_COPY.property.removeOption}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="link"
        onClick={() =>
          onChange([
            ...options,
            {
              id: generateUuidV7(),
              label: DATABASE_COPY.property.newOption,
              positionKey: `option-${String(options.length).padStart(6, "0")}`,
              tone: nextOptionTone(active.length),
              state: "active",
            },
          ])
        }
      >
        {DATABASE_COPY.property.addOption}
      </button>
    </div>
  );
}

function OptionLabelField({
  label,
  onCommit,
}: {
  readonly label: string;
  readonly onCommit: (label: string) => void;
}) {
  const [value, setValue] = useState(label);
  return (
    <input
      aria-label={DATABASE_COPY.property.optionName}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const next = value.trim();
        if (next.length === 0 || next === label) {
          setValue(label);
          return;
        }
        onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function replaceChoiceOptions(
  properties: readonly DatabaseProperty[],
  propertyId: Uuid,
  options: readonly PropertyOption[],
): DatabaseProperty[] {
  return properties.map((property) => {
    if (property.id !== propertyId || !isChoiceProperty(property)) return property;
    return { ...property, config: { options } };
  });
}
