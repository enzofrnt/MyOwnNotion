import {
  type DatabaseDefinition,
  type DatabaseProperty,
  type DatabasePropertyType,
  generateUuidV7,
  type PropertyOption,
  type Uuid,
} from "@myownnotion/domain";
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import {
  Button,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  PopoverContent,
  PopoverRoot,
} from "../../ui/primitives/index.ts";
import { DATABASE_COPY } from "./database-copy.ts";
import {
  isChoiceProperty,
  nextOptionTone,
  OPTION_TONE_LABELS,
  OPTION_TONES,
  OptionPill,
  optionTone,
} from "./option-appearance.tsx";
import { DatabasePropertyIcon, PropertyIconPicker } from "./property-icon.tsx";

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
              color: `var(--ui-content-${tone})`,
              backgroundColor: `var(--ui-content-${tone}-soft)`,
              borderColor: `var(--ui-content-${tone})`,
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
          <MenuContent className="property-settings__menu" unmountOnHide>
            <PropertyOptionSettings
              option={option}
              onChange={(change) => patch(option.id, change)}
              onRetire={() => patch(option.id, { state: "retired" })}
            />
          </MenuContent>
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
  if (type === "date") return { ...base, type, config: { mode: "date" } };
  if (type === "relation") return { ...base, type, config: { cardinality: "many" } };
  if (type === "select" || type === "multi-select" || type === "status")
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
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  return (
    <PopoverRoot placement="bottom-start" open={open} setOpen={(value) => !value && onClose()}>
      <PopoverContent
        className="property-settings"
        aria-label={`Modifier ${property.name}`}
        getAnchorRect={() => anchor}
        initialFocus={nameInputRef}
        unmountOnHide
      >
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
        {structure ? (
          <>
            <MenuRoot>
              <MenuTrigger bare className="property-settings__type">
                <AppIcon name="settings" size="small" />
                <span>Type</span>
                <span className="property-settings__type-value">
                  {DATABASE_COPY.property.typeLabels[property.type]}
                </span>
                <AppIcon name="chevronRight" size="small" />
              </MenuTrigger>
              <MenuContent
                className="property-settings__menu"
                unmountOnHide
                aria-label="Type de propriété"
              >
                {ENTRY_PROPERTY_TYPES.map((type) => (
                  <MenuItem key={type} onClick={() => onChange((p) => propertyWithType(p, type))}>
                    <DatabasePropertyIcon type={type} />
                    {DATABASE_COPY.property.typeLabels[type]}
                  </MenuItem>
                ))}
              </MenuContent>
            </MenuRoot>
            {isChoiceProperty(property) ? (
              <>
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
                <hr className="ui-menu__separator" />
                <CompactPropertyOptions property={property} onChange={onOptions} />
              </>
            ) : null}
            {property.type === "date" ? (
              <label className="property-settings__toggle">
                <input
                  type="checkbox"
                  checked={property.config.mode === "instant"}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    onChange((p) =>
                      p.type === "date"
                        ? { ...p, config: { mode: checked ? "instant" : "date" } }
                        : p,
                    );
                  }}
                />
                Inclure l’heure
              </label>
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
  );
}
