import type { DatabaseProperty, DatabaseView, DefinitionImpact, Uuid } from "@myownnotion/domain";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AppIcon, type AppIconName } from "../../ui/icons.tsx";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogHeading,
  DialogRoot,
  InputSurface,
  NativeInput,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../ui/primitives/index.ts";
import { DATABASE_COPY } from "./database-copy.ts";
import { DatabaseIconPicker } from "./database-icon-picker.tsx";
import { EntrySchemaImpact } from "./edit-entry-properties.ts";
import { FilterEditor } from "./filter-editor.tsx";
import { PropertyConfiguration } from "./property-configuration.tsx";
import {
  type DatabasePropertyDraft,
  PropertyEditor,
  validatePropertyDraft,
} from "./property-editor.tsx";
import { DatabasePropertyIcon } from "./property-icon.tsx";
import { PropertyVisibilitySwitch } from "./property-visibility-switch.tsx";
import { SortGroupEditor } from "./sort-group-editor.tsx";
import { moveViewColumn, viewColumns } from "./view-columns.ts";
import { ViewMark } from "./view-icon.tsx";
import { isAutomaticViewName, VIEW_TYPE_ICON, VIEW_TYPE_LABEL } from "./view-tab-names.ts";

const VIEW_TYPE_CHOICES = ["table", "board", "gallery", "list", "calendar"] as const;
const SOURCE_PAGE_SIZE = 5;

export type ViewSettingsScreen =
  | "root"
  | "layout"
  | "visibility"
  | "filter"
  | "sort"
  | "source"
  | "manage"
  | "properties";

export interface ViewSettingsSource {
  readonly sourceId: Uuid;
  readonly name: string;
  readonly ownedHere: boolean;
  readonly viewCount: number;
}

const EMPTY_PROPERTY_DRAFT: DatabasePropertyDraft = { name: "", type: "text" };

const SCREEN_TITLE: Record<ViewSettingsScreen, string> = {
  root: "Afficher les paramètres",
  layout: "Disposition",
  visibility: "Visibilité des propriétés",
  filter: "Filtrer",
  sort: "Trier",
  source: "Source",
  manage: "Sources de données",
  properties: "Propriétés",
};

