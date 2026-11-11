import type { DatabaseProperty } from "@myownnotion/domain";
import { useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/menu.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { useRelationCandidates } from "./relation-catalog.tsx";
import type { RelationOption, ValueDraft } from "./value-editor.tsx";

export function RelationDraftMenu({
  property,
  input,
  options: fallbackOptions,
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
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const candidates = useRelationCandidates(property.config.targetSourceId);
  const options =
    property.config.targetSourceId === undefined ? fallbackOptions : candidates.options;
  const selected = new Set(Array.isArray(input) ? input : []);
  const chosen = [...selected].map((value) => ({
    id: value,
    label:
      options.find((option) => option.id === value)?.label ??
      fallbackOptions.find((option) => option.id === value)?.label ??
      DATABASE_COPY.common.unavailablePage,
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
      <MenuContent initialFocus={searchRef} unmountOnHide>
        <label className="property-settings__field">
          <span className="sr-only">Rechercher une page liée</span>
          <input
            ref={searchRef}
            value={query}
            placeholder="Rechercher une page…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {candidates.loading ? <p role="status">Chargement des pages…</p> : null}
        {candidates.error ? (
          <>
            <p role="alert">{candidates.error}</p>
            <MenuItem onClick={candidates.retry}>Réessayer</MenuItem>
          </>
        ) : null}
        {property.config.targetSourceId !== undefined && candidates.source === undefined ? (
          <p role="status">La source liée n’est pas disponible localement.</p>
        ) : null}
        {!candidates.loading &&
        candidates.error === null &&
        options.filter((option) =>
          option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        ).length === 0 ? (
          <p className="muted property-settings__note" role="status">
            Aucune page correspondante.
          </p>
        ) : null}
        <MenuItem onClick={() => onChange([])}>{DATABASE_COPY.common.noPage}</MenuItem>
        {[...selected]
          .filter((value) => !options.some((option) => option.id === value))
          .map((value) => (
            <MenuItem
              key={value}
              onClick={() => onChange([...selected].filter((id) => id !== value))}
            >
              Retirer {chosen.find((option) => option.id === value)?.label} (hors source ou
              indisponible)
            </MenuItem>
          ))}
        {options
          .filter((option) => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((option) => (
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
