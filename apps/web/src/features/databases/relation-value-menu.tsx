import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/menu.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { inverseRelationPatch } from "./inverse-relation-edit.ts";
import { useRelationCandidates, useRelationCatalog } from "./relation-catalog.tsx";
import type { RelationOption, ValueDraft } from "./value-editor.tsx";

export function RelationDraftMenu({
  property,
  input,
  options: fallbackOptions,
  id,
  describedBy,
  emptyLabel,
  entryId,
  onChange,
}: {
  readonly property: Extract<DatabaseProperty, { type: "relation" }>;
  readonly input: ValueDraft;
  readonly options: readonly RelationOption[];
  readonly id: string;
  readonly describedBy?: string;
  readonly emptyLabel?: string | undefined;
  readonly entryId?: Uuid | undefined;
  readonly onChange: (input: ValueDraft) => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const candidates = useRelationCandidates(property.config.targetSourceId);
  const options =
    property.config.targetSourceId === undefined ? fallbackOptions : candidates.options;
  const selected = new Set(Array.isArray(input) ? input : []);
  const catalog = useRelationCatalog();
  // A relation's options must come from *its* configured source: the inverse
  // side targets the partner source, not the one the surrounding table shows.
  const discovered = useRelationCandidates(property.config.targetSourceId);
  const liveOptions =
    property.config.targetSourceId !== undefined && discovered.options.length > 0
      ? discovered.options
      : options;
  const partnerSourceId = property.config.targetSourceId;
  const partnerPropertyId = property.config.reciprocalPropertyId;
  const inverse = property.config.inverseEdges === true;
  const partnerOwnerItemId =
    catalog?.sources.find((source) => source.id === partnerSourceId)?.ownerItemId ?? undefined;
  const canToggle =
    inverse &&
    catalog !== null &&
    entryId !== undefined &&
    partnerOwnerItemId !== undefined &&
    partnerPropertyId !== undefined;
  const [busy, setBusy] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const togglePartnerEdge = async (targetEntryId: Uuid): Promise<void> => {
    if (!canToggle || catalog === null) return;
    setBusy(targetEntryId);
    setPatchError(null);
    try {
      const item = await catalog.service.getItem(targetEntryId);
      const patch = inverseRelationPatch(
        property,
        partnerOwnerItemId,
        entryId,
        targetEntryId,
        !selected.has(targetEntryId),
        item?.currentRevisionId,
      );
      if (patch === null) throw new Error("La relation liée n’est pas connue sur cet appareil.");
      const result = await catalog.service.mutate("database.entry.relation.patch", { ...patch }, [
        patch.baseRevisionId,
      ]);
      if (!result.ok) throw new Error(result.error.title);
    } catch (cause) {
      setPatchError(cause instanceof Error ? cause.message : "Le lien n’a pas pu être modifié.");
    } finally {
      setBusy(null);
    }
  };

  // Without a catalogue or an entry identity the inverse side cannot write the
  // partner's edges: show the values and say where they are edited instead.
  if (inverse && !canToggle) {
    const labels = [...selected].map(
      (value) =>
        options.find((option) => option.id === value)?.label ??
        fallbackOptions.find((option) => option.id === value)?.label ??
        DATABASE_COPY.common.unavailablePage,
    );
    return (
      <span className="option-menu__trigger" id={id} aria-describedby={describedBy}>
        {labels.length === 0 ? (
          <span className="option-menu__empty">{emptyLabel ?? DATABASE_COPY.common.noPage}</span>
        ) : (
          <span className="entry-relation-values">
            {labels.map((label) => (
              <span className="entry-relation-values__page" key={label} title={label}>
                <AppIcon name="fileText" size="small" className="entry-relation-values__icon" />
                <span>{label}</span>
              </span>
            ))}
          </span>
        )}
        <span className="sr-only">
          Relation liée en lecture : modifiez-la depuis la propriété d’origine.
        </span>
      </span>
    );
  }
  const chosen = [...selected].map((value) => ({
    id: value,
    label:
      options.find((option) => option.id === value)?.label ??
      fallbackOptions.find((option) => option.id === value)?.label ??
      DATABASE_COPY.common.unavailablePage,
  }));
  return (
    <>
      {patchError === null ? null : (
        <p className="database-field__error" role="alert">
          {patchError}
        </p>
      )}
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
          {inverse ? null : (
            <MenuItem onClick={() => onChange([])}>{DATABASE_COPY.common.noPage}</MenuItem>
          )}
          {inverse && !canToggle ? (
            <p className="muted property-settings__note" role="status">
              Modification indisponible : la page ou la relation liée n’est pas connue sur cet
              appareil.
            </p>
          ) : null}
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
          {liveOptions
            .filter((option) =>
              option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((option) => (
              <MenuItem
                key={option.id}
                role={property.config.cardinality === "many" ? "menuitemcheckbox" : "menuitemradio"}
                aria-checked={selected.has(option.id)}
                disabled={busy === option.id}
                shortcut={
                  selected.has(option.id) ? <AppIcon name="check" size="small" /> : undefined
                }
                onClick={() =>
                  inverse
                    ? canToggle
                      ? void togglePartnerEdge(option.id as Uuid)
                      : undefined
                    : onChange(
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
    </>
  );
}
