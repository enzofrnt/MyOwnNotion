import type { DatabaseProperty } from "@myownnotion/domain";
import { AppIcon } from "../../ui/icons.tsx";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/menu.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import type { RelationOption, ValueDraft } from "./value-editor.tsx";

export function RelationDraftMenu({
  property,
  input,
  options,
  id,
  describedBy,
  emptyLabel,
  onChange,
}: {
  readonly property: Extract<DatabaseProperty, { type: "relation" }>;
  readonly input: ValueDraft;
  readonly options: readonly RelationOption[];
  readonly id: string;
  readonly describedBy?: string;
  readonly emptyLabel?: string | undefined;
  readonly onChange: (input: ValueDraft) => void;
}) {
  const selected = new Set(Array.isArray(input) ? input : []);
  const chosen = [...selected].map((value) => ({
    id: value,
    label:
      options.find((option) => option.id === value)?.label ?? DATABASE_COPY.common.unavailablePage,
  }));
  return (
    <MenuRoot>
      <MenuTrigger
        bare
        className="option-menu__trigger"
        id={id}
        aria-label={property.name}
        aria-describedby={describedBy}
      >
        {chosen.length === 0 ? (
          <span className="option-menu__empty">{emptyLabel ?? DATABASE_COPY.common.noPage}</span>
        ) : (
          <span className="entry-relation-values">
            {chosen.map((option) => (
              <span className="entry-relation-values__page" key={option.id} title={option.label}>
                <AppIcon name="fileText" size="small" className="entry-relation-values__icon" />
                <span>{option.label}</span>
              </span>
            ))}
          </span>
        )}
      </MenuTrigger>
      <MenuContent unmountOnHide>
        <MenuItem onClick={() => onChange([])}>{DATABASE_COPY.common.noPage}</MenuItem>
        {options.map((option) => (
          <MenuItem
            key={option.id}
            role={property.config.cardinality === "many" ? "menuitemcheckbox" : "menuitemradio"}
            aria-checked={selected.has(option.id)}
            shortcut={selected.has(option.id) ? <AppIcon name="check" size="small" /> : undefined}
            onClick={() =>
              onChange(
                property.config.cardinality === "one"
                  ? [option.id]
                  : selected.has(option.id)
                    ? [...selected].filter((value) => value !== option.id)
                    : [...selected, option.id],
              )
            }
          >
            <AppIcon name="fileText" size="small" />
            {option.label}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
