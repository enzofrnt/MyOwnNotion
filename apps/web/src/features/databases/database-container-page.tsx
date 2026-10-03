import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LocalDatabaseRow } from "@myownnotion/client-core";
import {
  type DatabasePresentationDefinition,
  type DatabaseProperty,
  type DatabaseView,
  databasePageTitleMode,
  generateUuidV7,
  keyAfterAll,
  ownedSourceIdFromItemId,
  type Uuid,
  viewDeletionOffer,
} from "@myownnotion/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { AppIcon } from "../../ui/icons.tsx";
import {
  Button,
  DialogContent,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  MenuContent,
  MenuItem,
  MenuRoot,
  PopoverContent,
  PopoverHeading,
  PopoverRoot,
  PopoverTrigger,
} from "../../ui/primitives/index.ts";
import { DatabaseViewSurface } from "../editor/custom-blocks/database-view.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { createSavedView } from "./database-toolbar.tsx";
import { definitionViewsPreservingPresentation } from "./definition-view-merge.ts";
import { editEntrySourceDefinition } from "./edit-entry-properties.ts";
import { duplicateEntryProperty } from "./entry-property-list.tsx";
import { updateEntryProperty } from "./property-configuration.tsx";
import { propertyFromDraft, validatePropertyDraft } from "./property-editor.tsx";
import { ViewMark } from "./view-icon.tsx";
import {
  CurrentSourceTitle,
  ViewSettingsPanel,
  type ViewSettingsScreen,
} from "./view-settings-panel.tsx";
import {
  duplicateChosenViewName,
  fallbackViewName,
  isAutomaticViewName,
  isStackedViewName,
  nextAutomaticViewName,
  repairAutomaticViewNames,
  VIEW_TYPE_ICON,
  VIEW_TYPE_LABEL,
} from "./view-tab-names.ts";

const VIEW_TYPE_CHOICES = ["table", "board", "gallery", "list", "calendar"] as const;

interface Snapshot {
  readonly container: LocalDatabaseRow;
  readonly sources: readonly LocalDatabaseRow[];
}

/** Keep a dragged view on the bar: flush with its sides, never under the page edge. */
const restrictViewsToTabBar: Modifier = ({ activeNodeRect, draggingNodeRect, transform }) => {
  const next = { ...transform, y: 0 };
  const nav = document.querySelector(".database-container-page__tabs");
  const rect = draggingNodeRect ?? activeNodeRect;
  if (nav === null || rect === null) return next;
  const bounds = nav.getBoundingClientRect();
  if (rect.left + next.x < bounds.left) next.x = bounds.left - rect.left;
  else if (rect.right + next.x > bounds.right) next.x = bounds.right - rect.right;
  return next;
};

function SortableDatabaseViewTab({
  current,
  draggable = true,
  icon,
  id,
  name,
  onOpenMenu,
  onRenameCancel,
  onRenameCommit,
  onRenameDraft,
  onSelect,
  renaming,
  renameDraft,
  type,
}: {
  readonly id: Uuid;
  readonly name: string;
  readonly type: DatabaseView["type"];
  readonly icon?: string | null | undefined;
  readonly current: boolean;
  readonly draggable?: boolean;
  readonly renaming: boolean;
  readonly renameDraft: string;
  readonly onRenameDraft: (value: string) => void;
  readonly onOpenMenu: (id: Uuid, x: number, y: number) => void;
  readonly onRenameCommit: (id: Uuid) => void;
  readonly onRenameCancel: () => void;
  readonly onSelect: (id: Uuid) => void;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id,
    disabled: renaming || !draggable,
    // A drop must not replay a corrective slide. The tabs are already sitting
    // in their new places when the pointer lifts.
    animateLayoutChanges: () => false,
  });
  // Drop the vertical and scale parts. Width changes are already expressed by
  // the horizontal shift, and a scale makes every tab pop when the pointer lifts.
  const horizontalTransform =
    transform === null ? null : { ...transform, y: 0, scaleX: 1, scaleY: 1 };
  const { onKeyDown: sortableKeyDown, ...dragListeners } = listeners ?? {};
  return (
    <button
      ref={setNodeRef}
      type="button"
      className="database-container-page__tab"
      aria-current={current ? "page" : undefined}
      data-dragging={isDragging || undefined}
      data-renaming={renaming || undefined}
      style={{ transform: CSS.Transform.toString(horizontalTransform), transition }}
      onClick={() => {
        if (!renaming) onSelect(id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (renaming) return;
        onOpenMenu(id, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (renaming) return;
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(id, rect.left, rect.bottom);
          return;
        }
        sortableKeyDown?.(event);
      }}
      {...attributes}
      {...dragListeners}
    >
      <ViewMark icon={icon} type={type} />
      {renaming ? (
        <input
          className="database-container-page__tab-name"
          aria-label={DATABASE_COPY.toolbar.viewName}
          value={renameDraft}
          // biome-ignore lint/a11y/noAutofocus: Renommer just asked to edit this name
          autoFocus
          onChange={(event) => onRenameDraft(event.currentTarget.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key !== "Enter" && event.key !== "Escape") return;
            event.preventDefault();
            if (event.key === "Escape") onRenameCancel();
            else onRenameCommit(id);
          }}
          onBlur={() => onRenameCommit(id)}
        />
      ) : (
        name
      )}
    </button>
  );
}