function resizeSourceTitle(field: HTMLTextAreaElement): void {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

/** Secondary source title under the page name. Owned sources edit in place. */
export function CurrentSourceTitle({
  editable,
  name,
  onCommit,
}: {
  readonly name: string;
  readonly editable: boolean;
  readonly onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const focused = useRef(false);
  const cancelled = useRef(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!focused.current) setDraft(name);
  }, [name]);
  useEffect(() => {
    const node = field.current;
    if (node === null || !editable) return;
    node.rows = Math.max(1, draft.split("\n").length);
    resizeSourceTitle(node);
  }, [draft, editable]);
  if (!editable) {
    return (
      <p className="database-container-page__current-source" data-testid="current-source-title">
        <AppIcon name="reference" size="small" />
        <span>{name}</span>
      </p>
    );
  }
  return (
    <textarea
      ref={field}
      className="database-container-page__current-source database-container-page__current-source--editable"
      data-testid="current-source-title"
      aria-label="Titre de la source"
      rows={1}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        resizeSourceTitle(event.currentTarget);
      }}
      onBlur={() => {
        focused.current = false;
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(name);
          return;
        }
        const next = draft.trim();
        if (next === "" || next === name) {
          setDraft(name);
          return;
        }
        onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          focused.current = false;
          setDraft(name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function SettingsRow({
  aside,
  icon,
  label,
  onClick,
}: {
  readonly icon: AppIconName;
  readonly label: string;
  readonly aside?: string | undefined;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="database-view-settings__row" onClick={onClick}>
      <AppIcon name={icon} size="small" />
      <span className="database-view-settings__row-label">{label}</span>
      {aside === undefined || aside === "" ? null : (
        <span className="database-view-settings__aside">{aside}</span>
      )}
      <AppIcon className="database-view-settings__chevron" name="chevronRight" size="small" />
    </button>
  );
}

/**
 * Side panel for one view. Source and properties are screens of this panel,
 * opened directly from the view menu when the owner asks for them.
 */
function motionDurationMs(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-duration-normal")
    .trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 180;
  return raw.endsWith("ms") ? value : value * 1000;
}

export function ViewSettingsPanel({
  boardAvailable,
  calendarAvailable,
  closing = false,
  creatingSource,
  currentSourceId,
  defaultName,
  filterCount,
  focusName = false,
  name,
  onChangeFormat,
  onChangeSource,
  onChangeView,
  onClose,
  onCommitIcon,
  onCommitName,
  onExited,
  onNameFocusHandled,
  onCreateProperty,
  onCreateSource,
  onDuplicateProperty,
  onEditProperty,
  onRevealOwnedSource,
  onScreen,
  onToggleProperty,
  properties,
  revealOwnedSource,
  screen,
  sortCount,
  sourceLocked,
  sources,
  type,
  view,
}: {
  readonly screen: ViewSettingsScreen;
  readonly name: string;
  readonly defaultName: string;
  readonly focusName?: boolean;
  readonly onNameFocusHandled: () => void;
  readonly type: DatabaseView["type"];
  readonly view: DatabaseView;
  readonly properties: readonly DatabaseProperty[];
  readonly sources: readonly ViewSettingsSource[];
  readonly currentSourceId: Uuid;
  readonly sourceLocked: boolean;
  readonly boardAvailable: boolean;
  readonly calendarAvailable: boolean;
  readonly revealOwnedSource: boolean;
  readonly creatingSource: boolean;
  readonly filterCount: number;
  readonly sortCount: number;
  readonly onScreen: (screen: ViewSettingsScreen) => void;
  readonly onClose: () => void;
  readonly closing?: boolean;
  readonly onExited: () => void;
  readonly onCommitName: (name: string) => void;
  readonly onCommitIcon: (icon: string | null) => void;
  readonly onChangeFormat: (type: DatabaseView["type"]) => void;
  readonly onChangeView: (view: DatabaseView) => void;
  readonly onToggleProperty: (propertyId: Uuid, visible: boolean) => void;
  readonly onChangeSource: (sourceId: Uuid) => void;
  readonly onCreateSource: () => void;
  readonly onRevealOwnedSource: () => void;
  readonly onCreateProperty: (draft: DatabasePropertyDraft) => Promise<void>;
  readonly onEditProperty: (
    propertyId: Uuid,
    edit: (property: DatabaseProperty) => DatabaseProperty,
    confirmed?: boolean,
  ) => Promise<void>;
  readonly onDuplicateProperty: (propertyId: Uuid) => Promise<void>;
}) {
  const titleId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState(() => (isAutomaticViewName(name) ? "" : name));
  const nameFocused = useRef(false);
  const nameCancelled = useRef(false);
  const nameAtPointer = useRef<string | null>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [propertyQuery, setPropertyQuery] = useState("");
  const [iconQuery, setIconQuery] = useState("");
  const [creatingProperty, setCreatingProperty] = useState(false);
  const [propertyDraft, setPropertyDraft] = useState<DatabasePropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [propertyEditor, setPropertyEditor] = useState<{ id: Uuid; anchor: DOMRect } | null>(null);
  const [pendingImpact, setPendingImpact] = useState<{
    id: Uuid;
    edit: (property: DatabaseProperty) => DatabaseProperty;
    impact: DefinitionImpact;
  } | null>(null);
  const cancelImpactRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [frame, setFrame] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const stage = asideRef.current?.closest(".database-container-page__stage");
    if (!(stage instanceof HTMLElement)) return;
    const measure = (): void => {
      const rect = stage.getBoundingClientRect();
      const raw = getComputedStyle(stage).getPropertyValue("--database-settings-width");
      const width = Number.parseFloat(raw);
      const column = Number.isFinite(width) ? width : 290;
      const next = { top: rect.top, left: Math.max(0, rect.right - column) };
      setFrame((current) =>
        current !== null && current.top === next.top && current.left === next.left ? current : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const main = stage.closest("#workspace-main");
    if (main instanceof HTMLElement) observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (!nameFocused.current) setNameDraft(isAutomaticViewName(name) ? "" : name);
  }, [name]);
  useEffect(() => {
    if (!closing) return;
    const node = asideRef.current;
    if (node === null) {
      onExited();
      return;
    }
    const ms = motionDurationMs();
    if (ms === 0) {
      onExited();
      return;
    }
    const easing =
      getComputedStyle(document.documentElement).getPropertyValue("--ui-ease-standard").trim() ||
      "ease";
    const animation = node.animate(
      [
        { opacity: 1, transform: "translateX(0)" },
        { opacity: 0, transform: "translateX(1.25rem)" },
      ],
      { duration: ms, easing, fill: "forwards" },
    );
    const timer = window.setTimeout(onExited, ms + 40);
    animation.addEventListener("finish", onExited);
    return () => {
      window.clearTimeout(timer);
      animation.removeEventListener("finish", onExited);
      if (animation.playState !== "finished") animation.cancel();
    };
  }, [closing, onExited]);
  useLayoutEffect(() => {
    if (!focusName || frame === null) return;
    const input = nameInputRef.current;
    if (input === null) return;
    input.focus();
    if (input.value !== "") input.select();
    onNameFocusHandled();
  }, [focusName, frame, onNameFocusHandled]);
  useEffect(() => {
    if (screen !== "properties") {
      setCreatingProperty(false);
      setPropertyEditor(null);
    }
    if (screen !== "source") setSourcesExpanded(false);
  }, [screen]);
  const columns = viewColumns(properties, view.properties);
  const visibleCount = columns.filter((column) => column.visible).length;
  const activeProperties = properties.filter((property) => property.state === "active");
  const query = propertyQuery.trim().toLocaleLowerCase();
  const listedProperties = activeProperties.filter((property) =>
    query === "" ? true : property.name.toLocaleLowerCase().includes(query),
  );
  const ownedSources = sources.filter((source) => source.ownedHere);
  const otherSources = sources.filter((source) => !source.ownedHere);
  const hiddenOthers = sourcesExpanded ? 0 : Math.max(0, otherSources.length - SOURCE_PAGE_SIZE);
  const visibleOthers = sourcesExpanded ? otherSources : otherSources.slice(0, SOURCE_PAGE_SIZE);
  const editProperty = (
    propertyId: Uuid,
    edit: (property: DatabaseProperty) => DatabaseProperty,
    confirmed = false,
  ): void => {
    void onEditProperty(propertyId, edit, confirmed).catch((cause: unknown) => {
      if (cause instanceof EntrySchemaImpact) {
        setPendingImpact({ id: propertyId, edit, impact: cause.impact });
        return;
      }
      setPropertyError(
        cause instanceof Error ? cause.message : "La propriété n’a pas pu être modifiée.",
      );
    });
  };
  const editedProperty =
    propertyEditor === null
      ? undefined
      : activeProperties.find((property) => property.id === propertyEditor.id);
  return (
    <aside
      ref={asideRef}
      className="database-view-settings"
      aria-labelledby={titleId}
      data-testid="view-settings"
      data-placed={frame === null ? "false" : "true"}
      data-closing={closing ? "true" : "false"}
      {...(frame === null ? {} : { style: { top: frame.top, left: frame.left } })}
    >
      <div
        className="database-view-settings__sheet"
        onMouseDownCapture={(event) => {
          const input = nameInputRef.current;
          if (input === null || document.activeElement !== input || event.target === input) return;
          nameAtPointer.current = input.value;
        }}
      >
        <header className="database-view-settings__header">
          {screen === "root" ? null : (
            <button
              type="button"
              className="database-view-settings__icon-button"
              aria-label="Retour"
              onClick={() => onScreen("root")}
            >
              <AppIcon name="arrowLeft" size="small" />
            </button>
          )}
          <h2 id={titleId} className="database-view-settings__title">
            {SCREEN_TITLE[screen]}
          </h2>
          <button
            type="button"
            className="database-view-settings__icon-button"
            aria-label="Fermer"
            onClick={onClose}
          >
            <AppIcon name="close" size="small" />
          </button>
        </header>
        {screen === "root" ? (
          <div className="database-view-settings__body">
            <div className="database-view-settings__name">
              <PopoverRoot>
                <PopoverTrigger
                  className="database-view-settings__name-icon"
                  aria-label="Modifier l’icône"
                >
                  <ViewMark icon={view.icon} type={type} />
                </PopoverTrigger>
                <PopoverContent className="database-view-icon-picker" aria-label="Icône de la vue">
                  <DatabaseIconPicker
                    current={view.icon ?? null}
                    query={iconQuery}
                    onQuery={setIconQuery}
                    onSelect={(icon) => {
                      setIconQuery("");
                      onCommitIcon(icon);
                    }}
                  />
                </PopoverContent>
              </PopoverRoot>
              <input
                ref={nameInputRef}
                aria-label={DATABASE_COPY.toolbar.viewName}
                placeholder={defaultName}
                value={nameDraft}
                onFocus={() => {
                  nameFocused.current = true;
                }}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={(event) => {
                  nameFocused.current = false;
                  const seen = nameAtPointer.current ?? event.currentTarget.value;
                  nameAtPointer.current = null;
                  if (nameCancelled.current) {
                    nameCancelled.current = false;
                    setNameDraft(isAutomaticViewName(name) ? "" : name);
                    return;
                  }
                  const next = seen.trim();
                  if (next === "") {
                    setNameDraft("");
                    if (!isAutomaticViewName(name)) onCommitName(defaultName);
                    return;
                  }
                  if (next === name) {
                    setNameDraft(isAutomaticViewName(name) ? "" : name);
                    return;
                  }
                  onCommitName(next);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    nameCancelled.current = true;
                    nameFocused.current = false;
                    setNameDraft(isAutomaticViewName(name) ? "" : name);
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
            <hr className="database-view-settings__rule" />
            <SettingsRow
              icon={VIEW_TYPE_ICON[type]}
              label="Disposition"
              aside={VIEW_TYPE_LABEL[type]}
              onClick={() => onScreen("layout")}
            />
            <SettingsRow
              icon="list"
              label="Visibilité des propriétés"
              aside={String(visibleCount)}
              onClick={() => onScreen("visibility")}
            />
            <SettingsRow
              icon="filter"
              label="Filtrer"
              aside={filterCount > 0 ? String(filterCount) : undefined}
              onClick={() => onScreen("filter")}
            />
            <SettingsRow
              icon="arrowDown"
              label="Trier"
              aside={sortCount > 0 ? String(sortCount) : undefined}
              onClick={() => onScreen("sort")}
            />
            <hr className="database-view-settings__rule" />
            <p className="database-view-settings__section">Paramètres de la source de données</p>
            <SettingsRow
              icon="layers"
              label="Source"
              aside={sources.find((source) => source.sourceId === currentSourceId)?.name}
              onClick={() => onScreen("source")}
            />
            <SettingsRow
              icon="list"
              label="Modifier les propriétés"
              aside={String(activeProperties.length)}
              onClick={() => onScreen("properties")}
            />
            <hr className="database-view-settings__rule" />
            <div className="database-view-settings__footer">
              <SettingsRow
                icon="layers"
                label="Gérer les sources de données"
                onClick={() => onScreen("manage")}
              />
            </div>
          </div>
        ) : null}
        {screen === "layout" ? (
          <div className="database-view-settings__body" role="listbox" aria-label="Disposition">
            {VIEW_TYPE_CHOICES.map((choice) => {
              const unavailable =
                (choice === "board" && !boardAvailable) ||
                (choice === "calendar" && !calendarAvailable);
              const reason =
                choice === "board"
                  ? DATABASE_COPY.toolbar.boardNeedsProperty
                  : DATABASE_COPY.toolbar.calendarNeedsProperty;
              return (
                <button
                  key={choice}
                  type="button"
                  className="database-view-settings__choice"
                  role="option"
                  aria-selected={choice === type}
                  disabled={unavailable}
                  title={unavailable ? reason : undefined}
                  onClick={() => onChangeFormat(choice)}
                >
                  <AppIcon name={VIEW_TYPE_ICON[choice]} size="small" />
                  <span className="database-view-settings__choice-label">
                    {VIEW_TYPE_LABEL[choice]}
                  </span>
                  {choice === type ? <AppIcon name="check" size="small" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {screen === "visibility" ? (
          <ul className="database-view-settings__body database-view-settings__list">
            {columns.map((column, index) => (
              <li key={column.property.id} className="database-view-settings__switch-row">
                <span className="database-view-settings__switch-copy">
                  {column.property.name}
                  <span className="database-view-settings__meta">
                    {DATABASE_COPY.property.typeLabels[column.property.type]}
                  </span>
                </span>
                <PropertyVisibilitySwitch
                  property={column.property}
                  visible={column.visible}
                  onToggle={onToggleProperty}
                />
                {([-1, 1] as const).map((offset) => (
                  <Button
                    key={offset}
                    size="square"
                    variant="ghost"
                    disabled={offset === -1 ? index === 0 : index === columns.length - 1}
                    aria-label={
                      offset === -1
                        ? DATABASE_COPY.toolbar.moveColumnEarlier(column.property.name)
                        : DATABASE_COPY.toolbar.moveColumnLater(column.property.name)
                    }
                    onClick={() => {
                      const properties = moveViewColumn(
                        activeProperties,
                        view.properties,
                        column.property.id,
                        offset,
                      );
                      if (properties !== null) onChangeView({ ...view, properties });
                    }}
                  >
                    <AppIcon name={offset === -1 ? "arrowLeft" : "chevronRight"} size="small" />
                  </Button>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
        {screen === "filter" ? (
          <div className="database-view-settings__body">
            <FilterEditor properties={properties} view={view} onChange={onChangeView} />
          </div>
        ) : null}
        {screen === "sort" ? (
          <div className="database-view-settings__body">
            <SortGroupEditor properties={properties} view={view} onChange={onChangeView} />
          </div>
        ) : null}
        {screen === "manage" ? (
          <div className="database-view-settings__body">
            {ownedSources.length === 0 ? (
              <p className="database-view-settings__hint">Cette page n’a pas encore de source.</p>
            ) : (
              <section aria-label="Sources de cette page">
                {ownedSources.map((source) => (
                  <SourceChoice
                    key={source.sourceId}
                    current={source.sourceId === currentSourceId}
                    disabled={sourceLocked && source.sourceId !== currentSourceId}
                    name={source.name}
                    viewCount={source.viewCount}
                    onSelect={() => onChangeSource(source.sourceId)}
                  />
                ))}
              </section>
            )}
            <button
              type="button"
              className="database-view-settings__row"
              disabled={creatingSource}
              onClick={onCreateSource}
            >
              <AppIcon name="add" size="small" />
              <span className="database-view-settings__row-label">
                Ajouter une source de données
              </span>
            </button>
          </div>
        ) : null}
        {screen === "source" ? (
          <div className="database-view-settings__body">
            {sourceLocked ? (
              <p className="database-view-settings__hint">
                Ajoutez une deuxième vue pour changer sa source.
              </p>
            ) : null}
            {ownedSources.length === 0 ? null : (
              <section aria-label="Sources de cette page">
                <p className="database-view-settings__section">Sources de cette page</p>
                {ownedSources.map((source) => (
                  <SourceChoice
                    key={source.sourceId}
                    current={source.sourceId === currentSourceId}
                    disabled={sourceLocked && source.sourceId !== currentSourceId}
                    name={source.name}
                    viewCount={source.viewCount}
                    onSelect={() => onChangeSource(source.sourceId)}
                  />
                ))}
              </section>
            )}
            {visibleOthers.length === 0 ? null : (
              <section aria-label="Liées">
                <p className="database-view-settings__section">Liées</p>
                {visibleOthers.map((source) => (
                  <SourceChoice
                    key={source.sourceId}
                    current={source.sourceId === currentSourceId}
                    disabled={sourceLocked && source.sourceId !== currentSourceId}
                    name={source.name}
                    viewCount={source.viewCount}
                    onSelect={() => onChangeSource(source.sourceId)}
                  />
                ))}
              </section>
            )}
            {hiddenOthers > 0 ? (
              <button
                type="button"
                className="database-view-settings__more"
                onClick={() => setSourcesExpanded(true)}
              >
                Afficher {hiddenOthers} de plus
              </button>
            ) : null}
            {revealOwnedSource ? (
              <button
                type="button"
                className="database-view-settings__more"
                onClick={onRevealOwnedSource}
              >
                Retrouver la source d’origine
              </button>
            ) : null}
            <button
              type="button"
              className="database-view-settings__row"
              disabled={creatingSource}
              onClick={onCreateSource}
            >
              <AppIcon name="add" size="small" />
              <span className="database-view-settings__row-label">
                Ajouter une source de données
              </span>
            </button>
          </div>
        ) : null}
        {screen === "properties" ? (
          <div className="database-view-settings__body">
            <InputSurface className="database-view-settings__search" density="compact">
              <AppIcon name="search" size="small" />
              <NativeInput
                aria-label="Rechercher une propriété"
                placeholder="Rechercher une propriété…"
                value={propertyQuery}
                onChange={(event) => setPropertyQuery(event.target.value)}
              />
            </InputSurface>
            <ul className="database-view-settings__list">
              {listedProperties.map((property) => (
                <li key={property.id} className="database-view-settings__property-row">
                  <button
                    type="button"
                    className="database-view-settings__row"
                    aria-haspopup="dialog"
                    aria-expanded={propertyEditor?.id === property.id}
                    aria-label={`Modifier la propriété ${property.name}`}
                    onClick={(event) => {
                      setPropertyError(null);
                      setPropertyEditor({
                        id: property.id,
                        anchor: event.currentTarget.getBoundingClientRect(),
                      });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setPropertyError(null);
                      setPropertyEditor({
                        id: property.id,
                        anchor: DOMRect.fromRect({
                          x: event.clientX,
                          y: event.clientY,
                          width: 0,
                          height: 0,
                        }),
                      });
                    }}
                  >
                    <DatabasePropertyIcon type={property.type} icon={property.icon} />
                    <span className="database-view-settings__row-label">{property.name}</span>
                    <span className="database-view-settings__aside">
                      {DATABASE_COPY.property.typeLabels[property.type]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {editedProperty === undefined || propertyEditor === null ? null : (
              <PropertyConfiguration
                property={editedProperty}
                anchor={propertyEditor.anchor}
                open
                structure={editedProperty.type !== "title"}
                onClose={() => setPropertyEditor(null)}
                onChange={(edit) => editProperty(editedProperty.id, edit)}
                onOptions={(options) =>
                  editProperty(editedProperty.id, (current) =>
                    current.type === "select" ||
                    current.type === "multi-select" ||
                    current.type === "status"
                      ? { ...current, config: { ...current.config, options: [...options] } }
                      : current,
                  )
                }
                onDuplicate={() => {
                  setPropertyEditor(null);
                  void onDuplicateProperty(editedProperty.id).catch((cause: unknown) => {
                    setPropertyError(
                      cause instanceof Error
                        ? cause.message
                        : "La propriété n’a pas pu être dupliquée.",
                    );
                  });
                }}
                onRetire={() => {
                  const id = editedProperty.id;
                  setPropertyEditor(null);
                  editProperty(id, (current) => ({ ...current, state: "retired" }));
                }}
              />
            )}
            {!creatingProperty && propertyError !== null ? (
              <p className="database-view-settings__hint" role="alert">
                {propertyError}
              </p>
            ) : null}
            {creatingProperty ? (
              <PropertyEditor
                draft={propertyDraft}
                error={propertyError}
                submitting={savingProperty}
                onChange={(draft) => {
                  setPropertyDraft(draft);
                  setPropertyError(null);
                }}
                onCancel={() => {
                  setCreatingProperty(false);
                  setPropertyDraft(EMPTY_PROPERTY_DRAFT);
                  setPropertyError(null);
                }}
                onSubmit={(submitted) => {
                  const result = validatePropertyDraft(submitted);
                  if (!result.ok) {
                    setPropertyDraft(submitted);
                    setPropertyError(result.error);
                    return;
                  }
                  setSavingProperty(true);
                  void onCreateProperty(submitted)
                    .then(() => {
                      setCreatingProperty(false);
                      setPropertyDraft(EMPTY_PROPERTY_DRAFT);
                      setPropertyError(null);
                    })
                    .catch((cause: unknown) => {
                      setPropertyError(
                        cause instanceof Error
                          ? cause.message
                          : DATABASE_COPY.page.propertySaveFailed,
                      );
                    })
                    .finally(() => setSavingProperty(false));
                }}
              />
            ) : (
              <button
                type="button"
                className="database-view-settings__row"
                onClick={() => {
                  setPropertyError(null);
                  setCreatingProperty(true);
                }}
              >
                <AppIcon name="add" size="small" />
                <span className="database-view-settings__row-label">Nouvelle propriété</span>
              </button>
            )}
          </div>
        ) : null}
      </div>
      <DialogRoot
        open={pendingImpact !== null}
        setOpen={(open) => {
          if (!open) setPendingImpact(null);
        }}
      >
        <DialogContent size="small" initialFocus={cancelImpactRef} unmountOnHide>
          <DialogHeading className="entry-property-impact__heading">
            Modifier cette propriété ?
          </DialogHeading>
          <DialogDescription>
            {pendingImpact === null
              ? null
              : DATABASE_COPY.page.impact(
                  pendingImpact.impact.affectedValueCount,
                  pendingImpact.impact.affectedEntryCount,
                )}{" "}
            Les valeurs incompatibles seront conservées pour récupération.
          </DialogDescription>
          <div className="ui-dialog__actions">
            <Button
              variant="danger"
              onClick={() => {
                const pending = pendingImpact;
                setPendingImpact(null);
                if (pending !== null) editProperty(pending.id, pending.edit, true);
              }}
            >
              Confirmer la modification
            </Button>
            <Button ref={cancelImpactRef} variant="ghost" onClick={() => setPendingImpact(null)}>
              Annuler
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </aside>
  );
}

function SourceChoice({
  current,
  disabled,
  name,
  onSelect,
  viewCount,
}: {
  readonly name: string;
  readonly viewCount: number;
  readonly current: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="database-view-settings__choice"
      aria-current={current ? "true" : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      <AppIcon name="layers" size="small" />
      <span className="database-view-settings__choice-label">{name}</span>
      <span className="database-view-settings__aside">
        {viewCount === 1 ? "1 vue" : `${viewCount} vues`}
      </span>
      {current ? <AppIcon name="check" size="small" /> : null}
    </button>
  );
}
