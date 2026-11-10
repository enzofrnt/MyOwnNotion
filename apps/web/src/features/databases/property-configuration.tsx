import {
  type DatabaseDefinition,
  type DatabaseProperty,
  type DatabasePropertyType,
  DEFAULT_DATE_FORMAT,
  DEFAULT_NUMBER_CONFIG,
  DEFAULT_TIME_FORMAT,
  dateConfigOf,
  dateDisplayConfigOf,
  generateUuidV7,
  inferStatusGroup,
  isStatusGroup,
  type NumberDecimals,
  type NumberDisplay,
  type NumberPropertyConfig,
  numberConfigOf,
  type PropertyOption,
  ROLLUP_FUNCTIONS,
  type RollupFunction,
  STATUS_GROUP_LABELS,
  STATUS_GROUPS,
  type StatusGroup,
  type StatusOption,
  statusDefaultOptionId,
  type Uuid,
  uniqueIdPrefixOf,
} from "@myownnotion/domain";
import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { DatabaseViewRow } from "../../services/databases.ts";
import { AppIcon } from "../../ui/icons.tsx";
import {
  Button,
  MenuContent,
  type MenuContentProps,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  PopoverContent,
  PopoverRoot,
} from "../../ui/primitives/index.ts";
import { DATABASE_COPY } from "./database-copy.ts";
import { DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS } from "./date-format.ts";
import { FormulaEditor } from "./formula-editor.tsx";
import { NUMBER_FORMAT_OPTIONS } from "./number-format.ts";
import {
  isChoiceProperty,
  nextOptionTone,
  OPTION_TONE_LABELS,
  OPTION_TONES,
  OptionPill,
  optionTone,
} from "./option-appearance.tsx";
import { DatabasePropertyIcon, PropertyIconPicker } from "./property-icon.tsx";

const ColumnPropertyMenuAppearance = createContext(false);