function RetireOwnedSourceDialog({
  sourceName,
  choice,
  onChoice,
  onCancel,
  onConfirm,
}: {
  readonly sourceName: string;
  readonly choice: "view" | "source";
  readonly onChoice: (choice: "view" | "source") => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const confirmLabel =
    choice === "source"
      ? "Supprimer la vue et la source de données"
      : "Supprimer la vue uniquement";
  return (
    <DialogRoot open setOpen={(open) => !open && onCancel()}>
      <DialogContent className="database-retire-choice" data-testid="retire-owned-source-view">
        <DialogDismiss />
        <div className="database-retire-choice__glyph" aria-hidden="true">
          <AppIcon name="delete" size="large" />
        </div>
        <DialogHeading>Supprimer la dernière vue pour {sourceName} ?</DialogHeading>
        <div className="database-retire-choice__options" role="radiogroup" aria-label="Conséquence">
          <RetireChoiceOption
            name="database-retire-choice"
            checked={choice === "view"}
            onSelect={() => onChoice("view")}
            title="Supprimer la vue uniquement"
            detail={`La source de données ${sourceName} et toutes ses pages seront conservées dans cette base de données`}
          />
          <RetireChoiceOption
            name="database-retire-choice"
            checked={choice === "source"}
            onSelect={() => onChoice("source")}
            title="Supprimer la vue et la source de données"
            detail={`La source de données ${sourceName} et toutes ses pages seront supprimées`}
          />
        </div>
        <div className="database-retire-choice__actions">
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function RetireChoiceOption({
  checked,
  detail,
  name,
  onSelect,
  title,
}: {
  readonly checked: boolean;
  readonly detail: string;
  readonly name: string;
  readonly onSelect: () => void;
  readonly title: string;
}) {
  return (
    <label className="database-retire-choice__option" data-checked={checked ? "true" : "false"}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} />
      <span className="database-retire-choice__copy">
        <span className="database-retire-choice__option-title">{title}</span>
        <span className="database-retire-choice__option-detail">{detail}</span>
      </span>
      <span className="database-retire-choice__radio" aria-hidden="true" />
    </label>
  );
}

/** A hierarchy item hosts views; its owned source survives even when every tab points elsewhere. */
export function DatabaseContainerPage({
  containerItemId,
  service,
  onOpenEntry,
  returnFocusEntryId,
  onReturnFocusRestored,
  linked = false,
}: {
  readonly containerItemId: Uuid;
  readonly service: LocalContentService;
  readonly onOpenEntry: (itemId: Uuid) => void;
  readonly returnFocusEntryId?: Uuid | null;
  readonly onReturnFocusRestored?: () => void;
  readonly linked?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<Uuid | null>(null);
  const [renamingViewId, setRenamingViewId] = useState<Uuid | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameClosed = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [addViewOpen, setAddViewOpen] = useState(false);
  const [retireChoiceOpen, setRetireChoiceOpen] = useState(false);
  const [retireChoice, setRetireChoice] = useState<"view" | "source">("source");
  const [viewMenu, setViewMenu] = useState<{ viewId: Uuid; x: number; y: number } | null>(null);
  const [settingsScreen, setSettingsScreen] = useState<ViewSettingsScreen | null>(null);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const settingsClosingRef = useRef(false);
  const [focusViewName, setFocusViewName] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const retireTargetId = useRef<Uuid | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const skipSelectAfterDrag = useRef(false);
  const [pendingOrder, setPendingOrder] = useState<readonly Uuid[] | null>(null);
  const refresh = useCallback(async () => {
    const [container, sources] = await Promise.all([
      service.getDatabase(containerItemId),
      service.listDatabases(),
    ]);
    if (container !== null) setSnapshot({ container, sources });
  }, [containerItemId, service]);
  useEffect(() => {
    void refresh();
    return service.subscribeProjection(() => {
      void refresh();
    });
  }, [refresh, service]);

  const presentation = snapshot?.container.presentation;
  const storedViews =
    presentation?.views
      .filter((view) => view.state === "active")
      .sort((a, b) => a.positionKey.localeCompare(b.positionKey)) ?? [];
  const storedOrder = storedViews.map((view) => view.id).join("|");
  const pendingKey = pendingOrder?.join("|") ?? null;
  useEffect(() => {
    if (pendingKey !== null && pendingKey === storedOrder) setPendingOrder(null);
  }, [pendingKey, storedOrder]);
  const views =
    pendingOrder === null
      ? storedViews
      : pendingOrder
          .flatMap((id) => {
            const view = storedViews.find((candidate) => candidate.id === id);
            return view === undefined ? [] : [view];
          })
          .concat(storedViews.filter((view) => !pendingOrder.includes(view.id)));
  const selected = views.find((view) => view.id === selectedViewId) ?? views[0];
  const beginCloseSettings = useCallback(() => {
    if (settingsClosingRef.current) return;
    settingsClosingRef.current = true;
    setFocusViewName(false);
    setSettingsClosing(true);
  }, []);
  const finishCloseSettings = useCallback(() => {
    if (!settingsClosingRef.current) return;
    settingsClosingRef.current = false;
    setSettingsClosing(false);
    setSettingsScreen(null);
  }, []);
  const openSettings = useCallback((screen: ViewSettingsScreen) => {
    settingsClosingRef.current = false;
    setSettingsClosing(false);
    setSettingsScreen(screen);
  }, []);
  useEffect(() => {
    if (settingsScreen === null || settingsClosing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          ".database-view-settings input, .database-view-settings textarea, .database-view-settings select",
        )
      ) {
        return;
      }
      beginCloseSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beginCloseSettings, settingsClosing, settingsScreen]);
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  const repairsInFlight = useRef(new Set<string>());
  const stackedKey = storedViews
    .filter((view) => isStackedViewName(view.name))
    .map((view) => `${view.id}:${view.name}`)
    .join("|");
  const activeSources = snapshot?.sources.filter((source) => source.sourceId !== undefined) ?? [];
  const save = async (candidate: DatabasePresentationDefinition): Promise<void> => {
    if (snapshot?.container.presentationRevisionId === undefined) return;
    const result = await service.mutate(
      "database.presentation.replace",
      {
        containerItemId,
        baseRevisionId: snapshot.container.presentationRevisionId,
        presentation: candidate,
      },
      [snapshot.container.presentationRevisionId],
    );
    if (!result.ok) throw new Error(result.error.title);
    await refresh();
  };
  // `save` is a new function every render. The flight key already blocks a second
  // write for the same stacked names, so it must not retrigger this effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flight key guards the write
  useEffect(() => {
    if (linked || stackedKey === "") return;
    const current = presentationRef.current;
    if (current === undefined) return;
    const flight = `${containerItemId}:${stackedKey}`;
    if (repairsInFlight.current.has(flight)) return;
    const repaired = repairAutomaticViewNames(current.views);
    if (repaired === null) return;
    repairsInFlight.current.add(flight);
    void save({ ...current, views: repaired })
      .catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : "Les noms de vues n’ont pas pu être corrigés.",
        );
      })
      .finally(() => {
        repairsInFlight.current.delete(flight);
      });
  }, [containerItemId, linked, stackedKey]);
  const createView = async (type: DatabaseView["type"]): Promise<void> => {
    if (presentation === undefined || selected === undefined) return;
    const source = activeSources.find((candidate) => candidate.sourceId === selected.sourceId);
    if (source === undefined) return;
    const name = nextAutomaticViewName(
      type,
      views.map((view) => view.name),
    );
    const generated = createSavedView(
      { ...source.definition, views: presentation.views },
      selected,
      type,
      name,
    );
    if (generated.views.length === presentation.views.length) return;
    const created = generated.views.at(-1);
    if (created === undefined) return;
    try {
      await save({
        ...presentation,
        views: [...presentation.views, { ...created, sourceId: selected.sourceId }],
      });
      setSelectedViewId(created.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La vue n’a pas pu être ajoutée.");
    }
  };
  const createOwnedSource = async (): Promise<void> => {
    const baseRevisionId = snapshot?.container.presentationRevisionId;
    if (baseRevisionId === undefined || presentation === undefined || creatingSource) return;
    setCreatingSource(true);
    const ownedNames = activeSources
      .filter((source) => source.itemId === containerItemId)
      .map((source) => source.definition.name ?? "");
    let name = "Nouvelle source";
    for (let index = 2; ownedNames.includes(name); index += 1) name = `Nouvelle source ${index}`;
    const sourceId = generateUuidV7();
    const initialViewId = generateUuidV7();
    const viewName = nextAutomaticViewName(
      "table",
      views.map((view) => view.name),
    );
    try {
      const result = await service.mutate(
        "database.source.create",
        {
          ownerItemId: containerItemId,
          sourceId,
          name,
          titlePropertyId: generateUuidV7(),
          initialViewId,
          initialViewName: viewName,
          baseRevisionId,
        },
        [baseRevisionId],
      );
      if (!result.ok) throw new Error(result.error.title);
      setSelectedViewId(initialViewId);
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La source n’a pas pu être créée.");
    } finally {
      setCreatingSource(false);
    }
  };
  const changeSource = async (sourceId: Uuid): Promise<void> => {
    if (presentation === undefined || selected === undefined || (!linked && views.length < 2))
      return;
    const source = activeSources.find((candidate) => candidate.sourceId === sourceId);
    const template = source?.definition.views.find((view) => view.state === "active");
    if (template === undefined || source === undefined) return;
    try {
      await save({
        ...presentation,
        views: presentation.views.map((view) =>
          view.id === selected.id
            ? {
                ...template,
                id: view.id,
                name: view.name,
                positionKey: view.positionKey,
                sourceId,
              }
            : view,
        ),
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La source n’a pas pu être modifiée.");
    }
  };

  const revealOwnedSource = async (): Promise<void> => {
    if (presentation === undefined) return;
    const sourceId = snapshot?.container.sourceId ?? ownedSourceIdFromItemId(containerItemId);
    const existing = views.find((view) => view.sourceId === sourceId);
    if (existing !== undefined) {
      setSelectedViewId(existing.id);
      return;
    }
    const source = snapshot?.sources.find((candidate) => candidate.sourceId === sourceId);
    const template = source?.definition.views.find((view) => view.state === "active");
    if (template === undefined || source === undefined) return;
    const id = generateUuidV7();
    try {
      await save({
        ...presentation,
        views: [
          ...presentation.views,
          {
            ...template,
            id,
            name: source.definition.name ?? "Source d’origine",
            positionKey: `view-${String(views.length + 1).padStart(6, "0")}`,
            sourceId,
          },
        ],
      });
      setSelectedViewId(id);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "La source d’origine n’a pas pu être affichée.",
      );
    }
  };

  const commitViewName = (name: string): void => {
    const next = name.trim();
    if (
      presentation === undefined ||
      selected === undefined ||
      next === "" ||
      next === selected.name
    ) {
      return;
    }
    void save({
      ...presentation,
      views: presentation.views.map((view) =>
        view.id === selected.id ? { ...view, name: next } : view,
      ),
    }).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "La vue n’a pas pu être renommée."),
    );
  };
  const openViewMenu = (id: Uuid, x: number, y: number): void => {
    setSelectedViewId(id);
    setViewMenu({ viewId: id, x, y });
  };
  const duplicateView = (viewId: Uuid): void => {
    if (presentation === undefined) return;
    const view = presentation.views.find(
      (candidate) => candidate.id === viewId && candidate.state === "active",
    );
    if (view === undefined) return;
    const id = generateUuidV7();
    const name = isAutomaticViewName(view.name)
      ? nextAutomaticViewName(
          view.type,
          views.map((candidate) => candidate.name),
        )
      : duplicateChosenViewName(
          view.name,
          views.map((candidate) => candidate.name),
        );
    void save({
      ...presentation,
      views: [
        ...presentation.views,
        {
          ...view,
          id,
          name,
          positionKey: keyAfterAll(presentation.views.map((item) => item.positionKey)),
        },
      ],
    })
      .then(() => setSelectedViewId(id))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "La vue n’a pas pu être dupliquée."),
      );
  };
  const replaceSourceDefinition = async (
    sourceId: Uuid,
    definition: LocalDatabaseRow["definition"],
  ): Promise<void> => {
    const source = activeSources.find((candidate) => candidate.sourceId === sourceId);
    if (source?.sourceId === undefined) throw new Error("Source indisponible");
    const result = await service.replaceDatabaseDefinition(source.itemId, {
      baseRevisionId: source.definitionRevisionId ?? source.itemId,
      sourceId: source.sourceId,
      definition: definition as never,
    });
    if (!result.ok) throw new Error(result.error.title);
    await refresh();
  };
  const renameSource = (sourceId: Uuid, name: string): void => {
    const source = activeSources.find((candidate) => candidate.sourceId === sourceId);
    if (source === undefined) return;
    void replaceSourceDefinition(sourceId, { ...source.definition, name }).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "La source n’a pas pu être renommée."),
    );
  };
  const cancelTabRename = (): void => {
    renameClosed.current = true;
    setRenamingViewId(null);
  };
  const commitTabRename = (id: Uuid): void => {
    if (renameClosed.current) return;
    renameClosed.current = true;
    const view = views.find((candidate) => candidate.id === id);
    const name = renameDraft.trim();
    setRenamingViewId(null);
    if (presentation === undefined || view === undefined || name === "" || name === view.name) {
      return;
    }
    void save({
      ...presentation,
      views: presentation.views.map((candidate) =>
        candidate.id === id ? { ...candidate, name } : candidate,
      ),
    }).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "La vue n’a pas pu être renommée."),
    );
  };
  const reorderView = (activeId: string, overId: string): void => {
    if (presentation === undefined || linked) return;
    const fromIndex = views.findIndex((view) => view.id === activeId);
    const toIndex = views.findIndex((view) => view.id === overId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const next = arrayMove(views, fromIndex, toIndex);
    // Publish the new order in the same turn as the drop, before the drag
    // transforms disappear. Waiting for the saved projection lets every tab
    // snap home and then jump into place.
    setPendingOrder(next.map((view) => view.id));
    const keys = storedViews
      .map((view) => view.positionKey)
      .sort((left, right) => left.localeCompare(right));
    const keyById = new Map(next.map((view, index) => [view.id, keys[index] ?? view.positionKey]));
    void save({
      ...presentation,
      views: presentation.views.map((view) => {
        const positionKey = keyById.get(view.id);
        return positionKey === undefined || positionKey === view.positionKey
          ? view
          : { ...view, positionKey };
      }),
    }).catch((cause) => {
      setPendingOrder(null);
      setError(cause instanceof Error ? cause.message : "La vue n’a pas pu être déplacée.");
    });
  };
  const onViewDragStart = (_event: DragStartEvent): void => {
    skipSelectAfterDrag.current = true;
  };
  const onViewDragEnd = (event: DragEndEvent): void => {
    const over = event.over;
    if (over !== null && over.id !== event.active.id)
      reorderView(String(event.active.id), String(over.id));
    window.setTimeout(() => {
      skipSelectAfterDrag.current = false;
    }, 0);
  };
  const selectView = (id: Uuid): void => {
    if (skipSelectAfterDrag.current) {
      skipSelectAfterDrag.current = false;
      return;
    }
    setSelectedViewId(id);
  };
  const changeFormat = (type: DatabaseView["type"]): void => {
    if (presentation === undefined || selected === undefined || type === selected.type) return;
    const source = activeSources.find((candidate) => candidate.sourceId === selected.sourceId);
    if (source === undefined) return;
    const generated = createSavedView(
      { ...source.definition, views: [selected] },
      selected,
      type,
      selected.name,
    );
    const converted = [...generated.views].reverse().find((view) => view.state === "active");
    if (converted === undefined || converted.id === selected.id) return;
    void save({
      ...presentation,
      views: presentation.views.map((view) =>
        view.id === selected.id
          ? {
              ...converted,
              id: view.id,
              name: isAutomaticViewName(view.name)
                ? nextAutomaticViewName(
                    type,
                    views
                      .filter((candidate) => candidate.id !== view.id)
                      .map((candidate) => candidate.name),
                  )
                : view.name,
              positionKey: view.positionKey,
              sourceId: view.sourceId,
            }
          : view,
      ),
    }).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Le format n’a pas pu être modifié."),
    );
  };
  const editProperty = async (
    propertyId: Uuid,
    edit: (property: DatabaseProperty) => DatabaseProperty,
    confirmed = false,
  ): Promise<void> => {
    if (selected === undefined) throw new Error("Source indisponible");
    await editEntrySourceDefinition(
      service,
      selected.sourceId,
      (definition) => updateEntryProperty(definition, propertyId, edit),
      confirmed,
    );
    await refresh();
  };
  const duplicateProperty = async (propertyId: Uuid): Promise<void> => {
    if (selected === undefined) throw new Error("Source indisponible");
    await editEntrySourceDefinition(service, selected.sourceId, (definition) =>
      duplicateEntryProperty(definition, propertyId),
    );
    await refresh();
  };
  const createProperty = async (
    draft: Parameters<typeof validatePropertyDraft>[0],
  ): Promise<void> => {
    if (presentation === undefined || selected === undefined) return;
    const source = activeSources.find((candidate) => candidate.sourceId === selected.sourceId);
    if (source === undefined) return;
    const validation = validatePropertyDraft(draft);
    if (!validation.ok) throw new Error(validation.error);
    const property = propertyFromDraft(
      validation,
      keyAfterAll(source.definition.properties.map((item) => item.positionKey)),
    );
    const column = {
      propertyId: property.id,
      visible: true,
      positionKey: property.positionKey,
    };
    const attach = <T extends { readonly properties: readonly { readonly propertyId: Uuid }[] }>(
      view: T,
    ): T =>
      view.properties.some((item) => item.propertyId === property.id)
        ? view
        : { ...view, properties: [...view.properties, column] };
    const ownedHere = source.itemId === containerItemId;
    const { sourceId: _sourceId, ...selectedView } = selected;
    const nextDefinition = {
      ...source.definition,
      properties: [...source.definition.properties, property],
      views: ownedHere
        ? definitionViewsPreservingPresentation(
            source.definition.views.map((view) => attach(view)),
            presentation.views,
            selected.id,
            attach(selectedView),
          )
        : source.definition.views.map((view) => attach(view)),
    };
    await replaceSourceDefinition(selected.sourceId, nextDefinition);
    if (ownedHere) return;
    await save({
      ...presentation,
      views: presentation.views.map((view) => (view.id === selected.id ? attach(view) : view)),
    });
  };
  const applyViewSettings = (next: DatabaseView): void => {
    if (presentation === undefined || selected === undefined) return;
    void save({
      ...presentation,
      views: presentation.views.map((view) =>
        view.id === selected.id
          ? {
              ...view,
              ...next,
              id: view.id,
              name: view.name,
              positionKey: view.positionKey,
              sourceId: view.sourceId,
            }
          : view,
      ),
    }).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "La vue n’a pas pu être mise à jour."),
    );
  };
  const setColumnVisible = (propertyId: Uuid, visible: boolean): void => {
    if (presentation === undefined || selected === undefined) return;
    const properties = selected.properties.some((column) => column.propertyId === propertyId)
      ? selected.properties.map((column) =>
          column.propertyId === propertyId ? { ...column, visible } : column,
        )
      : [
          ...selected.properties,
          {
            propertyId,
            visible,
            positionKey: keyAfterAll(selected.properties.map((column) => column.positionKey)),
          },
        ];
    void save({
      ...presentation,
      views: presentation.views.map((view) =>
        view.id === selected.id ? { ...view, properties } : view,
      ),
    }).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "La colonne n’a pas pu être modifiée."),
    );
  };
  const requestRetireView = (viewId?: Uuid): void => {
    const view = views.find((candidate) => candidate.id === (viewId ?? selected?.id));
    if (presentation === undefined || view === undefined) return;
    retireTargetId.current = view.id;
    setSelectedViewId(view.id);
    const origin = activeSources.find((source) => source.sourceId === view.sourceId)?.itemId;
    const offer = viewDeletionOffer({
      currentPageId: containerItemId,
      sourceOriginPageId: origin ?? `missing:${view.sourceId}`,
      activeViewsOfSourceOnCurrentPage: views.filter(
        (candidate) => candidate.sourceId === view.sourceId,
      ).length,
    });
    if (offer === "view-or-source") {
      setRetireChoice("source");
      setRetireChoiceOpen(true);
      return;
    }
    retireView(view.id);
  };
  const retireViewAndSource = (): void => {
    const view = views.find(
      (candidate) => candidate.id === (retireTargetId.current ?? selected?.id),
    );
    if (snapshot?.container.presentationRevisionId === undefined || view === undefined) return;
    const baseRevisionId = snapshot.container.presentationRevisionId;
    const sourceId = view.sourceId;
    setRetireChoiceOpen(false);
    void service
      .mutate(
        "database.source.delete",
        { ownerItemId: containerItemId, sourceId, baseRevisionId },
        [baseRevisionId],
      )
      .then(async (result) => {
        if (!result.ok) throw new Error(result.error.title);
        const remaining = views.find((candidate) => candidate.sourceId !== sourceId);
        setSelectedViewId(remaining?.id ?? null);
        setError(null);
        await refresh();
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "La source n’a pas pu être supprimée."),
      );
  };
  const retireView = (viewId?: Uuid): void => {
    const id = viewId ?? retireTargetId.current ?? selected?.id;
    if (presentation === undefined || id === undefined) return;
    setRetireChoiceOpen(false);
    const remaining = views.find((view) => view.id !== id);
    void save({
      ...presentation,
      views: presentation.views.map((view) =>
        view.id === id ? { ...view, state: "retired" } : view,
      ),
    })
      .then(() => setSelectedViewId(remaining?.id ?? null))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "La vue n’a pas pu être supprimée."),
      );
  };

  if (snapshot === null || presentation === undefined)
    return <p role="status">Chargement de la base de données…</p>;
  if (selected === undefined) {
    return (
      <section className="database-container-page" aria-label="Base de données">
        <p role="status">Cette page n’affiche aucune vue.</p>
        <Button type="button" size="compact" onClick={() => void createOwnedSource()}>
          Créer une nouvelle source
        </Button>
      </section>
    );
  }
  const ownedSourceId = snapshot.container.sourceId ?? ownedSourceIdFromItemId(containerItemId);
  const sourceProperties =
    activeSources.find((source) => source.sourceId === selected.sourceId)?.definition.properties ??
    [];
  const hasBoardAxis = sourceProperties.some(
    (property) =>
      property.state === "active" && (property.type === "status" || property.type === "select"),
  );
  const hasCalendarDate = sourceProperties.some(
    (property) => property.state === "active" && property.type === "date",
  );
  const currentSource = activeSources.find((source) => source.sourceId === selected.sourceId);
  const currentSourceName = currentSource?.definition.name ?? "";
  const showSourceUnderPageTitle =
    databasePageTitleMode(new Set(views.map((view) => view.sourceId)).size) === "page-and-source" &&
    currentSourceName.trim().length > 0;
  const menuView = views.find((view) => view.id === viewMenu?.viewId);
  const menuSourceName =
    activeSources.find((source) => source.sourceId === menuView?.sourceId)?.definition.name ?? "";
  return (
    <section className="database-container-page" aria-label="Base de données">
      {showSourceUnderPageTitle && currentSource?.sourceId !== undefined ? (
        <CurrentSourceTitle
          name={currentSourceName}
          editable={currentSource.itemId === containerItemId}
          onCommit={(name) => renameSource(currentSource.sourceId as Uuid, name)}
        />
      ) : null}
      <div className="database-container-page__topbar">
        <nav className="database-container-page__tabs" aria-label="Vues de la base">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictViewsToTabBar]}
            measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
            onDragCancel={() => {
              skipSelectAfterDrag.current = false;
            }}
            {...(linked
              ? {}
              : {
                  onDragStart: onViewDragStart,
                  onDragEnd: onViewDragEnd,
                })}
          >
            <SortableContext
              items={views.map((view) => view.id)}
              strategy={horizontalListSortingStrategy}
            >
              {views.map((view) => (
                <SortableDatabaseViewTab
                  key={view.id}
                  id={view.id}
                  name={view.name}
                  type={view.type}
                  icon={view.icon}
                  current={view.id === selected.id}
                  draggable={!linked}
                  renaming={renamingViewId === view.id}
                  renameDraft={renameDraft}
                  onRenameDraft={setRenameDraft}
                  onOpenMenu={openViewMenu}
                  onRenameCommit={commitTabRename}
                  onRenameCancel={cancelTabRename}
                  onSelect={selectView}
                />
              ))}
            </SortableContext>
          </DndContext>
          <PopoverRoot open={addViewOpen} setOpen={setAddViewOpen}>
            <PopoverTrigger
              className="database-container-page__add-view"
              aria-label="Ajouter une vue"
              title="Ajouter une vue"
            >
              <AppIcon name="add" size="small" />
            </PopoverTrigger>
            <PopoverContent
              className="database-view-type-picker"
              aria-label="Ajouter une nouvelle vue"
            >
              <PopoverHeading className="database-view-type-picker__heading">
                Ajouter une nouvelle vue
              </PopoverHeading>
              <div className="database-view-type-picker__grid">
                {VIEW_TYPE_CHOICES.map((type) => {
                  const unavailable =
                    (type === "board" && !hasBoardAxis) ||
                    (type === "calendar" && !hasCalendarDate);
                  const reason =
                    type === "board"
                      ? DATABASE_COPY.toolbar.boardNeedsProperty
                      : DATABASE_COPY.toolbar.calendarNeedsProperty;
                  return (
                    <button
                      key={type}
                      type="button"
                      className="database-view-type-picker__type"
                      disabled={unavailable}
                      title={unavailable ? reason : undefined}
                      onClick={() => {
                        setAddViewOpen(false);
                        void createView(type);
                      }}
                    >
                      <AppIcon name={VIEW_TYPE_ICON[type]} size="medium" />
                      {VIEW_TYPE_LABEL[type]}
                    </button>
                  );
                })}
              </div>
              <div className="database-view-type-picker__source">
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  onClick={() => {
                    setAddViewOpen(false);
                    void createOwnedSource();
                  }}
                >
                  Créer une nouvelle source
                </Button>
              </div>
            </PopoverContent>
          </PopoverRoot>
        </nav>
        <div className="database-container-page__tools">
          <div id={`database-view-tools-${containerItemId}`} />
          <Button
            type="button"
            size="square"
            className="database-chrome-trigger"
            aria-label="Options de la vue"
            title="Options de la vue"
            aria-expanded={settingsScreen !== null}
            onClick={() => {
              if (settingsScreen === null || settingsClosing) {
                openSettings("root");
                return;
              }
              beginCloseSettings();
            }}
          >
            <AppIcon name="settings" size="small" />
          </Button>
        </div>
      </div>
      {error !== null ? <p role="alert">{error}</p> : null}
      {retireChoiceOpen ? (
        <RetireOwnedSourceDialog
          sourceName={
            activeSources
              .find(
                (source) =>
                  source.sourceId ===
                  views.find((view) => view.id === (retireTargetId.current ?? selected.id))
                    ?.sourceId,
              )
              ?.definition.name?.trim() || "Sans nom"
          }
          choice={retireChoice}
          onChoice={setRetireChoice}
          onCancel={() => setRetireChoiceOpen(false)}
          onConfirm={() => {
            if (retireChoice === "source") {
              retireViewAndSource();
              return;
            }
            retireView();
          }}
        />
      ) : null}
      <div className="database-container-page__stage">
        <DatabaseViewSurface
          key={`${selected.id}:${selected.sourceId}`}
          containerItemId={containerItemId}
          viewId={selected.id}
          formatPlacement="chrome"
          service={service}
          openItem={onOpenEntry}
          {...(returnFocusEntryId === undefined ? {} : { returnFocusEntryId })}
          {...(onReturnFocusRestored === undefined ? {} : { onReturnFocusRestored })}
        />
        <MenuRoot
          open={viewMenu !== null}
          setOpen={(open) => {
            if (!open) setViewMenu(null);
          }}
        >
          <MenuContent
            className="database-view-tab-menu"
            data-testid="view-tab-menu"
            aria-label="Actions de la vue"
            getAnchorRect={() =>
              viewMenu === null
                ? null
                : DOMRect.fromRect({ x: viewMenu.x, y: viewMenu.y, width: 0, height: 0 })
            }
          >
            <MenuItem
              onClick={() => {
                const id = viewMenu?.viewId;
                if (id !== undefined) setSelectedViewId(id);
                openSettings("root");
                setFocusViewName(true);
              }}
            >
              <AppIcon name="edit" size="small" />
              Renommer
            </MenuItem>
            <MenuItem
              onClick={() => {
                openSettings("root");
              }}
            >
              <AppIcon name="settings" size="small" />
              Modifier la vue
            </MenuItem>
            <MenuItem
              onClick={() => {
                openSettings("source");
              }}
            >
              <AppIcon name="layers" size="small" />
              <span>Source</span>
              <span className="database-view-tab-menu__aside">{menuSourceName}</span>
              <AppIcon name="chevronRight" size="small" />
            </MenuItem>
            <MenuItem
              onClick={() => {
                const id = viewMenu?.viewId;
                if (id !== undefined) duplicateView(id);
              }}
            >
              <AppIcon name="copy" size="small" />
              Dupliquer la vue
            </MenuItem>
            <MenuItem
              className="database-view-tab-menu__danger"
              onClick={() => {
                const id = viewMenu?.viewId;
                if (id !== undefined) requestRetireView(id);
              }}
            >
              <AppIcon name="delete" size="small" />
              Supprimer la vue
            </MenuItem>
          </MenuContent>
        </MenuRoot>
        {settingsScreen === null ? null : (
          <ViewSettingsPanel
            screen={settingsScreen}
            name={selected.name}
            defaultName={fallbackViewName(
              selected.type,
              selected.name,
              views.filter((view) => view.id !== selected.id).map((view) => view.name),
            )}
            focusName={focusViewName}
            onNameFocusHandled={() => setFocusViewName(false)}
            type={selected.type}
            view={selected}
            properties={sourceProperties}
            sources={activeSources.flatMap((source) =>
              source.sourceId === undefined
                ? []
                : [
                    {
                      sourceId: source.sourceId,
                      name: source.definition.name ?? "Sans nom",
                      ownedHere: source.itemId === containerItemId,
                      viewCount: views.filter((view) => view.sourceId === source.sourceId).length,
                    },
                  ],
            )}
            currentSourceId={selected.sourceId}
            sourceLocked={!linked && views.length < 2}
            boardAvailable={hasBoardAxis}
            calendarAvailable={hasCalendarDate}
            revealOwnedSource={!linked && selected.sourceId !== ownedSourceId}
            creatingSource={creatingSource}
            filterCount={selected.filter.criteria.length}
            sortCount={selected.sorts.length}
            closing={settingsClosing}
            onScreen={setSettingsScreen}
            onClose={beginCloseSettings}
            onExited={finishCloseSettings}
            onCommitName={commitViewName}
            onCommitIcon={(icon) => {
              if (presentation === undefined || (selected.icon ?? null) === icon) return;
              void save({
                ...presentation,
                views: presentation.views.map((view) =>
                  view.id === selected.id ? { ...view, icon } : view,
                ),
              }).catch((cause) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "L’icône de la vue n’a pas pu être modifiée.",
                ),
              );
            }}
            onChangeFormat={changeFormat}
            onChangeView={applyViewSettings}
            onToggleProperty={setColumnVisible}
            onChangeSource={(sourceId) => {
              void changeSource(sourceId);
            }}
            onCreateSource={() => {
              void createOwnedSource();
            }}
            onRevealOwnedSource={() => {
              void revealOwnedSource();
            }}
            onCreateProperty={createProperty}
            onEditProperty={editProperty}
            onDuplicateProperty={duplicateProperty}
          />
        )}
      </div>
    </section>
  );
}
