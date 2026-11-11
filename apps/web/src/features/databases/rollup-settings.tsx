import {
  type DatabaseProperty,
  type DatabasePropertyType,
  type RollupFunction,
  rollupConfigIssue,
  rollupFunctionsForType,
  type Uuid,
} from "@myownnotion/domain";
import type { ReactNode } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/index.ts";
import { DATABASE_COPY } from "./database-copy.ts";
import type { RollupTargetOption } from "./local-rollup.ts";
import { DatabasePropertyIcon } from "./property-icon.tsx";

type RollupProperty = Extract<DatabaseProperty, { type: "rollup" }>;

/** Labels observed in Notion's « Calculer » menu (French, 2026-11-11). */
export const ROLLUP_FUNCTION_LABELS: Readonly<Record<RollupFunction, string>> = {
  show_original: "Afficher l’original",
  show_unique: "Afficher les valeurs uniques",
  count: "Tout compter",
  count_values: "Compter les valeurs",
  unique: "Valeurs uniques",
  empty: "Cellules vides",
  not_empty: "Cellules non vides",
  checked: "Cases cochées",
  unchecked: "Cases non cochées",
  count_per_group: "Nombre par groupe",
  percent_empty: "% de cellules vides",
  percent_not_empty: "% de cellules non vides",
  percent_checked: "% de cases cochées",
  percent_unchecked: "% de cases non cochées",
  percent_per_group: "% par groupe",
  sum: "Somme",
  average: "Moyenne",
  median: "Médiane",
  min: "Minimum",
  max: "Maximum",
  range: "Intervalle",
  earliest_date: "Date la plus ancienne",
  latest_date: "Date la plus récente",
  date_range: "Plage de dates",
};

const DIRECT: readonly RollupFunction[] = ["show_original", "show_unique"];
const SUBMENUS: readonly {
  readonly label: string;
  readonly functions: readonly RollupFunction[];
}[] = [
  {
    label: "Quantité",
    functions: [
      "count",
      "count_values",
      "unique",
      "empty",
      "not_empty",
      "checked",
      "unchecked",
      "count_per_group",
    ],
  },
  {
    label: "Pourcentage",
    functions: [
      "percent_empty",
      "percent_not_empty",
      "percent_checked",
      "percent_unchecked",
      "percent_per_group",
    ],
  },
  {
    label: "Plus d’options",
    functions: ["sum", "average", "median", "min", "max", "range"],
  },
  { label: "Date", functions: ["earliest_date", "latest_date", "date_range"] },
];

const ISSUE_MESSAGES = {
  "relation-missing": "La relation de cette agrégation n’existe plus. Choisissez-en une autre.",
  "target-missing": "La propriété cible n’est plus disponible. Choisissez-en une autre.",
} as const;

function isPropertyType(type: string): type is DatabasePropertyType {
  return type in DATABASE_COPY.property.typeLabels;
}

function Row({
  icon,
  label,
  value,
  disabled = false,
  children,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: ReactNode;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <MenuRoot placement="right-start">
      <MenuTrigger
        bare
        className="property-settings__type rollup-settings__row"
        disabled={disabled}
      >
        {icon}
        <span>{label}</span>
        <span className="property-settings__type-value">{value}</span>
        <AppIcon name="chevronRight" size="small" />
      </MenuTrigger>
      <MenuContent
        className="property-settings__menu rollup-settings__menu"
        aria-label={label}
        unmountOnHide
      >
        {children}
      </MenuContent>
    </MenuRoot>
  );
}

