import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/menu.tsx";
import { useRelationCatalog } from "./relation-catalog.tsx";

export function RelationPropertySettings({
  property,
  onChange,
}: {
  readonly property: Extract<DatabaseProperty, { type: "relation" }>;
  readonly onChange: (edit: (property: DatabaseProperty) => DatabaseProperty) => void;
}) {
  const catalog = useRelationCatalog();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Partial<typeof property.config> | null>(null);
  const selected = catalog?.sources.find((source) => source.id === property.config.targetSourceId);
  const matchingSources =
    catalog?.sources.filter((source) =>
      source.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  const update = (change: Partial<typeof property.config>) => {
    // Existing values are never deleted by a schema change. Ask before changing
    // the source or reducing cardinality; server/local validation retain old edges.
    const sourceChanged =
      change.targetSourceId !== undefined &&
      change.targetSourceId !== property.config.targetSourceId;
    const cardinalityChanged =
      change.cardinality !== undefined && change.cardinality !== property.config.cardinality;
    if (!sourceChanged && !cardinalityChanged) return;
    if (
      (sourceChanged && property.config.targetSourceId !== undefined) ||
      (cardinalityChanged && change.cardinality === "one")
    ) {
      setPending(change);
      return;
    }
    commit(change);
  };
  const commit = (change: Partial<typeof property.config>) => {
    onChange((current) =>
      current.type === "relation"
        ? { ...current, config: { ...current.config, ...change } }
        : current,
    );
    setPending(null);
  };
  return (
    <div className="relation-property-settings">
      <MenuRoot>
        <MenuTrigger bare className="property-settings__type rollup-settings__row">
          <AppIcon name="link" size="small" />
          <span>Liée à</span>
          <span className="property-settings__type-value">
            {selected?.name ??
              (property.config.targetSourceId === undefined
                ? "Sélectionner une source"
                : "Source indisponible")}
          </span>
          <AppIcon name="chevronRight" size="small" />
        </MenuTrigger>
        <MenuContent
          initialFocus={searchRef}
          unmountOnHide
          className="property-settings__menu relation-property-settings__menu"
        >
          <label className="property-settings__field">
            <span className="sr-only">Rechercher une source de données</span>
            <input
              ref={searchRef}
              value={query}
              placeholder="Rechercher une source…"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {catalog?.loading ? <p role="status">Chargement des sources…</p> : null}
          {catalog?.error ? (
            <>
              <p role="alert">{catalog.error}</p>
              <MenuItem onClick={catalog.retry}>Réessayer</MenuItem>
            </>
          ) : null}
          {catalog === null ? (
            <p role="alert">Les sources ne sont pas disponibles dans cette vue.</p>
          ) : null}
          {matchingSources.map((source) => (
            <MenuItem key={source.id} onClick={() => update({ targetSourceId: source.id as Uuid })}>
              {source.name}
            </MenuItem>
          ))}
          {catalog !== null &&
          !catalog.loading &&
          catalog.error === null &&
          matchingSources.length === 0 ? (
            <p role="status">
              {catalog.sources.length === 0
                ? "Aucune source disponible."
                : "Aucune source correspondante."}
            </p>
          ) : null}
        </MenuContent>
      </MenuRoot>
      <MenuRoot placement="right-start">
        <MenuTrigger bare className="property-settings__type" data-relation-limit>
          <AppIcon name="list" size="small" />
          <span>Limite</span>
          <span className="property-settings__type-value">
            {property.config.cardinality === "one" ? "1 page" : "Aucune limite"}
          </span>
          <AppIcon name="chevronRight" size="small" />
        </MenuTrigger>
        <MenuContent
          className="property-settings__menu"
          aria-label="Limite de la relation"
          unmountOnHide
        >
          {(["one", "many"] as const).map((cardinality) => (
            <MenuItem
              key={cardinality}
              role="menuitemradio"
              aria-checked={property.config.cardinality === cardinality}
              shortcut={
                property.config.cardinality === cardinality ? (
                  <AppIcon name="check" size="small" />
                ) : undefined
              }
              onClick={() => update({ cardinality })}
            >
              {cardinality === "one" ? "1 page" : "Aucune limite"}
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
      {property.config.targetSourceId === undefined ? (
        <p className="muted property-settings__note">
          Choisissez une source pour relier ses pages et configurer une agrégation. Les liens
          existants sont conservés.
        </p>
      ) : null}
      {pending === null ? null : (
        <fieldset aria-label="Confirmer la modification de relation">
          <p>
            Les liens existants seront conservés, même hors de la nouvelle source. Une limite plus
            basse peut nécessiter de retirer des liens avant la prochaine modification.
          </p>
          <Button size="compact" onClick={() => commit(pending)}>
            Confirmer
          </Button>
          <Button size="compact" variant="ghost" onClick={() => setPending(null)}>
            Annuler
          </Button>
        </fieldset>
      )}
    </div>
  );
}
