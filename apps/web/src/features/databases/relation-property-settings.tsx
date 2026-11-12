import { type DatabaseProperty, generateUuidV7, type Uuid } from "@myownnotion/domain";
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
  const ownSource = catalog?.sources.find((source) => source.propertyIds.includes(property.id));
  const [pairName, setPairName] = useState("");
  const [pairOpen, setPairOpen] = useState(false);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const paired = property.config.reciprocalPropertyId !== undefined;
  const canPair =
    ownSource !== undefined &&
    selected !== undefined &&
    ownSource.definitionRevisionId !== undefined &&
    selected.definitionRevisionId !== undefined &&
    property.config.cardinality === "many";
  const runPair = async (command: "create" | "remove"): Promise<void> => {
    if (catalog === null || ownSource === undefined || selected === undefined) return;
    const baseRevisionId = ownSource.definitionRevisionId;
    const inverseBaseRevisionId = selected.definitionRevisionId;
    if (baseRevisionId === undefined || inverseBaseRevisionId === undefined) return;
    setPairBusy(true);
    setPairError(null);
    try {
      const result = await catalog.service.mutate(
        command === "create" ? "database.relation.pair.create" : "database.relation.pair.remove",
        command === "create"
          ? {
              databaseId: ownSource.id,
              relationPropertyId: property.id,
              inversePropertyId: generateUuidV7(),
              inverseName: pairName.trim(),
              baseRevisionId,
              inverseBaseRevisionId,
            }
          : {
              databaseId: ownSource.id,
              relationPropertyId: property.id,
              baseRevisionId,
              inverseBaseRevisionId,
            },
        [baseRevisionId, inverseBaseRevisionId],
      );
      if (!result.ok) throw new Error(result.error.title);
      setPairOpen(false);
      setPairName("");
    } catch (cause) {
      setPairError(
        cause instanceof Error ? cause.message : "La relation liée n’a pas pu être modifiée.",
      );
    } finally {
      setPairBusy(false);
    }
  };
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
      <MenuRoot
        open={pairOpen}
        setOpen={(open) => {
          if (!pairBusy) setPairOpen(open);
        }}
      >
        <MenuTrigger
          bare
          className="property-settings__type"
          data-relation-pair
          disabled={property.config.targetSourceId === undefined}
        >
          <AppIcon name="link" size="small" />
          <span>Ajouter une propriété liée</span>
          <span className="property-settings__type-value">{paired ? "Activé" : "Désactivé"}</span>
          <AppIcon name="chevronRight" size="small" />
        </MenuTrigger>
        <MenuContent className="property-settings__menu" aria-label="Relation liée" unmountOnHide>
          {paired ? (
            <>
              <p className="property-settings__note">
                La propriété inverse apparaît dans «&nbsp;{selected?.name ?? "la source liée"}
                &nbsp;». La retirer conserve cette relation et tous ses liens.
              </p>
              <MenuItem disabled={pairBusy} onClick={() => void runPair("remove")}>
                Retirer la relation liée
              </MenuItem>
            </>
          ) : (
            <>
              <label className="property-settings__field">
                <span>Nom de la propriété liée</span>
                <input
                  aria-label="Nom de la propriété liée"
                  value={pairName}
                  placeholder={selected?.name ?? "Propriété liée"}
                  disabled={pairBusy}
                  onChange={(event) => setPairName(event.target.value)}
                />
              </label>
              <MenuItem
                disabled={pairBusy || !canPair || pairName.trim() === ""}
                onClick={() => void runPair("create")}
              >
                Activer la relation liée
              </MenuItem>
              {canPair ? null : (
                <p className="property-settings__note" role="status">
                  Une relation liée demande une source connue localement, une limite «&nbsp;Aucune
                  limite&nbsp;» et une connexion pour créer les deux propriétés.
                </p>
              )}
            </>
          )}
          {pairError === null ? null : (
            <p className="database-field__error" role="alert">
              {pairError}
            </p>
          )}
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