function Choice({
  selected,
  onSelect,
  children,
}: {
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  return (
    <MenuItem role="menuitemradio" aria-checked={selected} onClick={onSelect}>
      {children}
      {selected ? <AppIcon name="check" size="small" className="rollup-settings__check" /> : null}
    </MenuItem>
  );
}

/**
 * Notion's rollup configuration: a relation, a property of the linked source,
 * then a calculation that property supports. A choice that stops being valid
 * is reset or explained; it never silently keeps computing something else.
 */
export function RollupPropertySettings({
  property,
  properties,
  targets,
  relationSources,
  onChange,
}: {
  readonly property: RollupProperty;
  readonly properties: readonly DatabaseProperty[];
  /** Properties of every source a relation could reach. */
  readonly targets: readonly RollupTargetOption[];
  /** Sources each relation actually points to; absent when unknown. */
  readonly relationSources?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly onChange: (edit: (p: DatabaseProperty) => DatabaseProperty) => void;
}) {
  const relations = properties.filter(
    (candidate) => candidate.type === "relation" && candidate.state === "active",
  );
  const relation = relations.find(({ id }) => id === property.config.relationPropertyId);
  const candidatesFor = (relationId: string): readonly RollupTargetOption[] => {
    const configured = relations.find(({ id }) => id === relationId);
    const configuredSource =
      configured?.type === "relation" ? configured.config.targetSourceId : undefined;
    const sources =
      configuredSource === undefined ? (relationSources?.[relationId] ?? []) : [configuredSource];
    // Unknown is not a license to aggregate a property from an unrelated source.
    return targets.filter(({ sourceId }) => sourceId !== undefined && sources.includes(sourceId));
  };
  const candidates = candidatesFor(property.config.relationPropertyId);
  const target = candidates.find(({ id }) => id === property.config.targetPropertyId);
  const targetType = target !== undefined && isPropertyType(target.type) ? target.type : undefined;
  const available = targetType === undefined ? [] : rollupFunctionsForType(targetType);
  const issue = rollupConfigIssue(
    property,
    relation,
    targetType === undefined ? undefined : { type: targetType },
  );
  const update = (config: RollupProperty["config"]): void =>
    onChange((p) => (p.type === "rollup" ? { ...p, config } : p));

  const chooseRelation = (relationId: Uuid): void => {
    // Like Notion: a new relation starts from the linked source's title.
    const title = candidatesFor(relationId).filter(({ type }) => type === "title");
    update(
      title.length === 1 && title[0] !== undefined
        ? {
            relationPropertyId: relationId,
            targetPropertyId: title[0].id as Uuid,
            aggregate: "show_original",
          }
        : { relationPropertyId: relationId, aggregate: "count" },
    );
  };
  const chooseTarget = (option: RollupTargetOption): void => {
    const supported = isPropertyType(option.type) ? rollupFunctionsForType(option.type) : [];
    update({
      relationPropertyId: property.config.relationPropertyId,
      targetPropertyId: option.id as Uuid,
      aggregate: supported.includes(property.config.aggregate)
        ? property.config.aggregate
        : "show_original",
    });
  };
  const chooseFunction = (aggregate: RollupFunction): void =>
    update({ ...property.config, aggregate });

  const functionItem = (aggregate: RollupFunction): ReactNode => (
    <Choice
      key={aggregate}
      selected={property.config.aggregate === aggregate}
      onSelect={() => chooseFunction(aggregate)}
    >
      {ROLLUP_FUNCTION_LABELS[aggregate]}
    </Choice>
  );

  return (
    <div className="rollup-settings">
      <Row
        icon={<DatabasePropertyIcon type="relation" />}
        label="Relation"
        value={relation?.name ?? "Sélectionner"}
      >
        {relations.map((candidate) => (
          <Choice
            key={candidate.id}
            selected={candidate.id === property.config.relationPropertyId}
            onSelect={() => chooseRelation(candidate.id)}
          >
            <DatabasePropertyIcon type="relation" />
            {candidate.name}
          </Choice>
        ))}
      </Row>
      <Row
        icon={<AppIcon name="repeat2" size="small" />}
        label="Propriété cible"
        disabled={relation === undefined}
        value={
          target === undefined ? (
            "Sélectionner"
          ) : (
            <>
              {targetType === undefined ? null : <DatabasePropertyIcon type={targetType} />}
              {target.name}
            </>
          )
        }
      >
        {candidates.length === 0 ? (
          <p className="muted property-settings__note">
            Aucune propriété n’est disponible pour cette relation sur cet appareil.
          </p>
        ) : (
          candidates.map((option) => (
            <Choice
              key={option.id}
              selected={option.id === property.config.targetPropertyId}
              onSelect={() => chooseTarget(option)}
            >
              {isPropertyType(option.type) ? <DatabasePropertyIcon type={option.type} /> : null}
              {option.name}
            </Choice>
          ))
        )}
      </Row>
      <Row
        icon={<AppIcon name="rollup" size="small" />}
        label="Calculer"
        disabled={relation === undefined || targetType === undefined}
        value={ROLLUP_FUNCTION_LABELS[property.config.aggregate]}
      >
        {DIRECT.filter((aggregate) => available.includes(aggregate)).map(functionItem)}
        {SUBMENUS.map((submenu) => {
          const functions = submenu.functions.filter((aggregate) => available.includes(aggregate));
          if (functions.length === 0) return null;
          return (
            <MenuRoot key={submenu.label} placement="right-start">
              <MenuTrigger bare render={<MenuItem />}>
                {submenu.label}
                <AppIcon name="chevronRight" size="small" className="rollup-settings__check" />
              </MenuTrigger>
              <MenuContent
                className="property-settings__menu rollup-settings__menu"
                aria-label={submenu.label}
                unmountOnHide
                // Overlap the trigger: a 6 px gutter let the pointer cross empty
                // space, close the nested menu and detach the item mid-click.
                overlap
                gutter={0}
              >
                {functions.map(functionItem)}
              </MenuContent>
            </MenuRoot>
          );
        })}
      </Row>
      {issue === null ? null : (
        <p className="database-field__error rollup-settings__issue" role="alert">
          {issue === "function-incompatible"
            ? `Le calcul « ${ROLLUP_FUNCTION_LABELS[property.config.aggregate]} » ne s’applique pas à une propriété de type ${
                targetType === undefined ? "inconnu" : DATABASE_COPY.property.typeLabels[targetType]
              }. Choisissez un autre calcul.`
            : ISSUE_MESSAGES[issue]}
        </p>
      )}
    </div>
  );
}