function PropertySettingsMenu({ className, ...props }: MenuContentProps) {
  const compact = useContext(ColumnPropertyMenuAppearance);
  return (
    <MenuContent
      {...props}
      className={[className, compact ? "property-settings__menu--column-menu" : ""]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export function AutoPropertyName({
  name,
  label,
  onCommit,
  inputRef,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  name: string;
  label: string;
  onCommit: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  const element = useRef<HTMLInputElement | null>(null);
  const bindInput = useCallback(
    (input: HTMLInputElement | null) => {
      element.current = input;
      if (inputRef !== undefined) inputRef.current = input;
    },
    [inputRef],
  );
  const errorId = useId();
  const error =
    value.trim() === ""
      ? DATABASE_COPY.property.nameRequired
      : value.trim().length > 512
        ? DATABASE_COPY.property.nameTooLong
        : null;
  const ref = useRef({
    name,
    value: name,
    onCommit,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  ref.current.onCommit = onCommit;
  useEffect(() => {
    if (ref.current.value === ref.current.name) {
      ref.current.value = name;
      if (element.current !== null) element.current.value = name;
      setValue(name);
    }
    ref.current.name = name;
  }, [name]);
  const commit = useCallback(() => {
    const r = ref.current;
    if (r.timer !== undefined) clearTimeout(r.timer);
    r.timer = undefined;
    const next = r.value.trim();
    if (next !== "" && next.length <= 512 && next !== r.name) {
      r.name = next;
      r.onCommit(next);
    }
  }, []);
  useEffect(() => () => commit(), [commit]);
  return (
    <div className="property-settings__name-input">
      <input
        ref={bindInput}
        className="ui-native-input"
        data-size="compact"
        aria-label={label}
        // Keep a native replacement intact if a source projection renders
        // before its input event. React state drives validation, while clean
        // source updates are adopted explicitly by the effect above.
        defaultValue={name}
        aria-invalid={error !== null || undefined}
        aria-describedby={error === null ? undefined : errorId}
        onInput={(event) => {
          const r = ref.current;
          r.value = event.currentTarget.value;
          setValue(r.value);
          if (r.timer !== undefined) clearTimeout(r.timer);
          r.timer = setTimeout(commit, 350);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
        }}
      />
      {error === null ? null : (
        <span id={errorId} className="property-settings__validation" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** The same option configuration is used from a property and its value picker. */
export function PropertyOptionSettings({
  option,
  onChange,
  onRetire,
}: {
  option: PropertyOption;
  onChange: (patch: Partial<Pick<PropertyOption, "label" | "tone">>) => void;
  onRetire: () => void;
}) {
  return (
    <div className="property-option-settings">
      <AutoPropertyName
        key={option.id}
        name={option.label}
        label={DATABASE_COPY.property.optionName}
        onCommit={(label) => onChange({ label })}
      />
      <MenuItem destructive onClick={onRetire}>
        <AppIcon name="delete" size="small" />
        Supprimer l’option
      </MenuItem>
      <MenuSeparator />
      <p className="property-settings__caption">Couleur</p>
      {OPTION_TONES.map((tone) => (
        <MenuItem
          key={tone}
          role="menuitemradio"
          aria-checked={optionTone(option.tone) === tone}
          shortcut={
            optionTone(option.tone) === tone ? <AppIcon name="check" size="small" /> : undefined
          }
          onClick={() => onChange({ tone })}
        >
          <span
            className="property-option-settings__swatch"
            style={{
              color: `var(--ui-content-${tone}-accent)`,
              backgroundColor: `var(--ui-content-${tone}-soft)`,
              borderColor: `var(--ui-content-${tone}-border)`,
            }}
            aria-hidden="true"
          >
            <span />
          </span>
          {OPTION_TONE_LABELS[tone]}
        </MenuItem>
      ))}
    </div>
  );
}

export function CompactPropertyOptions({
  property,
  onChange,
}: {
  property: Extract<DatabaseProperty, { type: "select" | "status" | "multi-select" }>;
  onChange: (options: readonly PropertyOption[]) => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const active = property.config.options.filter((o) => o.state === "active");
  const patch = (id: Uuid, change: Partial<PropertyOption>) =>
    onChange(property.config.options.map((o) => (o.id === id ? { ...o, ...change } : o)));
  const add = () => {
    const label = newLabel.trim();
    if (
      label === "" ||
      active.some((o) => o.label.toLocaleLowerCase() === label.toLocaleLowerCase())
    )
      return;
    onChange([
      ...property.config.options,
      {
        id: generateUuidV7(),
        label,
        tone: nextOptionTone(active.length),
        positionKey: `option-${String(property.config.options.length).padStart(6, "0")}`,
        state: "active",
      },
    ]);
    setNewLabel("");
  };
  return (
    <div className="property-settings__options">
      <p className="property-settings__caption">Options</p>
      {active.map((option) => (
        <MenuRoot key={option.id} placement="right-start">
          <MenuTrigger
            bare
            className="property-settings__option"
            aria-label={`Modifier l’option ${option.label}`}
          >
            <OptionPill label={option.label} tone={option.tone} />
            <AppIcon name="chevronRight" size="small" />
          </MenuTrigger>
          <PropertySettingsMenu className="property-settings__menu" unmountOnHide>
            <PropertyOptionSettings
              option={option}
              onChange={(change) => patch(option.id, change)}
              onRetire={() => patch(option.id, { state: "retired" })}
            />
          </PropertySettingsMenu>
        </MenuRoot>
      ))}
      <form
        className="property-settings__new-option"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className="ui-native-input"
          data-size="compact"
          aria-label="Nouvelle option"
          placeholder="Ajouter une option…"
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
        />
        <Button
          variant="ghost"
          size="square"
          aria-label="Ajouter l’option"
          disabled={!newLabel.trim()}
          type="submit"
        >
          <AppIcon name="add" size="small" />
        </Button>
      </form>
    </div>
  );
}

export const ENTRY_PROPERTY_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
  "url",
  "email",
  "phone",
  "created-time",
  "last-edited-time",
  "place",
  "relation",
] as const;
export function propertyWithType(
  property: DatabaseProperty,
  type: Exclude<DatabasePropertyType, "title">,
): DatabaseProperty {
  const base = {
    id: property.id,
    name: property.name,
    ...(property.icon === undefined ? {} : { icon: property.icon }),
    positionKey: property.positionKey,
    state: property.state,
  };
  if (type === "number") return { ...base, type, config: { ...DEFAULT_NUMBER_CONFIG } };
  if (type === "formula") return { ...base, type, config: { expression: 'prop("Titre")' } };
  if (type === "files" || type === "place") return { ...base, type, config: {} };
  if (type === "unique-id") return { ...base, type, config: {} };
  if (type === "rollup")
    return { ...base, type, config: { relationPropertyId: generateUuidV7(), aggregate: "count" } };
  if (type === "date")
    return {
      ...base,
      type,
      config: {
        mode: "date",
        dateFormat: DEFAULT_DATE_FORMAT,
        timeFormat: DEFAULT_TIME_FORMAT,
      },
    };
  if (type === "relation") return { ...base, type, config: { cardinality: "many" } };
  if (type === "status") {
    const options = (isChoiceProperty(property) ? property.config.options : []).map((option) => ({
      ...option,
      group:
        "group" in option && isStatusGroup(option.group)
          ? option.group
          : inferStatusGroup(option.label),
    }));
    const defaultOptionId = options.find((option) => option.state === "active")?.id;
    return {
      ...base,
      type,
      config: { options, ...(defaultOptionId === undefined ? {} : { defaultOptionId }) },
    };
  }
  if (type === "select" || type === "multi-select")
    return {
      ...base,
      type,
      config: { options: isChoiceProperty(property) ? property.config.options : [] },
    };
  return { ...base, type, config: {} };
}

export function updateEntryProperty(
  definition: DatabaseDefinition,
  id: Uuid,
  edit: (p: DatabaseProperty) => DatabaseProperty,
): DatabaseDefinition {
  const properties = definition.properties.map((p) => (p.id === id ? edit(p) : p));
  const roles = definition.taskRoles;
  const active = (id: Uuid | null) => properties.find((p) => p.id === id && p.state === "active");
  const status = roles === null ? undefined : active(roles.statusPropertyId);
  const due = roles === null ? undefined : active(roles.dueDatePropertyId);
  const priority = roles === null ? undefined : active(roles.priorityPropertyId);
  const taskRoles =
    roles === null || (status?.type !== "status" && status?.type !== "select")
      ? null
      : {
          ...roles,
          dueDatePropertyId: due?.type === "date" ? due.id : null,
          priorityPropertyId:
            priority?.type === "status" || priority?.type === "select" ? priority.id : null,
        };
  return { ...definition, properties, taskRoles };
}

function StatusOptionsEditor({
  property,
  onChange,
}: {
  readonly property: Extract<DatabaseProperty, { type: "status" }>;
  readonly onChange: (edit: (p: DatabaseProperty) => DatabaseProperty) => void;
}) {
  const [newLabels, setNewLabels] = useState<Record<StatusGroup, string>>({
    todo: "",
    "in-progress": "",
    complete: "",
  });
  const active = property.config.options.filter((option) => option.state === "active");
  const defaultId = statusDefaultOptionId(property);
  const patch = (options: readonly StatusOption[], defaultOptionId?: string): void =>
    onChange((p) =>
      p.type === "status"
        ? {
            ...p,
            config: {
              options,
              ...(defaultOptionId === undefined
                ? {}
                : { defaultOptionId: defaultOptionId as Uuid }),
            },
          }
        : p,
    );
  const updateOption = (id: string, change: Partial<StatusOption>): void =>
    patch(
      property.config.options.map((option) =>
        option.id === id ? { ...option, ...change } : option,
      ),
    );
  const retire = (id: string): void => {
    const options = property.config.options.map((option) =>
      option.id === id ? { ...option, state: "retired" as const } : option,
    );
    const nextDefault =
      property.config.defaultOptionId === id
        ? options.find((option) => option.state === "active")?.id
        : property.config.defaultOptionId;
    patch(options, nextDefault);
  };
  const add = (group: StatusGroup): void => {
    const label = newLabels[group].trim();
    if (
      label === "" ||
      active.some((option) => option.label.toLocaleLowerCase() === label.toLocaleLowerCase())
    ) {
      return;
    }
    const options = [
      ...property.config.options,
      {
        id: generateUuidV7(),
        label,
        tone: group === "complete" ? "green" : group === "in-progress" ? "blue" : "gray",
        positionKey: `option-${String(property.config.options.length).padStart(6, "0")}`,
        state: "active" as const,
        group,
      },
    ];
    patch(options, property.config.defaultOptionId ?? options[0]?.id);
    setNewLabels((current) => ({ ...current, [group]: "" }));
  };
  return (
    <div className="property-settings__status">
      {STATUS_GROUPS.map((group) => (
        <section key={group} className="property-settings__status-group">
          <div className="property-settings__status-heading">
            <span className={`property-settings__status-dot is-${group}`} aria-hidden="true" />
            <span>{STATUS_GROUP_LABELS[group]}</span>
          </div>
          <ul className="property-settings__status-options">
            {active
              .filter(
                (option) =>
                  (isStatusGroup(option.group) ? option.group : inferStatusGroup(option.label)) ===
                  group,
              )
              .map((option) => (
                <li key={option.id}>
                  <MenuRoot placement="right-start">
                    <MenuTrigger
                      bare
                      className="property-settings__option"
                      aria-label={`Modifier l’option ${option.label}`}
                    >
                      <OptionPill label={option.label} tone={option.tone} />
                      {option.id === defaultId ? (
                        <span className="property-settings__default">PAR DÉFAUT</span>
                      ) : null}
                      <AppIcon name="chevronRight" size="small" />
                    </MenuTrigger>
                    <PropertySettingsMenu className="property-settings__menu" unmountOnHide>
                      <div className="property-settings__status-field">
                        <span>Groupe</span>
                        <select
                          className="ui-native-input"
                          data-size="compact"
                          aria-label={`Groupe de ${option.label}`}
                          value={
                            isStatusGroup(option.group)
                              ? option.group
                              : inferStatusGroup(option.label)
                          }
                          onChange={(event) =>
                            updateOption(option.id, {
                              group: event.target.value as StatusGroup,
                            })
                          }
                        >
                          {STATUS_GROUPS.map((candidate) => (
                            <option key={candidate} value={candidate}>
                              {STATUS_GROUP_LABELS[candidate]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <MenuItem
                        role="menuitemradio"
                        aria-checked={option.id === defaultId}
                        onClick={() => patch(property.config.options, option.id)}
                      >
                        <AppIcon name="check" size="small" />
                        Définir par défaut
                      </MenuItem>
                      <PropertyOptionSettings
                        option={option}
                        onChange={(change) => updateOption(option.id, change)}
                        onRetire={() => retire(option.id)}
                      />
                    </PropertySettingsMenu>
                  </MenuRoot>
                </li>
              ))}
          </ul>
          <form
            className="property-settings__status-add"
            onSubmit={(event) => {
              event.preventDefault();
              add(group);
            }}
          >
            <input
              className="ui-native-input"
              data-size="compact"
              aria-label={`Nouvelle option ${STATUS_GROUP_LABELS[group]}`}
              placeholder="Ajouter une option…"
              value={newLabels[group]}
              onChange={(event) =>
                setNewLabels((current) => ({ ...current, [group]: event.target.value }))
              }
            />
            <Button
              type="submit"
              size="square"
              variant="ghost"
              aria-label={`Ajouter l’option ${STATUS_GROUP_LABELS[group]}`}
              disabled={!newLabels[group].trim()}
            >
              <AppIcon name="add" size="small" />
            </Button>
          </form>
        </section>
      ))}
      <label className="property-settings__field">
        <span>Option par défaut</span>
        <select
          className="ui-native-input"
          data-size="compact"
          aria-label="Option par défaut"
          value={defaultId ?? ""}
          onChange={(event) => patch(property.config.options, event.target.value || undefined)}
        >
          {active.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted property-settings__note">
        Les modifications s’appliquent à toutes les vues qui affichent cette propriété.
      </p>
    </div>
  );
}

function AutoDatePropertySettings({
  property,
  onChange,
}: {
  readonly property: DatabaseProperty;
  readonly onChange: (edit: (p: DatabaseProperty) => DatabaseProperty) => void;
}) {
  const config = dateDisplayConfigOf(property);
  const update = (next: Partial<typeof config>): void =>
    onChange((p) =>
      p.type === "created-time" || p.type === "last-edited-time"
        ? { ...p, config: { ...p.config, ...next } }
        : p,
    );
  return (
    <div className="property-settings__number">
      <label className="property-settings__field">
        <span>Format de date</span>
        <select
          className="ui-native-input"
          data-size="compact"
          aria-label="Format de date"
          value={config.dateFormat}
          onChange={(event) =>
            update({ dateFormat: event.target.value as typeof config.dateFormat })
          }
        >
          {DATE_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="property-settings__field">
        <span>Format de l’heure</span>
        <select
          className="ui-native-input"
          data-size="compact"
          aria-label="Format de l’heure"
          value={config.timeFormat}
          onChange={(event) =>
            update({ timeFormat: event.target.value as typeof config.timeFormat })
          }
        >
          {TIME_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted property-settings__note">
        Les modifications s’appliquent à toutes les vues qui affichent cette propriété.
      </p>
    </div>
  );
}

function DatePropertySettings({
  property,
  onChange,
}: {
  readonly property: DatabaseProperty;
  readonly onChange: (edit: (p: DatabaseProperty) => DatabaseProperty) => void;
}) {
  const config = dateConfigOf(property);
  const update = (next: Partial<typeof config>): void =>
    onChange((p) => (p.type === "date" ? { ...p, config: { ...p.config, ...next } } : p));
  return (
    <div className="property-settings__number">
      <label className="property-settings__field">
        <span>Format de date</span>
        <select
          className="ui-native-input"
          data-size="compact"
          aria-label="Format de date"
          value={config.dateFormat}
          onChange={(event) =>
            update({ dateFormat: event.target.value as typeof config.dateFormat })
          }
        >
          {DATE_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="property-settings__field">
        <span>Format de l’heure</span>
        <select
          className="ui-native-input"
          data-size="compact"
          aria-label="Format de l’heure"
          value={config.timeFormat}
          onChange={(event) =>
            update({ timeFormat: event.target.value as typeof config.timeFormat })
          }
        >
          {TIME_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="property-settings__toggle">
        <input
          type="checkbox"
          checked={config.mode === "instant"}
          onChange={(event) => update({ mode: event.currentTarget.checked ? "instant" : "date" })}
        />
        Inclure l’heure
      </label>
      <p className="muted property-settings__note">
        Les modifications s’appliquent à toutes les vues qui affichent cette propriété.
      </p>
    </div>
  );
}

const ROLLUP_FUNCTION_LABELS: Readonly<Record<RollupFunction, string>> = {
  count: "Nombre de pages",
  count_values: "Nombre de valeurs",
  empty: "Vide",
  not_empty: "Non vide",
  unique: "Valeurs uniques",
  show_unique: "Afficher les valeurs uniques",
  percent_empty: "% vide",
  percent_not_empty: "% non vide",
  sum: "Somme",
  average: "Moyenne",
  median: "Médiane",
  min: "Minimum",
  max: "Maximum",
  range: "Étendue",
  earliest_date: "Date la plus ancienne",
  latest_date: "Date la plus récente",
  date_range: "Plage de dates (jours)",
  checked: "Coché",
  unchecked: "Non coché",
  percent_checked: "% coché",
  percent_unchecked: "% non coché",
  count_per_group: "Nombre par groupe",
  percent_per_group: "% par groupe",
  show_original: "Afficher les valeurs",
};

function UniqueIdPropertySettings({
  property,
  onChange,
}: {
  readonly property: DatabaseProperty;
  readonly onChange: (edit: (p: DatabaseProperty) => DatabaseProperty) => void;
}) {
  const [prefix, setPrefix] = useState(uniqueIdPrefixOf(property));
  const commit = (): void => {
    const next = prefix.trim().slice(0, 32);
    if (next === uniqueIdPrefixOf(property)) {
      setPrefix(next);
      return;
    }
    onChange((p) =>
      p.type === "unique-id" ? { ...p, config: next === "" ? {} : { prefix: next } } : p,
    );
  };
  return (
    <div className="property-settings__number">
      <label className="property-settings__field">
        <span>Préfixe</span>
        <input
          className="ui-native-input"
          data-size="compact"
          aria-label="Préfixe de l’identifiant"
          placeholder="Ex. TASK"
          value={prefix}
          maxLength={32}
          onChange={(event) => setPrefix(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span className="muted property-settings__note">
          Affiché {prefix.trim() === "" ? "42" : `${prefix.trim()}-42`}. Laissez vide pour le nombre
          seul.
        </span>
      </label>
      <p className="muted property-settings__note">
        Les modifications s’appliquent à toutes les vues qui affichent cette propriété.
      </p>
    </div>
  );
}

function NumberPropertySettings({
  property,
  onChange,
}: {
  readonly property: DatabaseProperty;
  readonly onChange: (edit: (p: DatabaseProperty) => DatabaseProperty) => void;
}) {
  const config = numberConfigOf(property);
  const update = (next: NumberPropertyConfig): void =>
    onChange((p) => (p.type === "number" ? { ...p, config: next } : p));
  const displays: readonly { value: NumberDisplay; label: string; sample: string }[] = [
    { value: "number", label: "Nombre", sample: "42" },
    { value: "bar", label: "Barre", sample: "▬" },
    { value: "ring", label: "Anneau", sample: "◌" },
  ];
  return (
    <div className="property-settings__number">
      <label className="property-settings__field">
        <span>Format de nombre</span>
        <select
          className="ui-native-input"
          data-size="compact"
          aria-label="Format de nombre"
          value={config.format}
          onChange={(event) =>
            update({ ...config, format: event.target.value as NumberPropertyConfig["format"] })
          }
        >
          {NUMBER_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="property-settings__field">
        <span>Décimales</span>
        <select
          className="ui-native-input"
          data-size="compact"
          aria-label="Décimales"
          value={String(config.decimals)}
          onChange={(event) => {
            const value = event.target.value;
            update({
              ...config,
              decimals: value === "default" ? "default" : (Number(value) as NumberDecimals),
            });
          }}
        >
          <option value="default">Par défaut</option>
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="property-settings__display">
        <legend>Type d’affichage</legend>
        <div className="property-settings__display-options">
          {displays.map((display) => (
            <button
              key={display.value}
              type="button"
              className="property-settings__display-option"
              aria-pressed={config.display === display.value}
              onClick={() => update({ ...config, display: display.value })}
            >
              <span className="property-settings__display-sample" aria-hidden="true">
                {display.sample}
              </span>
              <span>{display.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <p className="muted property-settings__note">
        Les modifications s’appliquent à toutes les vues qui affichent cette propriété.
      </p>
    </div>
  );
}

export function PropertyConfiguration({
  property,
  anchor,
  open,
  onClose,
  onChange,
  onOptions,
  onDuplicate,
  onRetire,
  moveDownDisabled = false,
  moveUpDisabled = false,
  onMove,
  structure = true,
  mode = "full",
  placement = "bottom-start",
  properties = [],
  previewRow,
  previewRows,
  rollupProperties = [],
}: {
  property: DatabaseProperty;
  anchor: DOMRect | null;
  open: boolean;
  onClose: () => void;
  onChange: (edit: (p: DatabaseProperty) => DatabaseProperty) => void;
  onOptions: (options: readonly PropertyOption[]) => void;
  onDuplicate: () => void;
  onRetire: () => void;
  onMove?: ((offset: -1 | 1) => void) | undefined;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
  /** Title stays a title: name and icon only. */
  structure?: boolean;
  /** `type` renders only the type-specific settings (column-menu side panel). */
  mode?: "full" | "type";
  placement?: "bottom-start" | "right-start";
  readonly properties?: readonly DatabaseProperty[];
  readonly previewRow?: DatabaseViewRow | undefined;
  readonly previewRows?: readonly DatabaseViewRow[] | undefined;
  readonly rollupProperties?:
    | readonly {
        readonly id: string;
        readonly name: string;
        readonly type: string;
      }[]
    | undefined;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const full = mode === "full";
  return (
    <ColumnPropertyMenuAppearance.Provider value={!full}>
      <PopoverRoot placement={placement} open={open} setOpen={(value) => !value && onClose()}>
        <PopoverContent
          className={
            full ? "property-settings" : "property-settings property-settings--column-menu"
          }
          aria-label={`Modifier ${property.name}`}
          getAnchorRect={() => anchor}
          initialFocus={nameInputRef}
          unmountOnHide
        >
          {full ? (
            <div className="property-settings__name">
              <PropertyIconPicker
                property={property}
                onChange={(icon) => onChange((p) => ({ ...p, icon }))}
              />
              <AutoPropertyName
                key={property.id}
                inputRef={nameInputRef}
                name={property.name}
                label="Nom de la propriété"
                onCommit={(name) => onChange((p) => ({ ...p, name }))}
              />
            </div>
          ) : null}
          {structure ? (
            <>
              {full ? (
                <MenuRoot>
                  <MenuTrigger bare className="property-settings__type">
                    <AppIcon name="settings" size="small" />
                    <span>Type</span>
                    <span className="property-settings__type-value">
                      {DATABASE_COPY.property.typeLabels[property.type]}
                    </span>
                    <AppIcon name="chevronRight" size="small" />
                  </MenuTrigger>
                  <PropertySettingsMenu
                    className="property-settings__menu"
                    unmountOnHide
                    aria-label="Type de propriété"
                  >
                    {ENTRY_PROPERTY_TYPES.map((type) => (
                      <MenuItem
                        key={type}
                        onClick={() => onChange((p) => propertyWithType(p, type))}
                      >
                        <DatabasePropertyIcon type={type} />
                        {DATABASE_COPY.property.typeLabels[type]}
                      </MenuItem>
                    ))}
                  </PropertySettingsMenu>
                </MenuRoot>
              ) : null}
              {isChoiceProperty(property) ? (
                <>
                  {full && property.type !== "status" ? (
                    <label className="property-settings__toggle">
                      <input
                        type="checkbox"
                        checked={property.type === "multi-select"}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          onChange((p) => propertyWithType(p, checked ? "multi-select" : "select"));
                        }}
                      />
                      Autoriser plusieurs options
                    </label>
                  ) : null}
                  <hr className="ui-menu__separator" />
                  {property.type === "status" ? (
                    <StatusOptionsEditor property={property} onChange={onChange} />
                  ) : (
                    <CompactPropertyOptions property={property} onChange={onOptions} />
                  )}
                </>
              ) : null}
              {property.type === "date" ? (
                <DatePropertySettings property={property} onChange={onChange} />
              ) : null}
              {property.type === "created-time" || property.type === "last-edited-time" ? (
                <AutoDatePropertySettings property={property} onChange={onChange} />
              ) : null}
              {property.type === "number" ? (
                <NumberPropertySettings property={property} onChange={onChange} />
              ) : null}
              {property.type === "unique-id" ? (
                <UniqueIdPropertySettings property={property} onChange={onChange} />
              ) : null}
              {property.type === "relation" ? (
                <label className="property-settings__toggle">
                  <input
                    type="checkbox"
                    checked={property.config.cardinality === "many"}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      onChange((p) =>
                        p.type === "relation"
                          ? { ...p, config: { cardinality: checked ? "many" : "one" } }
                          : p,
                      );
                    }}
                  />
                  Autoriser plusieurs pages
                </label>
              ) : null}
              {property.type === "rollup" ? (
                <div className="property-settings__number">
                  <label className="property-settings__field">
                    <span>{DATABASE_COPY.property.rollupRelation}</span>
                    <select
                      className="ui-native-input"
                      data-size="compact"
                      aria-label={DATABASE_COPY.property.rollupRelation}
                      value={property.config.relationPropertyId}
                      onChange={(event) => {
                        const relationPropertyId = event.currentTarget.value;
                        onChange((p) =>
                          p.type === "rollup"
                            ? {
                                ...p,
                                config: {
                                  ...p.config,
                                  relationPropertyId: relationPropertyId as Uuid,
                                },
                              }
                            : p,
                        );
                      }}
                    >
                      {properties
                        .filter(
                          (candidate) =>
                            candidate.type === "relation" && candidate.state === "active",
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="property-settings__field">
                    <span>Propriété cible</span>
                    <select
                      className="ui-native-input"
                      data-size="compact"
                      aria-label="Propriété cible"
                      value={property.config.targetPropertyId ?? ""}
                      onChange={(event) => {
                        const targetPropertyId = event.currentTarget.value;
                        onChange((p) =>
                          p.type === "rollup"
                            ? {
                                ...p,
                                config:
                                  targetPropertyId === ""
                                    ? {
                                        relationPropertyId: p.config.relationPropertyId,
                                        aggregate: p.config.aggregate,
                                      }
                                    : { ...p.config, targetPropertyId: targetPropertyId as Uuid },
                              }
                            : p,
                        );
                      }}
                    >
                      <option value="">Aucune (nombre de pages)</option>
                      {rollupProperties
                        .filter((candidate) => candidate.id !== property.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="property-settings__field">
                    <span>{"Calculer"}</span>
                    <select
                      className="ui-native-input"
                      data-size="compact"
                      aria-label={"Calculer"}
                      value={property.config.aggregate}
                      onChange={(event) => {
                        const aggregate = event.currentTarget.value as RollupFunction;
                        onChange((p) =>
                          p.type === "rollup" ? { ...p, config: { ...p.config, aggregate } } : p,
                        );
                      }}
                    >
                      {ROLLUP_FUNCTIONS.map((aggregate) => (
                        <option key={aggregate} value={aggregate}>
                          {ROLLUP_FUNCTION_LABELS[aggregate]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted property-settings__note">
                    La propriété cible appartient à la base liée. Sans cible, seul le nombre de
                    pages est disponible.
                  </p>
                </div>
              ) : null}
              {property.type === "formula" ? (
                <div className="property-settings__formula">
                  <span>{DATABASE_COPY.property.expression}</span>
                  <code className="property-settings__formula-preview">
                    {property.config.expression}
                  </code>
                  <Button
                    type="button"
                    size="compact"
                    variant="ghost"
                    className="property-settings__action"
                    onClick={() => setFormulaOpen(true)}
                  >
                    <AppIcon name="settings" size="small" />
                    Modifier la formule
                  </Button>
                  <FormulaEditor
                    property={property}
                    properties={properties}
                    previewRow={previewRow}
                    previewRows={previewRows}
                    open={formulaOpen}
                    onClose={() => setFormulaOpen(false)}
                    onSave={(expression) =>
                      onChange((p) => (p.type === "formula" ? { ...p, config: { expression } } : p))
                    }
                  />
                </div>
              ) : null}
              {full ? (
                <>
                  <hr className="ui-menu__separator" />
                  <Button
                    className="property-settings__action"
                    variant="ghost"
                    size="compact"
                    onClick={onDuplicate}
                  >
                    <AppIcon name="copy" size="small" />
                    Dupliquer la propriété
                  </Button>
                  <Button
                    className="property-settings__action property-settings__danger"
                    variant="ghost"
                    size="compact"
                    onClick={onRetire}
                  >
                    <AppIcon name="delete" size="small" />
                    Supprimer la propriété
                  </Button>
                </>
              ) : null}
            </>
          ) : null}
          {onMove === undefined ? null : (
            <>
              <hr className="ui-menu__separator" />
              <Button
                className="property-settings__action"
                variant="ghost"
                size="compact"
                disabled={moveUpDisabled}
                onClick={() => onMove(-1)}
              >
                <AppIcon name="arrowUp" size="small" />
                Déplacer vers le haut
              </Button>
              <Button
                className="property-settings__action"
                variant="ghost"
                size="compact"
                disabled={moveDownDisabled}
                onClick={() => onMove(1)}
              >
                <AppIcon name="arrowDown" size="small" />
                Déplacer vers le bas
              </Button>
            </>
          )}
        </PopoverContent>
      </PopoverRoot>
    </ColumnPropertyMenuAppearance.Provider>
  );
}
